import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

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

export interface SetupProfileInput {
  name: string;
  kind: AgentKind;
  model?: string;
  config_home?: string;
  env?: Record<string, string>;
}

export interface SetupInput {
  profiles: SetupProfileInput[];
  roles: Record<string, RoleRoute>;
  orchestration?: { max_depth?: number; default_timeout_ms?: number };
}

export const REQUIRED_HERDR_ROLES = [
  "explorer",
  "implementation",
  "difficult-implementation",
  "judgment",
  "reviewer",
  "arena-candidate",
  "arena-judge",
  "verifier",
  "subcoordinator",
] as const;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function expandHome(value: string): string {
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

function configHomeEnvKey(kind: AgentKind): "CLAUDE_CONFIG_DIR" | "CODEX_HOME" {
  switch (kind) {
    case "claude":
      return "CLAUDE_CONFIG_DIR";
    case "codex":
      return "CODEX_HOME";
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled agent kind: ${String(exhaustive)}`);
    }
  }
}

function parseEnvMap(raw: unknown, label: string): Record<string, string> {
  const entries = asObject(raw, label);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!ENV_NAME.test(key)) throw new Error(`${label}.${key} is not a valid environment name`);
    if (typeof value !== "string") throw new Error(`${label}.${key} must be a string`);
    if (/[\r\n]/.test(value)) throw new Error(`${label}.${key} contains a newline`);
    env[key] = value;
  }
  return env;
}

function parseProfile(raw: unknown, label: string): Profile {
  const profile = asObject(raw, label);
  const parsed: Profile = { kind: parseAgentKind(profile.kind, `${label}.kind`) };
  const model = optionalString(profile.model, `${label}.model`);
  if (model) parsed.model = model;
  if (profile.env !== undefined) parsed.env = parseEnvMap(profile.env, `${label}.env`);
  return parsed;
}

function parseOrchestration(
  raw: unknown,
  label: string
): { max_depth?: number; default_timeout_ms?: number } {
  const orchestration = asObject(raw, label);
  return {
    max_depth: optionalNonNegativeInt(orchestration.max_depth, `${label}.max_depth`),
    default_timeout_ms: optionalNonNegativeInt(
      orchestration.default_timeout_ms,
      `${label}.default_timeout_ms`
    ),
  };
}

function parseNonEmptyStrings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`${label} must be a non-empty array of strings`);
  }
  return [...value];
}

function parseRoleRoute(
  raw: unknown,
  label: string,
  hasProfile: (name: string) => boolean
): RoleRoute {
  const role = asObject(raw, label);
  const profiles = parseNonEmptyStrings(role.profiles, `${label}.profiles`);
  for (const profileName of profiles) {
    if (!hasProfile(profileName)) {
      throw new Error(`${label} references unknown profile ${profileName}`);
    }
  }
  return {
    profiles,
    strategy: parseStrategy(role.strategy, `${label}.strategy`),
  };
}

export function validateRoutes(raw: unknown): RoutesConfig {
  const root = asObject(raw, "routes");
  const config: RoutesConfig = {};

  if (root.orchestration !== undefined) {
    config.orchestration = parseOrchestration(root.orchestration, "orchestration");
  }

  if (root.profiles !== undefined) {
    const profilesRaw = asObject(root.profiles, "profiles");
    const profiles: Record<string, Profile> = {};
    for (const [name, profileRaw] of Object.entries(profilesRaw)) {
      if (!PROFILE_NAME.test(name)) {
        throw new Error(`profiles.${name} name must match ${PROFILE_NAME.source}`);
      }
      profiles[name] = parseProfile(profileRaw, `profiles.${name}`);
    }
    config.profiles = profiles;
  }

  if (root.roles !== undefined) {
    const rolesRaw = asObject(root.roles, "roles");
    const roles: Record<string, RoleRoute> = {};
    for (const [name, roleRaw] of Object.entries(rolesRaw)) {
      roles[name] = parseRoleRoute(roleRaw, `roles.${name}`, (profileName) =>
        Boolean(config.profiles?.[profileName])
      );
    }
    config.roles = roles;
  }

  return config;
}

export function parseRoutes(text: string): RoutesConfig {
  const trimmed = text.trim();
  if (!trimmed) return {};
  let raw: unknown;
  if (trimmed.startsWith("{")) {
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      throw new Error("routes JSON is invalid", { cause: error });
    }
  } else {
    const yaml = Bun.YAML;
    if (typeof yaml?.parse !== "function") {
      throw new Error("this Bun build has no YAML parser; use JSON routes or upgrade Bun");
    }
    raw = yaml.parse(trimmed);
  }
  return validateRoutes(raw);
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

function setupProfileToRoute(profile: SetupProfileInput): Profile {
  const env = { ...profile.env };
  if (profile.config_home) {
    env[configHomeEnvKey(profile.kind)] = profile.config_home;
  }
  return {
    kind: profile.kind,
    ...(profile.model ? { model: profile.model } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function parseSetupInput(text: string): SetupInput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error("setup input must be valid JSON", { cause: error });
  }

  const root = asObject(raw, "setup input");
  if (!Array.isArray(root.profiles) || root.profiles.length === 0) {
    throw new Error("setup input.profiles must be a non-empty array");
  }

  const seen = new Set<string>();
  const profiles: SetupProfileInput[] = root.profiles.map((item, index) => {
    const label = `setup input.profiles[${index}]`;
    const profile = asObject(item, label);
    const name = optionalString(profile.name, `${label}.name`);
    if (!name || !PROFILE_NAME.test(name)) {
      throw new Error(`${label}.name must match ${PROFILE_NAME.source}`);
    }
    if (seen.has(name)) throw new Error(`duplicate setup profile: ${name}`);
    seen.add(name);

    const parsed = parseProfile(profile, label);
    const configHome = optionalString(profile.config_home, `${label}.config_home`);
    if (configHome && /[\r\n]/.test(configHome)) {
      throw new Error(`${label}.config_home contains a newline`);
    }

    const setupProfile: SetupProfileInput = { name, kind: parsed.kind };
    if (parsed.model) setupProfile.model = parsed.model;
    if (configHome) setupProfile.config_home = configHome;
    if (parsed.env) setupProfile.env = parsed.env;
    return setupProfile;
  });

  const profileMap: Record<string, Profile> = {};
  for (const profile of profiles) {
    profileMap[profile.name] = setupProfileToRoute(profile);
  }

  const routes = validateRoutes({
    orchestration: root.orchestration,
    profiles: profileMap,
    roles: asObject(root.roles, "setup input.roles"),
  });

  const roles = routes.roles ?? {};
  for (const role of REQUIRED_HERDR_ROLES) {
    if (!roles[role]) throw new Error(`setup input.roles is missing required role: ${role}`);
  }

  return { profiles, roles, orchestration: routes.orchestration };
}

export function buildRoutes(existing: RoutesConfig, input: SetupInput): RoutesConfig {
  const profiles: Record<string, Profile> = {};

  for (const item of [...input.profiles].sort((a, b) => a.name.localeCompare(b.name))) {
    const oldEnv = existing.profiles?.[item.name]?.env ?? {};
    const env: Record<string, string> = { ...oldEnv };
    delete env.CLAUDE_CONFIG_DIR;
    delete env.CODEX_HOME;
    Object.assign(env, setupProfileToRoute(item).env ?? {});

    profiles[item.name] = {
      kind: item.kind,
      model: item.model ?? "inherit",
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  return {
    orchestration: {
      max_depth: input.orchestration?.max_depth ?? existing.orchestration?.max_depth ?? 3,
      default_timeout_ms:
        input.orchestration?.default_timeout_ms ??
        existing.orchestration?.default_timeout_ms ??
        180000,
    },
    profiles,
    roles: input.roles,
  };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function orderedRoleNames(roles: Record<string, RoleRoute>): string[] {
  const required = REQUIRED_HERDR_ROLES.filter((name) => roles[name] !== undefined);
  const extras = Object.keys(roles)
    .filter((name) => !REQUIRED_HERDR_ROLES.includes(name as (typeof REQUIRED_HERDR_ROLES)[number]))
    .sort();
  return [...required, ...extras];
}

export function renderRoutesYaml(config: RoutesConfig): string {
  const lines: string[] = [];
  const orchestration = config.orchestration ?? {};
  const profiles = config.profiles ?? {};
  const roles = config.roles ?? {};

  lines.push("orchestration:");
  if (orchestration.max_depth !== undefined) {
    lines.push(`  max_depth: ${orchestration.max_depth}`);
  }
  if (orchestration.default_timeout_ms !== undefined) {
    lines.push(`  default_timeout_ms: ${orchestration.default_timeout_ms}`);
  }

  lines.push("", "profiles:");
  for (const name of Object.keys(profiles).sort()) {
    const profile = profiles[name];
    lines.push(`  ${name}:`, `    kind: ${profile.kind}`);
    if (profile.model !== undefined) lines.push(`    model: ${quote(profile.model)}`);
    const env = profile.env ?? {};
    if (Object.keys(env).length > 0) {
      lines.push("    env:");
      for (const key of Object.keys(env).sort()) {
        lines.push(`      ${key}: ${quote(env[key])}`);
      }
    }
  }

  lines.push("", "roles:");
  for (const name of orderedRoleNames(roles)) {
    const role = roles[name];
    lines.push(
      `  ${name}:`,
      `    profiles: [${role.profiles.map(quote).join(", ")}]`,
      `    strategy: ${role.strategy ?? "first"}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function writeRoutesAtomic(
  outputPath: string,
  config: RoutesConfig
): { path: string; changed: boolean; content: string } {
  const path = expandHome(outputPath);
  const content = renderRoutesYaml(config);
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    return { path, changed: false, content };
  }

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
  return { path, changed: true, content };
}
