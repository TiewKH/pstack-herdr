#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ensureDependenciesInstalled } from "./bootstrap.ts";
import {
  CONFIG_HOMES,
  expandHome,
  isDefaultConfigHome,
  loadRoutes,
  type AgentKind,
  type Profile,
  type RoutesConfig,
} from "./herdr-config.ts";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface DispatchOptions {
  role: string;
  name: string;
  prompt?: string;
  promptFile?: string;
  cwd: string;
  profile?: string;
  kind?: AgentKind;
  model?: string;
  effort?: string;
  wait: boolean;
  keepPane: boolean;
  timeout?: number;
  readonly: boolean;
  direction: "right" | "down";
  placement: Placement;
  routes?: string;
}

export type Placement = "tab" | "split";

export interface DispatchHandle {
  agent: string;
  pane: string;
  profile: string;
  kind: AgentKind;
  depth: number;
}

export interface DispatchSettled extends DispatchHandle {
  status: AgentStatus;
  blocked: boolean;
  paneClosed: boolean;
  output: string;
}

export type DispatchResult = DispatchHandle | DispatchSettled;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type HerdrExec = (args: string[]) => Promise<CommandResult>;

export interface TurnEvidenceQuery {
  kind: AgentKind;
  prompt: string;
  since: number;
  sessionId?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

// True when a worker transcript written since `since` records the prompt.
export type TurnEvidence = (query: TurnEvidenceQuery) => boolean;

export class HerdrError extends Error {
  readonly command: string;
  readonly code: string | undefined;

  constructor(command: string, detail: string, code: string | undefined) {
    super(`herdr ${command} failed: ${detail}`);
    this.name = "HerdrError";
    this.command = command;
    this.code = code;
  }
}

export interface DispatchPlan {
  profile: string;
  kind: AgentKind;
  depth: number;
  timeout: number;
  startTimeout: number;
  deliveryWindow: number;
  prompt: string;
  placeArgs: string[];
  startTail: string[];
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
// A freshly split pane needs a moment to reach its interactive shell prompt, and
// `herdr agent start` rejects the pane until it does. Herdr's own readiness wait
// defaults to 30s, so give the shell the same budget.
const SHELL_READY_TIMEOUT_MS = 30000;
const SHELL_READY_POLL_MS = 250;
const PANE_NOT_READY = /agent_pane_busy|not an available shell/;
const READONLY_PREFIX =
  "Read-only worker. Do not write files, commit, or mutate the workspace.\n\n";
const SCREEN_LINES = 24;
// `herdr agent start` rejects a larger timeout outright; the wait budget is not capped.
const START_TIMEOUT_MAX_MS = 300000;
// A prompt typed into a CLI that is still starting is lost, and Herdr's own `--wait`
// then matches the startup turn's completion over an empty composer. So the dispatcher
// waits for idle before typing and counts the prompt delivered once the agent leaves idle.
const DELIVERY_WINDOW_MS = 8000;
const DELIVERY_POLL_MS = 500;
const PROMPT_ATTEMPTS = 2;
const LONG_ARG_CHARS = 120;
// Herdr reads a pane that never ran its prompt as `done`: a CLI that booted but stalled
// (the machine slept mid-dispatch) shows a static banner, which the status classifier
// takes for a finished turn. The transcript the CLI writes is the ground truth, so a
// `done` or `idle` verdict is only believed when one written after the prompt contains it.
const EVIDENCE_SKEW_MS = 2000;
const EVIDENCE_NEEDLE_CHARS = 120;

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalNonNegativeInt(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

export function parseAgentStatus(value: unknown): AgentStatus {
  switch (value) {
    case "idle":
    case "working":
    case "blocked":
    case "done":
    case "unknown":
      return value;
    default:
      throw new Error(
        `Herdr agent get returned invalid result.agent.agent_status: ${String(value)}`
      );
  }
}

function parseNonNegativeInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a non-negative integer`);
  return Number(raw);
}

export function stableIndex(seed: string, size: number): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

export function selectProfileName(
  config: RoutesConfig,
  role: string,
  workerName: string
): string | undefined {
  const route = config.roles?.[role];
  const pool = route?.profiles ?? [];
  if (pool.length === 0) return undefined;
  const strategy = route?.strategy ?? "first";
  switch (strategy) {
    case "spread":
      return pool[stableIndex(workerName, pool.length)];
    case "first":
      return pool[0];
    default: {
      const exhaustive: never = strategy;
      throw new Error(`unhandled route strategy: ${String(exhaustive)}`);
    }
  }
}

export function inferParentKind(env: NodeJS.ProcessEnv = process.env): AgentKind | undefined {
  const explicit = env.PSTACK_HERDR_PARENT_KIND;
  if (explicit === "claude" || explicit === "codex") return explicit;
  if (env.CLAUDECODE === "1" || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CONFIG_DIR) return "claude";
  if (env.CODEX_THREAD_ID || env.CODEX_HOME) return "codex";
  return undefined;
}

export function envFlags(env: Record<string, string>): string[] {
  const flags: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_NAME.test(key)) throw new Error(`invalid environment variable name: ${key}`);
    if (/[\r\n]/.test(value)) throw new Error(`environment ${key} contains a newline`);
    flags.push("--env", `${key}=${expandHome(value)}`);
  }
  return flags;
}

export function readonlyAgentArgs(kind: AgentKind): string[] {
  switch (kind) {
    case "claude":
      return ["--disallowedTools", "Write,Edit"];
    case "codex":
      return ["--sandbox", "read-only"];
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled agent kind: ${String(exhaustive)}`);
    }
  }
}

