// The Herdr app runtime. The Herdr app (herdr-app) draws spaces, tabs, and panes;
// herdr-core (`hc`) runs the terminals inside them and answers JSON-RPC on the
// socket each terminal names in HC_TERMINAL_SOCKET. A worker is an hc terminal
// that runs the CLI with its brief as the launch prompt, labelled into the
// caller's space so the app shows it.

import { connect, type Socket } from "node:net";
import { constants } from "node:os";
import { resolve } from "node:path";
import { loadRoutes, expandHome, type AgentKind } from "./config.ts";
import {
  agentArgs,
  defaultTimeout,
  planWorker,
  sandboxHint,
  type DispatchOptions,
  type WorkerPlan,
} from "./dispatch.ts";

// `unknown` is a worker that never started its task: it reports no turn and is not
// working, which is how a CLI stuck on a dialog before its first turn looks.
// `exited` is a CLI whose program ended.
export type AppStatus =
  | "idle"
  | "working"
  | "done"
  | "blocked"
  | "error"
  | "exited"
  | "unknown";

export interface AppHandle {
  agent: string;
  terminal: string;
  profile: string;
  kind: AgentKind;
  depth: number;
}

export interface AppSettlement {
  status: AppStatus;
  blocked: boolean;
  paneClosed: boolean;
  output: string;
}

export interface AppCollectResult extends AppSettlement {
  agent: string;
  terminal: string;
  kind: AgentKind;
}

export interface AppFailure {
  agent: string;
  error: string;
}

export interface AppNextResult {
  settled: Array<AppCollectResult | AppFailure>;
  pending: string[];
}

