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

const setup: {
  profiles: Array<{
    name: string;
    kind: string;
    model: string;
    config_home: string;
    effort?: string;
  }>;
  roles: Record<string, { profiles: string[]; strategy: string }>;
} = {
  profiles: [
    {
      name: "claude-strong",
      kind: "claude",
      model: "claude-opus-5",
      config_home: "~/.claude-team",
    },
    {
      name: "claude-fast",
      kind: "claude",
      model: "claude-sonnet-5",
      config_home: "~/.claude-team",
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
      CLAUDE_CONFIG_DIR: "~/.claude-team",
      EXTRA_FLAG: "1",
    });
  });

  test("effort is optional and carried through to rendered YAML", () => {
    const withEffort = structuredClone(setup);
    withEffort.profiles[0].effort = "high";
    const config = buildRoutes({}, parseSetupInput(JSON.stringify(withEffort)));
    expect(config.profiles?.["claude-strong"].effort).toBe("high");
    expect(config.profiles?.["claude-fast"].effort).toBeUndefined();
    const yaml = renderRoutesYaml(config);
    expect(yaml).toContain('    effort: "high"');
    expect(parseRoutes(yaml)).toEqual(config);
  });

  test("effort rejects values unsupported by the profile kind", () => {
    const badClaude = structuredClone(setup);
    badClaude.profiles[0].effort = "minimal";
    expect(() => parseSetupInput(JSON.stringify(badClaude))).toThrow(
      "effort must be one of low, medium, high, xhigh, max for claude"
    );

    const badCodex = structuredClone(setup);
    badCodex.profiles[0] = {
      ...badCodex.profiles[0],
      kind: "codex",
      effort: "max",
    };
    expect(() => parseSetupInput(JSON.stringify(badCodex))).toThrow(
      "effort must be one of minimal, low, medium, high, xhigh for codex"
    );
  });

  test("two profiles may share one subscription config home", () => {
    const result = buildRoutes({}, parseSetupInput(JSON.stringify(setup)));
    expect(result.profiles?.["claude-strong"].env?.CLAUDE_CONFIG_DIR).toBe("~/.claude-team");
    expect(result.profiles?.["claude-fast"].env?.CLAUDE_CONFIG_DIR).toBe("~/.claude-team");
  });

  test("a default config home is recorded as given; the dispatcher decides at run time", () => {
    const defaults = structuredClone(setup);
    defaults.profiles[0].config_home = "~/.claude";
    const result = buildRoutes({}, parseSetupInput(JSON.stringify(defaults)));
    expect(result.profiles?.["claude-strong"].env).toEqual({ CLAUDE_CONFIG_DIR: "~/.claude" });
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

  test("committed setup example is valid input", () => {
    const example = readFileSync(
      join(import.meta.dir, "../../../../../config/setup.example.json"),
      "utf8"
    );
    const config = buildRoutes({}, parseSetupInput(example));
    expect(parseRoutes(renderRoutesYaml(config))).toEqual(config);
  });

  test("--check compares disk bytes to the writer output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-herdr-check-"));
    dirs.push(dir);
    const inputPath = join(dir, "setup.json");
    const outputPath = join(dir, "routes.yaml");
    writeFileSync(inputPath, JSON.stringify(setup));
    const yaml = renderRoutesYaml(buildRoutes({}, parseSetupInput(JSON.stringify(setup))));
    writeFileSync(outputPath, yaml);

    const current = await runConfigure(["--input", inputPath, "--output", outputPath, "--check"]);
    expect(current.exitCode).toBe(0);
    expect(current.stdout).toContain("routes are valid and current");

    writeFileSync(outputPath, yaml.replaceAll(/    model: .*\n/g, ""));
    const stale = await runConfigure(["--input", inputPath, "--output", outputPath, "--check"]);
    expect(stale.exitCode).not.toBe(0);
    expect(stale.stderr).toMatch(/does not match the requested setup input/);

    const missing = await runConfigure([
      "--input",
      inputPath,
      "--output",
      join(dir, "missing.yaml"),
      "--check",
    ]);
    expect(missing.exitCode).not.toBe(0);
  });
});

async function runConfigure(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "configure-herdr.ts"), ...args], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}