export function applyReadonlyPrompt(prompt: string, readonly: boolean): string {
  return readonly ? `${READONLY_PREFIX}${prompt}` : prompt;
}

// Claude Code moves its onboarding state to `$CLAUDE_CONFIG_DIR/.claude.json` once the
// variable is set, so a worker given the default home boots into first-run onboarding.
// The default is dropped only when the pane would inherit it anyway; an ambient value
// naming another account must still be overridden.
export function workerEnv(
  kind: AgentKind,
  profileEnv: Record<string, string> = {},
  home: string = homedir(),
  ambient: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env = { ...profileEnv };
  const { key } = CONFIG_HOMES[kind];
  const value = env[key];
  if (value === undefined || !isDefaultConfigHome(kind, value, home)) return env;
  const inherited = ambient[key];
  if (inherited === undefined || isDefaultConfigHome(kind, inherited, home)) delete env[key];
  return env;
}

export function effortAgentArgs(kind: AgentKind, effort: string | undefined): string[] {
  if (!effort) return [];
  switch (kind) {
    case "claude":
      return ["--effort", effort];
    case "codex":
      return ["-c", `model_reasoning_effort="${effort}"`];
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled agent kind: ${String(exhaustive)}`);
    }
  }
}

function agentStartTail(
  kind: AgentKind,
  model: string | undefined,
  effort: string | undefined,
  readonly: boolean
): string[] {
  const args = readonly ? readonlyAgentArgs(kind) : [];
  if (model && model !== "inherit" && model !== "auto") args.push("--model", model);
  args.push(...effortAgentArgs(kind, effort));
  return args.length === 0 ? [] : ["--", ...args];
}

async function spawnHerdr(args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(["herdr", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

// A prompt body can run to kilobytes; the error names its size, not its text.
function argSummary(args: string[]): string {
  return args.map((arg) => (arg.length > LONG_ARG_CHARS ? `<${arg.length} chars>` : arg)).join(" ");
}

function herdrErrorCode(detail: string): string | undefined {
  try {
    const error = asObject(asObject(JSON.parse(detail), "herdr error").error, "error");
    return typeof error.code === "string" ? error.code : undefined;
  } catch {
    return undefined;
  }
}

async function runHerdrCommand(
  args: string[],
  exec: HerdrExec = spawnHerdr
): Promise<CommandResult> {
  const result = await exec(args);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
    throw new HerdrError(argSummary(args), detail, herdrErrorCode(detail));
  }
  return result;
}

async function runHerdrJson(args: string[], exec: HerdrExec = spawnHerdr): Promise<unknown> {
  const result = await runHerdrCommand(args, exec);
  const text = result.stdout.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `herdr ${argSummary(args)} returned non-JSON output where JSON was expected: ${text}`,
      { cause: error }
    );
  }
}

async function runHerdrText(args: string[], exec: HerdrExec = spawnHerdr): Promise<string> {
  const result = await runHerdrCommand(args, exec);
  return result.stdout.replace(/\s+$/, "");
}

// `pane split` reports the new pane as result.pane; `tab create` reports it as
// result.root_pane. Everything downstream only needs the id.
export function paneId(payload: unknown, placement: Placement = "split"): string {
  const key = placement === "tab" ? "root_pane" : "pane";
  const command = placement === "tab" ? "herdr tab create" : "herdr pane split";
  const root = asObject(payload, command);
  const pane = asObject(asObject(root.result, "result")[key], `result.${key}`);
  const id = pane.pane_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${command} returned no result.${key}.pane_id`);
  }
  return id;
}

