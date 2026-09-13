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

export function validateRoutes(raw: unknown): RoutesConfig {
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
      if (!PROFILE_NAME.test(name)) {
        throw new Error(`profiles.${name} name must match ${PROFILE_NAME.source}`);
      }
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
      if (
        !Array.isArray(role.profiles) ||
        role.profiles.length === 0 ||
        role.profiles.some((item) => typeof item !== "string" || item.length === 0)
      ) {
        throw new Error(`roles.${name}.profiles must be a non-empty array of strings`);
      }
      const profiles = role.profiles as string[];
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

function validateSetupInput(raw: unknown): SetupInput {
  const root = asObject(raw, "setup input");
  if (!Array.isArray(root.profiles) || root.profiles.length === 0) {
    throw new Error("setup input.profiles must be a non-empty array");
  }

  const seen = new Set<string>();
  const profiles: SetupProfileInput[] = root.profiles.map((item, index) => {
    const profile = asObject(item, `setup input.profiles[${index}]`);
    const name = optionalString(profile.name, `setup input.profiles[${index}].name`);
    if (!name || !PROFILE_NAME.test(name)) {
      throw new Error(`setup input.profiles[${index}].name must match ${PROFILE_NAME.source}`);
    }
    if (seen.has(name)) throw new Error(`duplicate setup profile: ${name}`);
    seen.add(name);

    const parsed: SetupProfileInput = {
      name,
      kind: parseAgentKind(profile.kind, `setup input.profiles[${index}].kind`),
    };
    const model = optionalString(profile.model, `setup input.profiles[${index}].model`);
    if (model) parsed.model = model;
    const configHome = optionalString(
      profile.config_home,
      `setup input.profiles[${index}].config_home`
    );
    if (configHome) {
      if (/[\r\n]/.test(configHome)) {
        throw new Error(`setup input.profiles[${index}].config_home contains a newline`);
      }
      parsed.config_home = configHome;
    }
    if (profile.env !== undefined) {
      parsed.env = parseEnvMap(profile.env, `setup input.profiles[${index}].env`);
    }
    return parsed;
  });

  const rolesRaw = asObject(root.roles, "setup input.roles");
  const roles: Record<string, RoleRoute> = {};
  for (const [roleName, roleRaw] of Object.entries(rolesRaw)) {
    const role = asObject(roleRaw, `setup input.roles.${roleName}`);
    if (
      !Array.isArray(role.profiles) ||
      role.profiles.length === 0 ||
      role.profiles.some((item) => typeof item !== "string" || item.length === 0)
    ) {
      throw new Error(`setup input.roles.${roleName}.profiles must be a non-empty array of strings`);
    }
    for (const profileName of role.profiles as string[]) {
      if (!seen.has(profileName)) {
        throw new Error(`setup input.roles.${roleName} references unknown profile ${profileName}`);
      }
    }
    roles[roleName] = {
      profiles: [...(role.profiles as string[])],
      strategy: parseStrategy(role.strategy, `setup input.roles.${roleName}.strategy`),
    };
  }

  for (const role of REQUIRED_HERDR_ROLES) {
    if (!roles[role]) throw new Error(`setup input.roles is missing required role: ${role}`);
  }

  let orchestration: SetupInput["orchestration"];
  if (root.orchestration !== undefined) {
    const value = asObject(root.orchestration, "setup input.orchestration");
    orchestration = {
      max_depth: optionalNonNegativeInt(value.max_depth, "setup input.orchestration.max_depth"),
      default_timeout_ms: optionalNonNegativeInt(
        value.default_timeout_ms,
        "setup input.orchestration.default_timeout_ms"
      ),
    };
  }

  return { profiles, roles, orchestration };
}

export function parseSetupInput(text: string): SetupInput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error("setup input must be valid JSON", { cause: error });
  }
  return validateSetupInput(raw);
}

export function buildRoutes(existing: RoutesConfig, rawInput: SetupInput): RoutesConfig {
  const input = validateSetupInput(rawInput);
  const profiles: Record<string, Profile> = {};

  for (const item of [...input.profiles].sort((a, b) => a.name.localeCompare(b.name))) {
    const oldEnv = existing.profiles?.[item.name]?.env ?? {};
    const env: Record<string, string> = { ...oldEnv };
    delete env.CLAUDE_CONFIG_DIR;
    delete env.CODEX_HOME;
    Object.assign(env, item.env ?? {});

    if (item.config_home) {
      env[item.kind === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"] = item.config_home;
    }

    profiles[item.name] = {
      kind: item.kind,
      model: item.model ?? "inherit",
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  const orchestration = {
    max_depth:
      input.orchestration?.max_depth ??
      existing.orchestration?.max_depth ??
      3,
    default_timeout_ms:
      input.orchestration?.default_timeout_ms ??
      existing.orchestration?.default_timeout_ms ??
      180000,
  };

  const config: RoutesConfig = {
    orchestration,
    profiles,
    roles: input.roles,
  };
  return validateRoutes(config);
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
  const parsed = validateRoutes(config);
  const lines: string[] = [];
  const orchestration = parsed.orchestration ?? {};

  lines.push("orchestration:");
  if (orchestration.max_depth !== undefined) {
    lines.push(`  max_depth: ${orchestration.max_depth}`);
  }
  if (orchestration.default_timeout_ms !== undefined) {
    lines.push(`  default_timeout_ms: ${orchestration.default_timeout_ms}`);
  }

  lines.push("", "profiles:");
  for (const name of Object.keys(parsed.profiles ?? {}).sort()) {
    const profile = parsed.profiles![name];
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
  for (const name of orderedRoleNames(parsed.roles ?? {})) {
    const role = parsed.roles![name];
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
