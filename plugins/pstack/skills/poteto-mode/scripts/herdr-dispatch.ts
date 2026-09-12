#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { ensureDependenciesInstalled } from "./bootstrap.ts";

export type AgentKind = "claude" | "codex";
export type RouteStrategy = "spread" | "first";

export interface Profile {
  kind: AgentKind;
  model?: string;
  env?: Record<string, string>;
}

export interface RoleRoute {
  profiles: string[];
  strategy?: RouteStrategy;
}

export interface RoutesConfig {
  orchestration?: { max_depth?: number; default_timeout_ms?: number };
  profiles?: Record<string, Profile>;
  roles?: Record<string, RoleRoute>;
}

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
  status: string;
  blocked: boolean;
  output: string;
}

export type DispatchResult = DispatchHandle | DispatchSettled;

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const READONLY_PREFIX =
  "Read-only worker. Do not write files, commit, or mutate the workspace.\n\n";

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalNonNegativeInt(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function parseAgentKind(value: unknown, label: string): AgentKind {
  if (value === "claude" || value === "codex") return value;
  throw new Error(`${label} must be claude or codex`);
}

function parseStrategy(value: unknown, label: string): RouteStrategy {
  if (value === undefined) return "first";
  if (value === "spread" || value === "first") return value;
  throw new Error(`${label} must be spread or first`);
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

export function parseRoutes(text: string): RoutesConfig {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const raw = trimmed.startsWith("{") ? parseJsonObject(trimmed) : parseYamlObject(trimmed);
  return validateRoutes(raw);
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("routes JSON is invalid", { cause: error });
  }
}

function parseYamlObject(text: string): unknown {
  const yaml = Bun.YAML;
  if (typeof yaml?.parse !== "function") {
    throw new Error("this Bun build has no YAML parser; use JSON routes or upgrade Bun");
  }
  return yaml.parse(text);
}

function validateRoutes(raw: unknown): RoutesConfig {
  const root = asObject(raw, "routes");
  const config: RoutesConfig = {};
  if (root.orchestration !== undefined) {
    const orchestration = asObject(root.orchestration, "orchestration");
    config.orchestration = {
      max_depth: optionalNonNegativeInt(orchestration.max_depth, "orchestration.max_depth"),
      default_timeout_ms: optionalNonNegativeInt(
        orchestration.default_timeout_ms,
        "orchestration.default_timeout_ms"
      ),
    };
  }
  if (root.profiles !== undefined) {
    const profilesRaw = asObject(root.profiles, "profiles");
    const profiles: Record<string, Profile> = {};
    for (const [name, profileRaw] of Object.entries(profilesRaw)) {
      const profile = asObject(profileRaw, `profiles.${name}`);
      const parsed: Profile = { kind: parseAgentKind(profile.kind, `profiles.${name}.kind`) };
      const model = optionalString(profile.model, `profiles.${name}.model`);
      if (model) parsed.model = model;
      if (profile.env !== undefined) parsed.env = parseEnvMap(profile.env, `profiles.${name}.env`);
      profiles[name] = parsed;
    }
    config.profiles = profiles;
  }
  if (root.roles !== undefined) {
    const rolesRaw = asObject(root.roles, "roles");
    const roles: Record<string, RoleRoute> = {};
    for (const [name, roleRaw] of Object.entries(rolesRaw)) {
      const role = asObject(roleRaw, `roles.${name}`);
      if (!Array.isArray(role.profiles) || role.profiles.some((item) => typeof item !== "string")) {
        throw new Error(`roles.${name}.profiles must be an array of strings`);
      }
      const profiles = role.profiles;
      for (const profileName of profiles) {
        if (!config.profiles?.[profileName]) {
          throw new Error(`roles.${name} references unknown profile ${profileName}`);
        }
      }
      roles[name] = {
        profiles,
        strategy: parseStrategy(role.strategy, `roles.${name}.strategy`),
      };
    }
    config.roles = roles;
  }
  return config;
}

function parseEnvMap(raw: unknown, label: string): Record<string, string> {
  const entries = asObject(raw, label);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!ENV_NAME.test(key)) throw new Error(`${label}.${key} is not a valid environment name`);
    if (typeof value !== "string") throw new Error(`${label}.${key} must be a string`);
    env[key] = value;
  }
  return env;
}