export type HcRpc = (
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>;

// Wakes the caller when herdr-core reports a status, turn, or exit change on a
// watched terminal. `live` is false once the subscription is gone.
export interface AppWatch {
  readonly live: boolean;
  changed(ms: number): Promise<void>;
  close(): void;
}

export type AppWatcher = (
  terminals: string[],
  env: NodeJS.ProcessEnv
) => Promise<AppWatch>;

export class HcError extends Error {
  readonly method: string;
  readonly kind: string | undefined;

  constructor(method: string, detail: string, kind: string | undefined) {
    super(`hc ${method} failed: ${detail}`);
    this.name = "HcError";
    this.method = method;
    this.kind = kind;
  }
}

interface Terminal {
  address: string;
  name: string | null;
  state: string;
  turn: number;
  status: { state?: string } | null;
  labels: Record<string, string>;
  exitCode: number | null;
}

const OUTPUT_LINES = 240;
const RPC_TIMEOUT_MS = 30000;
const SUBSCRIBE_TIMEOUT_MS = 2000;
// A live subscription wakes the wait on every change; this only bounds a missed event.
const WATCH_HEARTBEAT_MS = 10000;
const POLL_MS = 1000;
const WAKING_EVENTS = new Set(["status", "turn", "finished", "removed", "lost"]);
// Labels the dispatcher writes so --collect and --next know a terminal is a pstack worker.
const KIND_LABEL = "pstack.kind";

export function socketPath(env: NodeJS.ProcessEnv): string | undefined {
  return env.HC_TERMINAL_SOCKET || env.HC_SOCKET || undefined;
}

function requireApp(env: NodeJS.ProcessEnv): { caller: string; socket: string } {
  const caller = env.HC_TERMINAL_ID;
  const socket = socketPath(env);
  if (!caller || !socket)
    throw new Error(
      "the Herdr app runtime needs HC_TERMINAL_ID and HC_TERMINAL_SOCKET; run inside a Herdr app terminal"
    );
  return { caller, socket };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

// One JSON-RPC request per connection, one message per line.
export function socketRpc(path: string, env: NodeJS.ProcessEnv = process.env): HcRpc {
  return (method, params) =>
    new Promise((done, fail) => {
      const socket = connect(path);
      let buffer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        fail(new HcError(method, `no answer within ${RPC_TIMEOUT_MS} ms`, "timeout"));
      }, RPC_TIMEOUT_MS + Number(params.timeout ?? 0) * 1000);
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        socket.destroy();
        fn();
      };
      socket.on("connect", () =>
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`)
      );
      socket.on("error", (error) =>
        settle(() => fail(new HcError(method, sandboxHint(error.message, env), "unavailable")))
      );
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        for (let at; (at = buffer.indexOf("\n")) >= 0; ) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          let message: { id?: unknown; result?: unknown; error?: unknown };
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.id !== 1) continue;
          if (message.error !== undefined) {
            const error = asRecord(message.error, "error");
            const data = error.data as Record<string, unknown> | undefined;
            const kind = typeof data?.kind === "string" ? data.kind : undefined;
            const detail = [error.message, data?.hint ?? data?.message]
              .filter((part) => typeof part === "string" && part !== "")
              .join(": ");
            settle(() => fail(new HcError(method, detail || JSON.stringify(error), kind)));
          } else {
            settle(() => done(message.result));
          }
          return;
        }
      });
    });
}

export function parseTerminal(value: unknown): Terminal {
  const record = asRecord(value, "hc terminal");
  const address = record.address;
  if (typeof address !== "string" || address === "")
    throw new Error("hc terminal has no address");
  const status =
    typeof record.status === "object" && record.status !== null
      ? (record.status as { state?: string })
      : null;
  const labels =
    typeof record.labels === "object" && record.labels !== null
      ? (record.labels as Record<string, string>)
      : {};
  return {
    address,
    name: typeof record.name === "string" ? record.name : null,
    state: typeof record.state === "string" ? record.state : "live",
    turn: typeof record.turn === "number" ? record.turn : 0,
    status,
    labels,
    exitCode: typeof record.exit_code === "number" ? record.exit_code : null,
  };
}

// A worker runs one task: its launch prompt. `turn` goes up each time the CLI's own
// status leaves `working`, so a finished task is a turn above zero that is no longer
// working. A CLI that reports `idle` while still booting (Codex does) has turn 0.
// Undefined means the worker is still on its task.
export function settledStatus(terminal: Terminal): AppStatus | undefined {
  if (terminal.state === "finished") return "exited";
  const word = terminal.status?.state;
  if (word === "blocked") return "blocked";
  if (word === "error") return "error";
  if (terminal.turn >= 1 && word !== "working")
    return word === "idle" ? "idle" : "done";
  return undefined;
}

// What an unsettled worker is when the budget runs out.
export function unsettledStatus(terminal: Terminal): AppStatus {
  return terminal.status?.state === "working" ? "working" : "unknown";
}

// The caller's space puts the worker in the app; without one (an hc terminal
// outside the app) the worker runs hidden and `hc attach` shows it.
export function workerLabels(
  options: Pick<DispatchOptions, "role" | "placement">,
  worker: Pick<WorkerPlan, "profile" | "kind" | "depth">,
  callerLabels: Record<string, string>
): Record<string, string> {
  const labels: Record<string, string> = {
    "pstack.role": options.role,
    "pstack.profile": worker.profile,
    [KIND_LABEL]: worker.kind,
    "pstack.depth": String(worker.depth),
  };
  const space = callerLabels["herdr.space"];
  if (space) {
    labels["herdr.space"] = space;
    const tab = callerLabels["herdr.tab"];
    if (options.placement === "split" && tab) labels["herdr.tab"] = tab;
  }
  return labels;
}

// herdr-core starts programs with its own login environment, not the caller's.
// The caller's PATH comes along so the worker finds the same CLIs, bun, and node;
// PSTACK_HERDR_ROUTES so a subcoordinator routes from the same file.
export function workerEnvironment(
  worker: Pick<WorkerPlan, "childEnv">,
  env: NodeJS.ProcessEnv
): Record<string, string> {
  const out: Record<string, string> = {};
  if (env.PATH) out.PATH = env.PATH;
  if (env.PSTACK_HERDR_ROUTES) out.PSTACK_HERDR_ROUTES = env.PSTACK_HERDR_ROUTES;
  for (const [key, value] of Object.entries(worker.childEnv)) {
    if (/[\r\n]/.test(value)) throw new Error(`environment ${key} contains a newline`);
    out[key] = expandHome(value);
  }
  return out;
}

// The brief is the CLI's launch prompt, after `--` so no option swallows it.
// Codex runs with --no-daemon so its commands run inside the hc terminal.
export function workerArgv(
  worker: Pick<WorkerPlan, "kind" | "model" | "effort" | "prompt">,
  readonly: boolean,
  bin: string
): string[] {
  const args = agentArgs(worker.kind, worker.model, worker.effort, readonly);
  if (worker.kind === "codex") args.unshift("--no-daemon");
  return [bin, ...args, "--", worker.prompt];
}

function whichBin(kind: AgentKind, env: NodeJS.ProcessEnv): string {
  return Bun.which(kind, { PATH: env.PATH ?? "" }) ?? kind;
}

async function getTerminal(rpc: HcRpc, caller: string, name: string): Promise<Terminal> {
  return parseTerminal(await rpc("terminal.get", { terminal: name, caller }));
}

// A headless terminal is 120 rows tall, so a short answer sits above a block of
// empty rows; runs of blank lines and trailing padding are dropped.
export function tidyScreen(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readOutput(rpc: HcRpc, caller: string, name: string): Promise<string> {
  const result = asRecord(
    await rpc("terminal.read", { terminal: name, caller, lines: OUTPUT_LINES }),
    "hc terminal.read"
  );
  return typeof result.text === "string" ? tidyScreen(result.text) : "";
}

async function screen(rpc: HcRpc, caller: string, name: string): Promise<string> {
  try {
    return await readOutput(rpc, caller, name);
  } catch {
    return "";
  }
}

async function closeTerminal(rpc: HcRpc, caller: string, terminal: Terminal): Promise<void> {
  if (terminal.state !== "finished")
    await rpc("terminal.kill", { terminal: terminal.address, caller });
  await rpc("terminal.rm", { terminal: terminal.address, caller });
}

async function finish(
  rpc: HcRpc,
  caller: string,
  terminal: Terminal,
  status: AppStatus,
  keepPane: boolean
): Promise<AppSettlement> {
  const output = await readOutput(rpc, caller, terminal.address);
  const closes = (status === "done" || status === "idle" || status === "exited") && !keepPane;
  if (closes) await closeTerminal(rpc, caller, terminal);
  return { status, blocked: status === "blocked", paneClosed: closes, output };
}

// Waits until the worker settles or the budget ends. A worker still on its task at
// the end is handed back open, with its screen as the output.
async function awaitWorker(
  rpc: HcRpc,
  caller: string,
  address: string,
  timeout: number,
  keepPane: boolean,
  env: NodeJS.ProcessEnv,
  watch: AppWatcher
): Promise<AppSettlement> {
  const deadline = Date.now() + timeout;
  const watcher = await watch([address], env);
  try {
    for (;;) {
      const terminal = await getTerminal(rpc, caller, address);
      const status = settledStatus(terminal);
      if (status) return finish(rpc, caller, terminal, status, keepPane);
      const left = deadline - Date.now();
      if (left <= 0)
        return {
          status: unsettledStatus(terminal),
          blocked: false,
          paneClosed: false,
          output: await screen(rpc, caller, address),
        };
      await watcher.changed(Math.min(watcher.live ? WATCH_HEARTBEAT_MS : POLL_MS, left));
    }
  } finally {
    watcher.close();
  }
}

// herdr-core pushes every fact change; status, turn, and exit changes on a watched
// terminal are cues to read it again. Title changes (spinners) are ignored.
export async function watchTerminals(
  terminals: string[],
  env: NodeJS.ProcessEnv
): Promise<AppWatch> {
  const watched = new Set(terminals);
  let subscribed = false;
  let closed = false;
  let dirty = false;
  let wake: (() => void) | undefined;
  const signal = () => {
    if (wake) wake();
    else dirty = true;
  };
  let socket: Socket | undefined;
  const path = socketPath(env);
  if (path) {
    const opened = connect(path);
    socket = opened;
    subscribed = await new Promise<boolean>((ready) => {
      const timer = setTimeout(() => ready(false), SUBSCRIBE_TIMEOUT_MS);
      const end = () => {
        closed = true;
        clearTimeout(timer);
        ready(false);
        signal();
      };
      opened.on("error", end);
      opened.on("close", end);
      opened.on("connect", () =>
        opened.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: "pstack-herdr-watch", method: "events.subscribe", params: {} })}\n`
        )
      );
      let buffer = "";
      let started = false;
      opened.on("data", (chunk) => {
        buffer += chunk.toString();
        for (let at; (at = buffer.indexOf("\n")) >= 0; ) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          let message: {
            id?: unknown;
            method?: unknown;
            error?: unknown;
            params?: { type?: unknown; terminal?: unknown };
          };
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (!started) {
            if (message.id !== "pstack-herdr-watch") continue;
            if (message.error !== undefined) {
              opened.destroy();
              continue;
            }
            started = true;
            clearTimeout(timer);
            ready(true);
            continue;
          }
          const params = message.params;
          if (message.method === "missed") signal();
          else if (
            message.method === "event" &&
            typeof params?.terminal === "string" &&
            watched.has(params.terminal) &&
            WAKING_EVENTS.has(String(params.type))
          )
            signal();
        }
      });
    });
    if (!subscribed) socket.destroy();
  }
  dirty = false;
  return {
    get live() {
      return subscribed && !closed;
    },
    changed(ms) {
      if (dirty) {
        dirty = false;
        return Promise.resolve();
      }
      return new Promise((done) => {
        const timer = setTimeout(finishWait, Math.max(0, ms));
        function finishWait() {
          clearTimeout(timer);
          wake = undefined;
          done();
        }
        wake = finishWait;
      });
    },
    close() {
      socket?.destroy();
    },
  };
}

