#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDependenciesInstalled } from "./bootstrap.ts";
import {
  expandHome,
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
  wait: boolean;
  timeout?: number;
  readonly: boolean;
  direction: "right" | "down";
  routes?: string;
}

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
  output: string;
}

export type DispatchResult = DispatchHandle | DispatchSettled;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type HerdrExec = (args: string[]) => Promise<CommandResult>;

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

function agentStartTail(
  kind: AgentKind,
  model: string | undefined,
  readonly: boolean
): string[] {
  const args = readonly ? readonlyAgentArgs(kind) : [];
  if (model && model !== "inherit" && model !== "auto") args.push("--model", model);
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

async function runHerdrCommand(
  args: string[],
  exec: HerdrExec = spawnHerdr
): Promise<CommandResult> {
  const result = await exec(args);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
    throw new Error(`herdr ${args.join(" ")} failed: ${detail}`);
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
      `herdr ${args.join(" ")} returned non-JSON output where JSON was expected: ${text}`,
      { cause: error }
    );
  }
}

async function runHerdrText(args: string[], exec: HerdrExec = spawnHerdr): Promise<string> {
  const result = await runHerdrCommand(args, exec);
  return result.stdout.replace(/\s+$/, "");
}

export function paneId(payload: unknown): string {
  const root = asObject(payload, "herdr pane split");
  const pane = asObject(asObject(root.result, "result").pane, "result.pane");
  const id = pane.pane_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Herdr pane split returned no result.pane.pane_id");
  }
  return id;
}

export function agentStatus(payload: unknown): AgentStatus {
  const root = asObject(payload, "herdr agent get");
  const agent = asObject(asObject(root.result, "result").agent, "result.agent");
  return parseAgentStatus(agent.agent_status);
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

export function isPaneNotReady(message: string): boolean {
  return PANE_NOT_READY.test(message);
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
    // Keep the original start/prompt error; a failed cleanup must not replace it.
  }
}

export async function dispatch(
  options: DispatchOptions,
  env: NodeJS.ProcessEnv = process.env,
  exec: HerdrExec = spawnHerdr
): Promise<DispatchResult> {
  if (env.HERDR_ENV !== "1") throw new Error("herdr-dispatch requires HERDR_ENV=1");
  if (!AGENT_NAME.test(options.name)) throw new Error("--name must match [a-z][a-z0-9_-]{0,31}");
  const config = loadRoutes(options.routes, env);
  const chosen = chooseProfile(config, options, env);
  const nesting = depth(config, env);
  const timeout =
    optionalNonNegativeInt(options.timeout, "--timeout") ??
    config.orchestration?.default_timeout_ms ??
    180000;
  const prompt = applyReadonlyPrompt(resolvedPrompt(options), options.readonly);
  const childEnv = {
    ...(chosen.profile.env ?? {}),
    PSTACK_HERDR_DEPTH: String(nesting.next),
    PSTACK_HERDR_PARENT_KIND: chosen.profile.kind,
  };
  const splitArgs = [
    "pane",
    "split",
    "--current",
    "--direction",
    options.direction,
    "--cwd",
    resolve(options.cwd),
    "--no-focus",
    ...envFlags(childEnv),
  ];
  const pane = paneId(await runHerdrJson(splitArgs, exec));
  const startArgs = [
    "agent",
    "start",
    options.name,
    "--kind",
    chosen.profile.kind,
    "--pane",
    pane,
    "--timeout",
    String(timeout),
    ...agentStartTail(chosen.profile.kind, options.model ?? chosen.profile.model, options.readonly),
  ];
  const promptArgs = ["agent", "prompt", options.name, prompt];
  if (options.wait) promptArgs.push("--wait", "--timeout", String(timeout));
  try {
    await startAgent(startArgs, exec);
    await runHerdrCommand(promptArgs, exec);
  } catch (error) {
    await closePane(pane, exec);
    throw error;
  }
  const handle: DispatchHandle = {
    agent: options.name,
    pane,
    profile: chosen.name,
    kind: chosen.profile.kind,
    depth: nesting.next,
  };
  if (!options.wait) return handle;
  const status = agentStatus(await runHerdrJson(["agent", "get", options.name], exec));
  const output = await runHerdrText(
    ["agent", "read", options.name, "--source", "recent-unwrapped", "--lines", "240"],
    exec
  );
  return { ...handle, status, blocked: status === "blocked", output };
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
    .option("--wait", "wait for settled worker state and read output", false)
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
    .option("--routes <path>", "routes YAML/JSON path");
  program.parse(process.argv);
  const options = program.opts<DispatchOptions>();
  if (options.kind && options.kind !== "claude" && options.kind !== "codex") {
    throw new Error("--kind must be claude or codex");
  }
  if (options.direction !== "right" && options.direction !== "down") {
    throw new Error("--direction must be right or down");
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