export function agentStatus(payload: unknown): AgentStatus {
  const root = asObject(payload, "herdr agent get");
  const agent = asObject(asObject(root.result, "result").agent, "result.agent");
  return parseAgentStatus(agent.agent_status);
}

// Herdr reports a Claude worker's session id, which names its transcript file.
export function agentSessionId(payload: unknown): string | undefined {
  try {
    const root = asObject(payload, "herdr agent get");
    const agent = asObject(asObject(root.result, "result").agent, "result.agent");
    const session = agent.agent_session;
    if (typeof session !== "object" || session === null) return undefined;
    const value = (session as Record<string, unknown>).value;
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

// The prompt's first line, JSON-escaped as a transcript stores it. The read-only prefix
// is skipped because every read-only worker shares it.
export function promptNeedle(prompt: string): string {
  const body = prompt.startsWith(READONLY_PREFIX) ? prompt.slice(READONLY_PREFIX.length) : prompt;
  const firstLine = body.split("\n").find((line) => line.trim() !== "") ?? "";
  return JSON.stringify(firstLine.slice(0, EVIDENCE_NEEDLE_CHARS)).slice(1, -1);
}

function configHome(kind: AgentKind, env: NodeJS.ProcessEnv, home: string): string {
  const { key, defaultDir } = CONFIG_HOMES[kind];
  const raw = env[key];
  return raw ? resolve(expandHome(raw, home)) : resolve(home, defaultDir);
}

function transcriptsSince(root: string, since: number): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(path);
      else if (entry.endsWith(".jsonl") && stats.mtimeMs >= since) found.push(path);
    }
  };
  walk(root);
  return found;
}

// Codex writes `$CODEX_HOME/sessions/<date>/rollout-*.jsonl`; Claude writes
// `$CLAUDE_CONFIG_DIR/projects/<cwd-slug>/<session-id>.jsonl`. Both store the user
// turn as a JSON string, so the escaped first line of the prompt is what to look for.
// Two concurrent workers given the same first line and the same CLI can vouch for each
// other; a Claude worker is pinned to its own session id when Herdr reports one.
export function turnEvidence(query: TurnEvidenceQuery): boolean {
  const env = query.env ?? process.env;
  const home = query.home ?? homedir();
  const root =
    query.kind === "codex"
      ? join(configHome("codex", env, home), "sessions")
      : join(configHome("claude", env, home), "projects");
  const needle = promptNeedle(query.prompt);
  if (needle === "") return true;
  const files = transcriptsSince(root, query.since);
  const candidates = query.sessionId
    ? files.filter((file) => basename(file) === `${query.sessionId}.jsonl`)
    : files;
  return candidates.some((file) => {
    try {
      return readFileSync(file, "utf8").includes(needle);
    } catch {
      return false;
    }
  });
}