function workerKind(terminal: Terminal, name: string): AgentKind {
  const kind = terminal.labels[KIND_LABEL];
  if (kind !== "claude" && kind !== "codex")
    throw new Error(
      `${name} is not a pstack worker (no ${KIND_LABEL} label); only terminals herdr/dispatch.ts started can be collected`
    );
  return kind;
}

export async function dispatchApp(
  options: DispatchOptions,
  env: NodeJS.ProcessEnv = process.env,
  rpc: HcRpc = socketRpc(requireApp(env).socket, env),
  watch: AppWatcher = watchTerminals,
  onOwned: (name: string | undefined) => void = () => {}
): Promise<AppHandle | (AppHandle & AppSettlement)> {
  const { caller } = requireApp(env);
  const worker = planWorker(options, env);
  let callerLabels: Record<string, string> = {};
  try {
    callerLabels = (await getTerminal(rpc, caller, caller)).labels;
  } catch {
    // Without the caller's labels the worker still runs; it is just not shown.
  }
  const started = parseTerminal(
    await rpc("terminal.run", {
      argv: workerArgv(worker, options.readonly, whichBin(worker.kind, env)),
      name: options.name,
      cwd: resolve(options.cwd),
      caller,
      labels: workerLabels(options, worker, callerLabels),
      env: workerEnvironment(worker, env),
      no_notify: true,
    })
  );
  onOwned(started.address);
  const handle: AppHandle = {
    agent: options.name,
    terminal: started.address,
    profile: worker.profile,
    kind: worker.kind,
    depth: worker.depth,
  };
  if (!options.wait) return handle;
  return {
    ...handle,
    ...(await awaitWorker(
      rpc,
      caller,
      started.address,
      worker.timeout,
      options.keepPane,
      env,
      watch
    )),
  };
}