export function loadRoutes(
  path?: string,
  env: NodeJS.ProcessEnv = process.env
): RoutesConfig {
  const explicit = path ?? env.PSTACK_HERDR_ROUTES;
  const configured = explicit ?? "~/.config/pstack-herdr/routes.yaml";
  const resolved = expandHome(configured);
  if (!existsSync(resolved)) {
    if (explicit) throw new Error(`Herdr routes file not found: ${resolved}`);
    return {};
  }
  return parseRoutes(readFileSync(resolved, "utf8"));
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

async function run(args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runHerdrCommand(args: string[]): Promise<CommandResult> {
  const result = await run(["herdr", ...args]);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
    throw new Error(`herdr ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

async function runHerdrJson(args: string[]): Promise<unknown> {
  const result = await runHerdrCommand(args);
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

async function runHerdrText(args: string[]): Promise<string> {
  const result = await runHerdrCommand(args);
  return result.stdout.replace(/\s+$/, "");
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return undefined;
  return nested as Record<string, unknown>;
}

function paneId(payload: unknown): string {
  const pane = nestedRecord(nestedRecord(payload, "result"), "pane");
  const id = pane?.pane_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Herdr pane split returned no result.pane.pane_id");
  }
  return id;
}

function agentStatus(payload: unknown): string {
  const result = nestedRecord(payload, "result") ?? {};
  const agent = nestedRecord(result, "agent") ?? {};
  for (const value of [agent.agent_status, agent.status, result.status]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "unknown";
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

async function closePane(pane: string): Promise<void> {
  try {
    await runHerdrCommand(["pane", "close", pane]);
  } catch {
    // Keep the original start/prompt error; a failed cleanup must not replace it.
  }
}

export async function dispatch(
  options: DispatchOptions,
  env: NodeJS.ProcessEnv = process.env
): Promise<DispatchResult> {
  if (env.HERDR_ENV !== "1") throw new Error("herdr-dispatch requires HERDR_ENV=1");
  if (!AGENT_NAME.test(options.name)) throw new Error("--name must match [a-z][a-z0-9_-]{0,31}");
  const config = loadRoutes(options.routes, env);
  const chosen = chooseProfile(config, options, env);
  const nesting = depth(config, env);
  const timeout = options.timeout ?? config.orchestration?.default_timeout_ms ?? 180000;
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
  const pane = paneId(await runHerdrJson(splitArgs));
  const startArgs = [
    "agent",
    "start",
    options.name,
    "--kind",
    chosen.profile.kind,
    "--pane",
    pane,
    ...agentStartTail(chosen.profile.kind, options.model ?? chosen.profile.model, options.readonly),
  ];
  try {
    await runHerdrJson(startArgs);
  } catch (error) {
    await closePane(pane);
    throw error;
  }
  const promptArgs = ["agent", "prompt", options.name, prompt];
  if (options.wait) promptArgs.push("--wait", "--timeout", String(timeout));
  await runHerdrJson(promptArgs);
  const handle: DispatchHandle = {
    agent: options.name,
    pane,
    profile: chosen.name,
    kind: chosen.profile.kind,
    depth: nesting.next,
  };
  if (!options.wait) return handle;
  const status = agentStatus(await runHerdrJson(["agent", "get", options.name]));
  const output = await runHerdrText([
    "agent",
    "read",
    options.name,
    "--source",
    "recent-unwrapped",
    "--lines",
    "240",
  ]);
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
    .option("--timeout <ms>", "wait timeout in milliseconds", (value: string) => Number(value))
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
  if (options.timeout !== undefined && !Number.isInteger(options.timeout)) {
    throw new Error("--timeout must be an integer");
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
