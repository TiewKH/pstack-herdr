import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyReadonlyPrompt,
  dispatch,
  envFlags,
  inferParentKind,
  loadRoutes,
  parseRoutes,
  readonlyAgentArgs,
  selectProfileName,
  stableIndex,
  type DispatchOptions,
  type RoutesConfig,
} from "./herdr-dispatch.ts";

const config: RoutesConfig = {
  profiles: {
    "claude-a": { kind: "claude" },
    "codex-a": { kind: "codex" },
  },
  roles: {
    explorer: {
      profiles: ["claude-a", "codex-a"],
      strategy: "spread",
    },
    judgment: {
      profiles: ["claude-a"],
      strategy: "first",
    },
  },
};

const options: DispatchOptions = {
  role: "explorer",
  name: "ci-explorer",
  prompt: "ping",
  cwd: process.cwd(),
  wait: false,
  readonly: true,
  direction: "right",
  kind: "claude",
};

describe("herdr-dispatch routing", () => {
  test("stableIndex is deterministic", () => {
    expect(stableIndex("reviewer-a", 3)).toBe(stableIndex("reviewer-a", 3));
  });

  test("spread roles deterministically select from their pool", () => {
    const selected = selectProfileName(config, "explorer", "explorer-a");
    if (selected === undefined) throw new Error("expected configured explorer profile");
    expect(["claude-a", "codex-a"]).toContain(selected);
  });

  test("first uses the first configured profile", () => {
    expect(selectProfileName(config, "judgment", "judge-a")).toBe("claude-a");
  });

  test("unknown roles fall back to the parent runtime", () => {
    expect(selectProfileName(config, "missing", "worker-a")).toBeUndefined();
  });

  test("JSON routes are validated", () => {
    expect(parseRoutes(JSON.stringify(config))).toEqual(config);
  });

  test("YAML routes are validated", () => {
    expect(
      parseRoutes(`
profiles:
  claude-a:
    kind: claude
roles:
  judgment:
    profiles: [claude-a]
    strategy: first
`)
    ).toEqual({
      profiles: { "claude-a": { kind: "claude" } },
      roles: { judgment: { profiles: ["claude-a"], strategy: "first" } },
    });
  });

  test("unknown strategies are rejected", () => {
    expect(() =>
      parseRoutes(
        JSON.stringify({
          profiles: { "claude-a": { kind: "claude" } },
          roles: { judgment: { profiles: ["claude-a"], strategy: "strongest-first" } },
        })
      )
    ).toThrow(/must be spread or first/);
  });

  test("roles cannot reference missing profiles", () => {
    expect(() =>
      parseRoutes(
        JSON.stringify({
          roles: { judgment: { profiles: ["missing"] } },
        })
      )
    ).toThrow(/unknown profile missing/);
  });
});

describe("herdr-dispatch contracts", () => {
  test("explicit missing routes fail closed", () => {
    expect(() => loadRoutes("/tmp/pstack-herdr-missing-routes.yaml")).toThrow(
      /routes file not found/
    );
  });

  test("loadRoutes reads an explicit file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-herdr-routes-"));
    const path = join(dir, "routes.json");
    try {
      writeFileSync(path, JSON.stringify(config));
      expect(loadRoutes(path)).toEqual(config);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("readonly args disable writes without Ask mode", () => {
    expect(readonlyAgentArgs("claude")).toEqual(["--disallowedTools", "Write,Edit"]);
    expect(readonlyAgentArgs("codex")).toEqual(["--sandbox", "read-only"]);
    expect(applyReadonlyPrompt("do the work", true).startsWith("Read-only worker.")).toBe(true);
    expect(applyReadonlyPrompt("do the work", false)).toBe("do the work");
  });

  test("env flags keep key and value as one argv pair", () => {
    expect(envFlags({ CLAUDE_CONFIG_DIR: "~/.claude-a", PSTACK_HERDR_DEPTH: "2" })).toEqual([
      "--env",
      `CLAUDE_CONFIG_DIR=${resolve(homedir(), ".claude-a")}`,
      "--env",
      "PSTACK_HERDR_DEPTH=2",
    ]);
    expect(() => envFlags({ "BAD-KEY": "1" })).toThrow(/invalid environment variable name/);
  });

  test("inferParentKind prefers an explicit child kind", () => {
    expect(inferParentKind({ PSTACK_HERDR_PARENT_KIND: "codex", CLAUDECODE: "1" })).toBe("codex");
    expect(inferParentKind({ CLAUDECODE: "1" })).toBe("claude");
  });

  test("dispatch refuses to run outside Herdr", async () => {
    await expect(dispatch(options, {})).rejects.toThrow(/HERDR_ENV=1/);
  });

  test("dispatch refuses names that Herdr will reject", async () => {
    await expect(dispatch({ ...options, name: "Bad Name" }, { HERDR_ENV: "1" })).rejects.toThrow(
      /--name must match/
    );
  });

  test("dispatch refuses depth that reached max_depth before contacting Herdr", async () => {
    await expect(
      dispatch(options, { HERDR_ENV: "1", PSTACK_HERDR_DEPTH: "3" })
    ).rejects.toThrow(/max_depth 3/);
  });
});