export async function collectApp(
  options: { name: string; timeout?: number; keepPane: boolean; routes?: string },
  env: NodeJS.ProcessEnv = process.env,
  rpc: HcRpc = socketRpc(requireApp(env).socket, env),
  watch: AppWatcher = watchTerminals,
  onOwned: (name: string | undefined) => void = () => {}
): Promise<AppCollectResult> {
  const { caller } = requireApp(env);
  const timeout = defaultTimeout(loadRoutes(options.routes, env), options.timeout);
  const terminal = await getTerminal(rpc, caller, options.name);
  const kind = workerKind(terminal, options.name);
  onOwned(terminal.address);
  return {
    agent: options.name,
    terminal: terminal.address,
    kind,
    ...(await awaitWorker(rpc, caller, terminal.address, timeout, options.keepPane, env, watch)),
  };
}

interface NextWorker {
  name: string;
  address: string;
  kind: AgentKind;
}

function failure(name: string, error: unknown): AppFailure {
  return { agent: name, error: error instanceof Error ? error.message : String(error) };
}

// Waits for the first of several workers to settle, then collects every one that has.
// It only watches, so a budget that ends or a stopped --next leaves every worker open.
export async function nextApp(
  options: { names: string[]; timeout?: number; keepPane: boolean; routes?: string },
  env: NodeJS.ProcessEnv = process.env,
  rpc: HcRpc = socketRpc(requireApp(env).socket, env),
  watch: AppWatcher = watchTerminals
): Promise<AppNextResult> {
  const { caller } = requireApp(env);
  const names = [...new Set(options.names.flatMap((name) => name.split(/\s+/)))].filter(Boolean);
  if (names.length === 0) throw new Error("--next needs an agent name");
  const deadline =
    Date.now() + defaultTimeout(loadRoutes(options.routes, env), options.timeout);
  const settled: AppNextResult["settled"] = [];
  let pending: NextWorker[] = [];
  for (const name of names) {
    try {
      const terminal = await getTerminal(rpc, caller, name);
      pending.push({ name, address: terminal.address, kind: workerKind(terminal, name) });
    } catch (error) {
      settled.push(failure(name, error));
    }
  }
  const unsettled = () => pending.map((worker) => worker.name);
  if (settled.length > 0) return { settled, pending: unsettled() };
  const watcher = await watch(
    pending.map((worker) => worker.address),
    env
  );
  try {
    for (;;) {
      const running: NextWorker[] = [];
      for (const worker of pending) {
        try {
          const terminal = await getTerminal(rpc, caller, worker.address);
          const status = settledStatus(terminal);
          if (!status) {
            running.push(worker);
            continue;
          }
          settled.push({
            agent: worker.name,
            terminal: worker.address,
            kind: worker.kind,
            ...(await finish(rpc, caller, terminal, status, options.keepPane)),
          });
        } catch (error) {
          settled.push(failure(worker.name, error));
        }
      }
      pending = running;
      const left = deadline - Date.now();
      if (settled.length > 0 || left <= 0) return { settled, pending: unsettled() };
      await watcher.changed(Math.min(watcher.live ? WATCH_HEARTBEAT_MS : POLL_MS, left));
    }
  } finally {
    watcher.close();
  }
}

// An interrupted dispatch or collect ends its worker; nobody is left to read it.
export function closeAppOnSignal(): (terminal: string | undefined) => void {
  let owned: string | undefined;
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (owned) {
        Bun.spawnSync(["hc", "kill", owned]);
        Bun.spawnSync(["hc", "rm", owned]);
      }
      process.exit(128 + constants.signals[signal]);
    });
  }
  return (terminal) => {
    owned = terminal;
  };
}
