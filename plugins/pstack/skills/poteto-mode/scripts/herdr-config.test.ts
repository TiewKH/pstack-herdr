import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRoutes,
  parseRoutes,
  parseSetupInput,
  renderRoutesYaml,
  writeRoutesAtomic,
  type RoutesConfig,
} from "./herdr-config.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const setup = {
  profiles: [
    {
      name: "claude-strong",
      kind: "claude",
      model: "claude-opus-5",
      config_home: "~/.claude",
    },
    {
      name: "claude-fast",
      kind: "claude",
      model: "claude-sonnet-5",
      config_home: "~/.claude",
    },
  ],
  roles: {
    explorer: { profiles: ["claude-fast"], strategy: "first" },
    implementation: { profiles: ["claude-fast"], strategy: "first" },
    "difficult-implementation": { profiles: ["claude-strong"], strategy: "first" },
    judgment: { profiles: ["claude-strong"], strategy: "first" },
    reviewer: { profiles: ["claude-strong", "claude-fast"], strategy: "spread" },
    "arena-candidate": { profiles: ["claude-strong", "claude-fast"], strategy: "spread" },
    "arena-judge": { profiles: ["claude-strong"], strategy: "first" },
    verifier: { profiles: ["claude-fast"], strategy: "first" },
    subcoordinator: { profiles: ["claude-strong"], strategy: "first" },
  },
};

describe("herdr deterministic setup", () => {
  test("same input produces byte-identical YAML", () => {
    const parsed = parseSetupInput(JSON.stringify(setup));
    const first = renderRoutesYaml(buildRoutes({}, parsed));
    const second = renderRoutesYaml(buildRoutes(parseRoutes(first), parsed));
    expect(second).toBe(first);
  });

  test("preserves existing orchestration and unrelated profile env", () => {
    const existing: RoutesConfig = {
      orchestration: { max_depth: 7, default_timeout_ms: 90000 },
      profiles: {
        "claude-strong": {
          kind: "claude",
          env: { EXTRA_FLAG: "1", CLAUDE_CONFIG_DIR: "~/.old" },
        },
      },
    };
    const result = buildRoutes(existing, parseSetupInput(JSON.stringify(setup)));
    expect(result.orchestration).toEqual({ max_depth: 7, default_timeout_ms: 90000 });
    expect(result.profiles?.["claude-strong"].env).toEqual({
      CLAUDE_CONFIG_DIR: "~/.claude",
      EXTRA_FLAG: "1",
    });
  });

  test("two profiles may share one subscription config home", () => {
    const result = buildRoutes({}, parseSetupInput(JSON.stringify(setup)));
    expect(result.profiles?.["claude-strong"].env?.CLAUDE_CONFIG_DIR).toBe("~/.claude");
    expect(result.profiles?.["claude-fast"].env?.CLAUDE_CONFIG_DIR).toBe("~/.claude");
  });

  test("missing required roles fail closed", () => {
    const broken = structuredClone(setup);
    delete (broken.roles as Record<string, unknown>).verifier;
    expect(() => parseSetupInput(JSON.stringify(broken))).toThrow(/missing required role: verifier/);
  });

  test("unknown profile references fail closed", () => {
    const broken = structuredClone(setup);
    broken.roles.explorer.profiles = ["missing"];
    expect(() => parseSetupInput(JSON.stringify(broken))).toThrow(/unknown profile missing/);
  });

  test("atomic writer is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-herdr-config-"));
    dirs.push(dir);
    const path = join(dir, "routes.yaml");
    const config = buildRoutes({}, parseSetupInput(JSON.stringify(setup)));

    expect(writeRoutesAtomic(path, config).changed).toBe(true);
    const first = readFileSync(path, "utf8");
    expect(writeRoutesAtomic(path, config).changed).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(first);
  });

  test("written YAML round-trips through the dispatcher parser", () => {
    const config = buildRoutes({}, parseSetupInput(JSON.stringify(setup)));
    expect(parseRoutes(renderRoutesYaml(config))).toEqual(config);
  });
});