function resolvedPrompt(options: DispatchOptions): string {
  if (options.prompt && options.promptFile) {
    throw new Error("use either --prompt or --prompt-file, not both");
  }
  if (options.promptFile) return readFileSync(resolve(options.promptFile), "utf8");
  if (options.prompt) return options.prompt;
  throw new Error("set --prompt or --prompt-file");
}

function depth(config: RoutesConfig, env: NodeJS.ProcessEnv = process.env): {
  current: number;
  next: number;
  max: number;
} {
  const current = parseNonNegativeInt(env.PSTACK_HERDR_DEPTH, 0, "PSTACK_HERDR_DEPTH");
  const max = config.orchestration?.max_depth ?? 3;
  if (current >= max) {
    throw new Error(`Herdr delegation depth ${current} reached configured max_depth ${max}`);
  }
  return { current, next: current + 1, max };
}

function chooseProfile(
  config: RoutesConfig,
  options: DispatchOptions,
  env: NodeJS.ProcessEnv = process.env
): { name: string; profile: Profile } {
  if (options.profile) {
    const profile = config.profiles?.[options.profile];
    if (!profile) throw new Error(`unknown Herdr route profile: ${options.profile}`);
    return { name: options.profile, profile };
  }
  const routedName = selectProfileName(config, options.role, options.name);
  if (routedName) {
    const profile = config.profiles?.[routedName];
    if (!profile) throw new Error(`role ${options.role} references unknown profile ${routedName}`);
    return { name: routedName, profile };
  }
  const kind = options.kind ?? inferParentKind(env);
  if (!kind) {
    throw new Error(
      "no route matched and parent CLI could not be inferred; set --kind claude|codex or PSTACK_HERDR_PARENT_KIND"
    );
  }
  return { name: "parent", profile: { kind, model: options.model ?? "inherit", env: {} } };
}

// A background tab keeps the worker off the caller's screen; a split puts it
// beside the caller, which is what you want when watching the worker matters.
export function placementArgs(
  options: Pick<DispatchOptions, "placement" | "direction" | "name">,
  cwd: string,
  env: string[]
): string[] {
  switch (options.placement) {
    case "tab":
      return ["tab", "create", "--cwd", cwd, "--label", options.name, "--no-focus", ...env];
    case "split":
      return [
        "pane",
        "split",
        "--current",
        "--direction",
        options.direction,
        "--cwd",
        cwd,
        "--no-focus",
        ...env,
      ];
    default: {
      const exhaustive: never = options.placement;
      throw new Error(`unhandled placement: ${String(exhaustive)}`);
    }
  }
}

// Everything the dispatch needs to know before it talks to Herdr.
export function planDispatch(
  options: DispatchOptions,
  env: NodeJS.ProcessEnv = process.env
): DispatchPlan {
  if (env.HERDR_ENV !== "1") throw new Error("herdr-dispatch requires HERDR_ENV=1");
  if (!AGENT_NAME.test(options.name)) throw new Error("--name must match [a-z][a-z0-9_-]{0,31}");
  const config = loadRoutes(options.routes, env);
  const chosen = chooseProfile(config, options, env);
  const nesting = depth(config, env);
  const timeout =
    optionalNonNegativeInt(options.timeout, "--timeout") ??
    config.orchestration?.default_timeout_ms ??
    180000;
  const kind = chosen.profile.kind;
  const childEnv = {
    ...workerEnv(kind, chosen.profile.env, homedir(), env),
    PSTACK_HERDR_DEPTH: String(nesting.next),
    PSTACK_HERDR_PARENT_KIND: kind,
  };
  return {
    profile: chosen.name,
    kind,
    depth: nesting.next,
    timeout,
    startTimeout: Math.min(timeout, START_TIMEOUT_MAX_MS),
    deliveryWindow: parseNonNegativeInt(
      env.PSTACK_HERDR_DELIVERY_WINDOW_MS,
      DELIVERY_WINDOW_MS,
      "PSTACK_HERDR_DELIVERY_WINDOW_MS"
    ),
    prompt: applyReadonlyPrompt(resolvedPrompt(options), options.readonly),
    placeArgs: placementArgs(options, resolve(options.cwd), envFlags(childEnv)),
    startTail: agentStartTail(
      kind,
      options.model ?? chosen.profile.model,
      options.effort ?? chosen.profile.effort,
      options.readonly
    ),
  };
}

