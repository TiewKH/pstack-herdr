#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { ensureDependenciesInstalled } from "./bootstrap.ts";

ensureDependenciesInstalled();
const { Command } = await import("commander");

export type AgentKind = "claude" | "codex";
export type RouteStrategy = "round-robin" | "spread" | "first-available" | "strongest-first";
export interface Profile { kind: AgentKind; model?: string; env?: Record<string, string>; }
export interface RoleRoute { profiles: string[]; strategy?: RouteStrategy; workspace?: string; }
export interface RoutesConfig {
  orchestration?: { max_depth?: number; default_timeout_ms?: number };
  profiles?: Record<string, Profile>;
  roles?: Record<string, RoleRoute>;
}
interface DispatchOptions {
  role: string; name: string; prompt?: string; promptFile?: string; cwd: string;
  profile?: string; kind?: AgentKind; model?: string; wait: boolean; timeout?: number;
  readonly: boolean; direction: "right" | "down"; routes?: string;
}
interface CommandResult { stdout: string; stderr: string; exitCode: number; }

function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value;
}
export function stableIndex(seed: string, size: number): number {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return Math.abs(hash >>> 0) % size;
}
export function selectProfileName(config: RoutesConfig, role: string, workerName: string): string | undefined {
  const route = config.roles?.[role];
  const pool = route?.profiles ?? [];
  if (pool.length === 0) return undefined;
  const strategy = route?.strategy ?? "first-available";
  return strategy === "round-robin" || strategy === "spread" ? pool[stableIndex(workerName, pool.length)] : pool[0];
}
export function parseRoutes(text: string): RoutesConfig {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as RoutesConfig;
  const yaml = (Bun as unknown as { YAML?: { parse(input: string): unknown } }).YAML;
  if (!yaml?.parse) throw new Error("this Bun build has no YAML parser; use JSON routes or upgrade Bun");
  return yaml.parse(text) as RoutesConfig;
}
export function loadRoutes(path?: string): RoutesConfig {
  const configured = path ?? process.env.PSTACK_HERDR_ROUTES ?? "~/.config/pstack-herdr/routes.yaml";
  const resolved = expandHome(configured);
  return existsSync(resolved) ? parseRoutes(readFileSync(resolved, "utf8")) : {};
}
async function run(args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
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
    throw new Error(`herdr ${args.join(" ")} returned non-JSON output where JSON was expected: ${text}`, { cause: error });
  }
}
async function runHerdrText(args: string[]): Promise<string> {
  const result = await runHerdrCommand(args);
  return result.stdout.replace(/\s+$/, "");
}
function paneId(payload: unknown): string {
  const id = (payload as { result?: { pane?: { pane_id?: string } } }).result?.pane?.pane_id;
  if (!id) throw new Error("Herdr pane split returned no result.pane.pane_id");
  return id;
}
function agentStatus(payload: unknown): string | undefined {
  const value = payload as { result?: { agent?: { status?: string; agent_status?: string }; status?: string } };
  return value.result?.agent?.agent_status ?? value.result?.agent?.status ?? value.result?.status;
}
function resolvedPrompt(options: DispatchOptions): string {
  if (options.prompt && options.promptFile) throw new Error("use either --prompt or --prompt-file, not both");
  if (options.promptFile) return readFileSync(resolve(options.promptFile), "utf8");
  if (options.prompt) return options.prompt;
  throw new Error("set --prompt or --prompt-file");
}
export function inferParentKind(env: NodeJS.ProcessEnv = process.env): AgentKind | undefined {
  const explicit = env.PSTACK_HERDR_PARENT_KIND;
  if (explicit === "claude" || explicit === "codex") return explicit;
  if (env.CLAUDECODE === "1" || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CONFIG_DIR) return "claude";
  if (env.CODEX_THREAD_ID || env.CODEX_HOME) return "codex";
  return undefined;
}
function depth(config: RoutesConfig): { current: number; next: number; max: number } {
  const current = Number(process.env.PSTACK_HERDR_DEPTH ?? "0");
  if (!Number.isSafeInteger(current) || current < 0) throw new Error("PSTACK_HERDR_DEPTH must be a non-negative integer");
  const max = config.orchestration?.max_depth ?? 3;
  if (current >= max) throw new Error(`Herdr delegation depth ${current} reached configured max_depth ${max}`);
  return { current, next: current + 1, max };
}
function chooseProfile(config: RoutesConfig, options: DispatchOptions): { name: string; profile: Profile } {
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
  const kind = options.kind ?? inferParentKind();
  if (!kind) throw new Error("no route matched and parent CLI could not be inferred; set --kind claude|codex or PSTACK_HERDR_PARENT_KIND");
  return { name: "parent", profile: { kind, model: options.model ?? "inherit", env: {} } };
}
export async function dispatch(options: DispatchOptions): Promise<unknown> {
  if (process.env.HERDR_ENV !== "1") throw new Error("herdr-dispatch requires HERDR_ENV=1");
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(options.name)) throw new Error("--name must match [a-z][a-z0-9_-]{0,31}");
  const config = loadRoutes(options.routes);
  const chosen = chooseProfile(config, options);
  const nesting = depth(config);
  const timeout = options.timeout ?? config.orchestration?.default_timeout_ms ?? 180000;
  const prompt = resolvedPrompt(options);
  const splitArgs = ["pane", "split", "--current", "--direction", options.direction, "--cwd", resolve(options.cwd), "--no-focus"];
  const env = { ...(chosen.profile.env ?? {}), PSTACK_HERDR_DEPTH: String(nesting.next), PSTACK_HERDR_PARENT_KIND: chosen.profile.kind };
  for (const [key, value] of Object.entries(env)) splitArgs.push("--env", `${key}=${expandHome(value)}`);
  const pane = paneId(await runHerdrJson(splitArgs));
  const startArgs = ["agent", "start", options.name, "--kind", chosen.profile.kind, "--pane", pane];
  const model = options.model ?? chosen.profile.model;
  if (model && model !== "inherit" && model !== "auto") startArgs.push("--", "--model", model);
  await runHerdrJson(startArgs);
  const promptArgs = ["agent", "prompt", options.name, prompt];
  if (options.wait) promptArgs.push("--wait", "--timeout", String(timeout));
  const promptResult = await runHerdrJson(promptArgs);
  if (!options.wait) return { agent: options.name, pane, profile: chosen.name, kind: chosen.profile.kind, depth: nesting.next };
  const state = await runHerdrJson(["agent", "get", options.name]);
  const status = agentStatus(state);
  const output = await runHerdrText(["agent", "read", options.name, "--source", "recent-unwrapped", "--lines", "240"]);
  return { agent: options.name, pane, profile: chosen.name, kind: chosen.profile.kind, depth: nesting.next, status, blocked: status === "blocked", prompt: promptResult, output };
}
async function main(): Promise<void> {
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
    .option("--readonly", "document that this worker must not write", false)
    .option("--direction <direction>", "pane split direction", "right")
    .option("--routes <path>", "routes YAML/JSON path");
  program.parse(process.argv);
  const options = program.opts<DispatchOptions>();
  if (options.kind && options.kind !== "claude" && options.kind !== "codex") throw new Error("--kind must be claude or codex");
  if (options.direction !== "right" && options.direction !== "down") throw new Error("--direction must be right or down");
  const result = await dispatch(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (import.meta.main) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
