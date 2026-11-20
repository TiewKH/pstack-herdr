// The Herdr app runtime. The Herdr app (herdr-app) draws spaces, tabs, and panes;
// herdr-core (`hc`) runs the terminals inside them and answers JSON-RPC on the
// socket each terminal names in HC_TERMINAL_SOCKET. A worker is an hc terminal
// that runs the CLI with its brief as the launch prompt, labelled into the
// caller's space so the app shows it.

import { connect } from "node:net";
import { resolve } from "node:path";
import { CONFIG_HOMES, loadRoutes, type AgentKind } from "./config.ts";
import {
  agentArgs,
  asObject,
  checkedEnv,
  closeOnSignal,
  defaultTimeout,
  firstSettled,
  nextNames,
  onJsonLines,
  planWorker,
  sandboxHint,
  socketWatch,
  type CollectFailure,
  type DispatchOptions,
  type StatusWatch,
  type WorkerPlan,
} from "./dispatch.ts";

// `unknown` is a worker that never started its task: it reports no turn and is not
// working, which is how a CLI stuck on a dialog before its first turn looks.
// `exited` is a CLI whose program ended or was lost.
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

export interface AppNextResult {
  settled: Array<AppCollectResult | CollectFailure>;
  pending: string[];
}

export type HcRpc = (
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>;

export type AppWatcher = (
  terminals: string[],
  env: NodeJS.ProcessEnv
) => Promise<StatusWatch>;

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

export interface Terminal {
  address: string;
  name: string | null;
  state: string;
  turn: number;
  status: { state?: string } | null;
  labels: Record<string, string>;
  pid: number | null;
  reason: string | null;
}

const OUTPUT_LINES = 240;
const RPC_TIMEOUT_MS = 30000;
// A live subscription wakes the wait on every change; this only bounds a missed event.
const WATCH_HEARTBEAT_MS = 10000;
const POLL_MS = 1000;
const WAKING_EVENTS = new Set([
  "status",
  "turn",
  "finished",
  "removed",
  "lost",
  "restarted",
]);
const WATCH_ID = "pstack-herdr-watch";
// Labels the dispatcher writes: the CLI kind marks a pstack worker for --collect and
// --next; the launch pid tells a kept terminal's replacement shell from the worker.
const KIND_LABEL = "pstack.kind";
const PID_LABEL = "pstack.pid";

export function socketPath(env: NodeJS.ProcessEnv): string | undefined {
  return env.HC_TERMINAL_SOCKET || env.HC_SOCKET || undefined;
}

function requireApp(env: NodeJS.ProcessEnv): {
  caller: string;
  socket: string;
} {
  const caller = env.HC_TERMINAL_ID;
  const socket = socketPath(env);
  if (!caller || !socket)
    throw new Error(
      "the Herdr app runtime needs HC_TERMINAL_ID and HC_TERMINAL_SOCKET; run inside a Herdr app terminal"
    );
  return { caller, socket };
}

function rpcError(method: string, error: unknown): HcError {
  if (typeof error !== "object" || error === null)
    return new HcError(method, String(error), undefined);
  const record = error as Record<string, unknown>;
  const data = (
    typeof record.data === "object" && record.data !== null ? record.data : {}
  ) as Record<string, unknown>;
  const kind = typeof data.kind === "string" ? data.kind : undefined;
  const detail = [record.message, data.hint ?? data.message]
    .filter((part) => typeof part === "string" && part !== "")
    .join(": ");
  return new HcError(method, detail || JSON.stringify(error), kind);
}

// One JSON-RPC request per connection, one message per line. A connection that
// ends before the answer fails at once rather than at the timeout.
export function socketRpc(
  path: string,
  env: NodeJS.ProcessEnv = process.env
): HcRpc {
  return (method, params) =>
    new Promise((done, fail) => {
      const socket = connect(path);
      let settled = false;
      const settle = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        outcome();
      };
      const timer = setTimeout(
        () =>
          settle(() =>
            fail(
              new HcError(
                method,
                `no answer within ${RPC_TIMEOUT_MS} ms`,
                "timeout"
              )
            )
          ),
        RPC_TIMEOUT_MS
      );
      socket.on("connect", () =>
        socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`
        )
      );
      socket.on("error", (error) =>
        settle(() =>
          fail(
            new HcError(method, sandboxHint(error.message, env), "unavailable")
          )
        )
      );
      socket.on("close", () =>
        settle(() =>
          fail(
            new HcError(
              method,
              "herdr-core closed the connection without answering",
              "unavailable"
            )
          )
        )
      );
      onJsonLines(socket, (message) => {
        if (message.id !== 1) return;
        if (message.error !== undefined)
          settle(() => fail(rpcError(method, message.error)));
        else settle(() => done(message.result));
      });
    });
}

export function parseTerminal(value: unknown): Terminal {
  const record = asObject(value, "hc terminal");
  const address = record.address;
  if (typeof address !== "string" || address === "")
    throw new Error("hc terminal has no address");
  return {
    address,
    name: typeof record.name === "string" ? record.name : null,
    state: typeof record.state === "string" ? record.state : "live",
    turn: typeof record.turn === "number" ? record.turn : 0,
    status:
      typeof record.status === "object" && record.status !== null
        ? (record.status as { state?: string })
        : null,
    labels:
      typeof record.labels === "object" && record.labels !== null
        ? (record.labels as Record<string, string>)
        : {},
    pid: typeof record.pid === "number" ? record.pid : null,
    reason: typeof record.reason === "string" ? record.reason : null,
  };
}

// The app keeps the terminals it shows, so a worker whose program dies is not
// finished: it stays live with a `reason` until herdr-core swaps in a shell, which
// then runs under a new pid.
export function workerLost(terminal: Terminal): boolean {
  if (terminal.state !== "live") return false;
  if (terminal.reason !== null) return true;
  const launched = terminal.labels[PID_LABEL];
  return (
    launched !== undefined &&
    terminal.pid !== null &&
    String(terminal.pid) !== launched
  );
}

// A worker runs one task: its launch prompt. `turn` goes up each time the CLI's own
// status leaves `working`, so a finished task is a turn above zero that is no longer
// working. A CLI that reports `idle` while still booting (Codex does) has turn 0.
// Undefined means the worker is still on its task.
export function settledStatus(terminal: Terminal): AppStatus | undefined {
  if (terminal.state === "finished" || workerLost(terminal)) return "exited";
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
  if (env.PSTACK_HERDR_ROUTES)
    out.PSTACK_HERDR_ROUTES = env.PSTACK_HERDR_ROUTES;
  for (const [key, value] of checkedEnv(worker.childEnv)) out[key] = value;
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

// The config-home variables of herdr-core's own environment, which every worker
// inherits. Unreadable counts as unset.
export async function coreConfigHomes(rpc: HcRpc): Promise<NodeJS.ProcessEnv> {
  const keys = new Set<string>(
    Object.values(CONFIG_HOMES).map((home) => home.key)
  );
  try {
    const result = asObject(
      await rpc("machine.exec", { argv: ["/usr/bin/env"], timeout: 10 }),
      "hc machine.exec"
    );
    const text = Buffer.from(String(result.stdout ?? ""), "base64").toString(
      "utf8"
    );
    const homes: NodeJS.ProcessEnv = {};
    for (const line of text.split("\n")) {
      const at = line.indexOf("=");
      const key = line.slice(0, at);
      if (at > 0 && keys.has(key)) homes[key] = line.slice(at + 1);
    }
    return homes;
  } catch {
    return {};
  }
}

async function getTerminal(
  rpc: HcRpc,
  caller: string,
  name: string
): Promise<Terminal> {
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

async function readOutput(
  rpc: HcRpc,
  caller: string,
  name: string
): Promise<string> {
  const result = asObject(
    await rpc("terminal.read", { terminal: name, caller, lines: OUTPUT_LINES }),
    "hc terminal.read"
  );
  return typeof result.text === "string" ? tidyScreen(result.text) : "";
}

async function screen(
  rpc: HcRpc,
  caller: string,
  name: string
): Promise<string> {
  try {
    return await readOutput(rpc, caller, name);
  } catch {
    return "";
  }
}

// Ends and removes a worker's terminal, and succeeds if it is already gone. A finished
// one only needs removing; a program that ends on its own between the read and the
// kill makes the kill fail, which is fine.
export async function closeTerminal(
  rpc: HcRpc,
  caller: string,
  address: string,
  finished = false
): Promise<void> {
  const gone = (error: unknown, kinds: string[]) =>
    error instanceof HcError &&
    error.kind !== undefined &&
    kinds.includes(error.kind);
  if (!finished) {
    try {
      await rpc("terminal.kill", { terminal: address, caller });
    } catch (error) {
      if (!gone(error, ["finished", "not_found"])) throw error;
    }
  }
  try {
    await rpc("terminal.rm", { terminal: address, caller });
  } catch (error) {
    // Signal cleanup and the wait loop can both close the same worker.
    if (!gone(error, ["not_found"])) throw error;
  }
}

async function finish(
  rpc: HcRpc,
  caller: string,
  terminal: Terminal,
  status: AppStatus,
  keepPane: boolean
): Promise<AppSettlement> {
  const output = await readOutput(rpc, caller, terminal.address);
  const closes =
    (status === "done" || status === "idle" || status === "exited") &&
    !keepPane;
  if (closes)
    await closeTerminal(
      rpc,
      caller,
      terminal.address,
      terminal.state === "finished"
    );
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
      await watcher.changed(
        Math.min(watcher.live ? WATCH_HEARTBEAT_MS : POLL_MS, left)
      );
    }
  } finally {
    watcher.close();
  }
}

// herdr-core pushes every fact change; status, turn, and exit changes on a watched
// terminal are cues to read it again. Title changes (spinners) are not. One terminal
// is filtered by herdr-core; several are filtered here.
export function watchTerminals(
  terminals: string[],
  env: NodeJS.ProcessEnv
): Promise<StatusWatch> {
  const watched = new Set(terminals);
  return socketWatch(
    socketPath(env),
    {
      jsonrpc: "2.0",
      id: WATCH_ID,
      method: "events.subscribe",
      params: terminals.length === 1 ? { terminal: terminals[0] } : {},
    },
    (message, started) => {
      if (!started) {
        if (message.id !== WATCH_ID) return "skip";
        return message.error === undefined ? "start" : "fail";
      }
      if (message.method === "missed") return "wake";
      const params = message.params as
        | { type?: unknown; terminal?: unknown }
        | undefined;
      return message.method === "event" &&
        typeof params?.terminal === "string" &&
        watched.has(params.terminal) &&
        WAKING_EVENTS.has(String(params.type))
        ? "wake"
        : "skip";
    }
  );
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
  const worker = planWorker(options, env, await coreConfigHomes(rpc));
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
  if (started.pid !== null)
    await rpc("terminal.label", {
      terminal: started.address,
      caller,
      labels: { [PID_LABEL]: String(started.pid) },
    });
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
  options: {
    name: string;
    timeout?: number;
    keepPane: boolean;
    routes?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  rpc: HcRpc = socketRpc(requireApp(env).socket, env),
  watch: AppWatcher = watchTerminals,
  onOwned: (name: string | undefined) => void = () => {}
): Promise<AppCollectResult> {
  const { caller } = requireApp(env);
  const timeout = defaultTimeout(
    loadRoutes(options.routes, env),
    options.timeout
  );
  const terminal = await getTerminal(rpc, caller, options.name);
  const kind = workerKind(terminal, options.name);
  onOwned(terminal.address);
  return {
    agent: options.name,
    terminal: terminal.address,
    kind,
    ...(await awaitWorker(
      rpc,
      caller,
      terminal.address,
      timeout,
      options.keepPane,
      env,
      watch
    )),
  };
}

interface NextWorker {
  name: string;
  address: string;
  kind: AgentKind;
}

export async function nextApp(
  options: {
    names: string[];
    timeout?: number;
    keepPane: boolean;
    routes?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  rpc: HcRpc = socketRpc(requireApp(env).socket, env),
  watch: AppWatcher = watchTerminals
): Promise<AppNextResult> {
  const { caller } = requireApp(env);
  const names = nextNames(options.names);
  const deadline =
    Date.now() +
    defaultTimeout(loadRoutes(options.routes, env), options.timeout);
  return firstSettled<NextWorker, AppCollectResult>(names, deadline, {
    async locate(name) {
      const terminal = await getTerminal(rpc, caller, name);
      return {
        name,
        address: terminal.address,
        kind: workerKind(terminal, name),
      };
    },
    watch: (workers) =>
      watch(
        workers.map((worker) => worker.address),
        env
      ),
    async probe(worker) {
      const terminal = await getTerminal(rpc, caller, worker.address);
      const status = settledStatus(terminal);
      if (!status) return undefined;
      return {
        agent: worker.name,
        terminal: worker.address,
        kind: worker.kind,
        ...(await finish(rpc, caller, terminal, status, options.keepPane)),
      };
    },
    pause: (_pending, live) => (live ? WATCH_HEARTBEAT_MS : POLL_MS),
  });
}

// An interrupted dispatch or collect ends its worker over the same socket the
// dispatch used, so cleanup does not depend on the `hc` binary being on PATH.
export function closeAppOnSignal(
  env: NodeJS.ProcessEnv = process.env
): (terminal: string | undefined) => void {
  const { caller, socket } = requireApp(env);
  const rpc = socketRpc(socket, env);
  return closeOnSignal((terminal) => closeTerminal(rpc, caller, terminal));
}