function startArgs(name: string, pane: string, plan: DispatchPlan): string[] {
  return [
    "agent",
    "start",
    name,
    "--kind",
    plan.kind,
    "--pane",
    pane,
    "--timeout",
    String(plan.startTimeout),
    ...plan.startTail,
  ];
}

export function isPaneNotReady(message: string): boolean {
  return PANE_NOT_READY.test(message);
}

// `agent wait` reports `timeout` when the caller's budget runs out; the worker is
// still running and its pane must stay open.
export function isWaitTimeout(error: unknown): boolean {
  return error instanceof HerdrError && error.code === "timeout";
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function startAgent(args: string[], exec: HerdrExec): Promise<void> {
  const deadline = Date.now() + SHELL_READY_TIMEOUT_MS;
  for (;;) {
    try {
      await runHerdrCommand(args, exec);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isPaneNotReady(message) || Date.now() >= deadline) throw error;
      await sleep(SHELL_READY_POLL_MS);
    }
  }
}

async function closePane(pane: string, exec: HerdrExec): Promise<void> {
  try {
    await runHerdrCommand(["pane", "close", pane], exec);
  } catch {
    // Keep the original error; a failed cleanup must not replace it.
  }
}

async function visibleScreen(name: string, exec: HerdrExec): Promise<string> {
  try {
    return await runHerdrText(
      ["agent", "read", name, "--source", "visible", "--lines", String(SCREEN_LINES)],
      exec
    );
  } catch {
    return "";
  }
}

async function settleBeforePrompt(name: string, timeout: number, exec: HerdrExec): Promise<void> {
  try {
    await runHerdrCommand(
      ["agent", "wait", name, "--until", "idle", "--until", "blocked", "--timeout", String(timeout)],
      exec
    );
  } catch {
    // A start that never reports idle still gets the prompt; Herdr reports its own errors then.
  }
}

async function leftIdle(name: string, windowMs: number, exec: HerdrExec): Promise<boolean> {
  const deadline = Date.now() + windowMs;
  for (;;) {
    const status = agentStatus(await runHerdrJson(["agent", "get", name], exec));
    if (status === "working" || status === "blocked" || status === "done") return true;
    if (Date.now() >= deadline) return false;
    await sleep(DELIVERY_POLL_MS);
  }
}

async function deliverPrompt(
  name: string,
  prompt: string,
  windowMs: number,
  exec: HerdrExec
): Promise<void> {
  for (let attempt = 1; attempt <= PROMPT_ATTEMPTS; attempt += 1) {
    await runHerdrCommand(["agent", "prompt", name, prompt], exec);
    if (await leftIdle(name, windowMs, exec)) return;
  }
  throw new Error(
    `prompt to ${name} was not delivered after ${PROMPT_ATTEMPTS} attempts: the agent never left idle`
  );
}

// A failure to read the worker's own state leaves its pane open for inspection.
function leavesPaneOpen(error: unknown): boolean {
  return error instanceof HerdrError && error.command.startsWith("agent get ");
}

function withScreen(error: unknown, screen: string): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  if (!screen.trim()) return base;
  return new Error(`${base.message}\nworker screen before the pane closed:\n${screen}`, {
    cause: base,
  });
}

export async function dispatch(
  options: DispatchOptions,
  env: NodeJS.ProcessEnv = process.env,
  exec: HerdrExec = spawnHerdr,
  evidence: TurnEvidence = turnEvidence
): Promise<DispatchResult> {
  const plan = planDispatch(options, env);
  const pane = paneId(await runHerdrJson(plan.placeArgs, exec), options.placement);
  let promptedAt = Date.now();
  try {
    await startAgent(startArgs(options.name, pane, plan), exec);
    await settleBeforePrompt(options.name, plan.startTimeout, exec);
    promptedAt = Date.now();
    await deliverPrompt(options.name, plan.prompt, plan.deliveryWindow, exec);
  } catch (error) {
    if (leavesPaneOpen(error)) throw error;
    const screen = await visibleScreen(options.name, exec);
    await closePane(pane, exec);
    throw withScreen(error, screen);
  }
  const handle: DispatchHandle = {
    agent: options.name,
    pane,
    profile: plan.profile,
    kind: plan.kind,
    depth: plan.depth,
  };
  if (!options.wait) return handle;
  try {
    await runHerdrCommand(["agent", "wait", options.name, "--timeout", String(plan.timeout)], exec);
  } catch (error) {
    if (!isWaitTimeout(error)) throw error;
  }
  const agent = await runHerdrJson(["agent", "get", options.name], exec);
  const status = agentStatus(agent);
  if (status === "done" || status === "idle") {
    const ran = evidence({
      kind: plan.kind,
      prompt: plan.prompt,
      since: promptedAt - EVIDENCE_SKEW_MS,
      sessionId: agentSessionId(agent),
      env,
    });
    if (!ran) {
      const screen = await visibleScreen(options.name, exec);
      await closePane(pane, exec);
      throw withScreen(
        new Error(
          `${options.name} reports ${status}, but no ${plan.kind} transcript written since ` +
            `${new Date(promptedAt).toISOString()} records the prompt: the worker never ran it`
        ),
        screen
      );
    }
  }
  // Herdr refuses an unwrapped read while the agent is working; the screen is all there is.
  const output =
    status === "working"
      ? await visibleScreen(options.name, exec)
      : await runHerdrText(
          ["agent", "read", options.name, "--source", "recent-unwrapped", "--lines", "240"],
          exec
        );
  const paneClosed = (status === "done" || status === "idle") && !options.keepPane;
  if (paneClosed) await runHerdrCommand(["pane", "close", pane], exec);
  return { ...handle, status, blocked: status === "blocked", paneClosed, output };
}

async function main(): Promise<void> {
  ensureDependenciesInstalled();
  const { Command } = await import("commander");
  const program = new Command("herdr-dispatch")
    .description("Deterministic pstack delegation through Herdr")
    .requiredOption("--role <role>", "semantic pstack role")
    .requiredOption("--name <name>", "unique Herdr agent name")
    .option("--prompt <text>", "worker prompt")
    .option("--prompt-file <path>", "read worker prompt from a file")
    .option("--cwd <path>", "worker cwd/worktree", process.cwd())
    .option("--profile <name>", "force a configured route profile")
    .option("--kind <kind>", "fallback agent kind, claude or codex")
    .option("--model <slug>", "override model passed to the worker CLI")
    .option("--effort <level>", "override reasoning effort passed to the worker CLI")
    .option("--wait", "wait for settled worker state and read output", false)
    .option("--keep-pane", "keep a completed worker pane open after --wait", false)
    .option(
      "--timeout <ms>",
      "timeout in milliseconds for agent start and --wait",
      (value: string) => {
        if (!/^\d+$/.test(value)) throw new Error("--timeout must be a non-negative integer");
        return Number(value);
      }
    )
    .option("--readonly", "disable write tools on the worker CLI", false)
    .option("--direction <direction>", "pane split direction", "right")
    .option(
      "--placement <placement>",
      "tab for a background tab, split to sit beside the caller",
      "tab"
    )
    .option("--routes <path>", "routes YAML/JSON path");
  program.parse(process.argv);
  const options = program.opts<DispatchOptions>();
  if (options.kind && options.kind !== "claude" && options.kind !== "codex") {
    throw new Error("--kind must be claude or codex");
  }
  if (options.direction !== "right" && options.direction !== "down") {
    throw new Error("--direction must be right or down");
  }
  if (options.placement !== "tab" && options.placement !== "split") {
    throw new Error("--placement must be tab or split");
  }
  const result = await dispatch(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
