import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRoutes, parseRoutes, type RoutesConfig } from "./herdr-config.ts";
import {
  agentStatus,
  applyReadonlyPrompt,
  dispatch,
  effortAgentArgs,
  envFlags,
  inferParentKind,
  isPaneNotReady,
  paneId,
  placementArgs,
  parseAgentStatus,
  readonlyAgentArgs,
  selectProfileName,
  stableIndex,
  type CommandResult,
  type DispatchOptions,
  type HerdrExec,
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

const emptyRoutesDir = mkdtempSync(join(tmpdir(), "pstack-herdr-empty-routes-"));
const emptyRoutes = join(emptyRoutesDir, "routes.json");
writeFileSync(emptyRoutes, "{}\n");
afterAll(() => {
  rmSync(emptyRoutesDir, { recursive: true, force: true });
});

const options: DispatchOptions = {
  role: "explorer",
  name: "ci-explorer",
  prompt: "ping",
  cwd: process.cwd(),
  wait: false,
  readonly: true,
  direction: "right",
  placement: "split",
  kind: "claude",
  routes: emptyRoutes,
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

  test("effort args translate to each CLI's own flag shape", () => {
    expect(effortAgentArgs("claude", "max")).toEqual(["--effort", "max"]);
    expect(effortAgentArgs("codex", "high")).toEqual([
      "-c",
      'model_reasoning_effort="high"',
    ]);
    expect(effortAgentArgs("claude", undefined)).toEqual([]);
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

  test("dispatch refuses a negative timeout before contacting Herdr", async () => {
    const { calls, exec } = scriptedExec({});
    await expect(dispatch({ ...options, timeout: -1 }, herdrEnv, exec)).rejects.toThrow(
      /--timeout must be a non-negative integer/
    );
    expect(calls).toEqual([]);
  });
});

const splitPayload = {
  id: "cli:pane:split",
  result: { pane: { pane_id: "w1:p2" } },
};
const tabPayload = {
  id: "cli:tab:create",
  result: { root_pane: { pane_id: "w1:p9" }, tab: { tab_id: "w1:t2" } },
};
const getPayload = {
  id: "cli:agent:get",
  result: { agent: { agent: "claude", agent_status: "idle", name: "ci-explorer" } },
};

function jsonResult(payload: unknown): CommandResult {
  return { stdout: `${JSON.stringify(payload)}\n`, stderr: "", exitCode: 0 };
}

function textResult(text: string): CommandResult {
  return { stdout: text, stderr: "", exitCode: 0 };
}

function failed(stderr: string): CommandResult {
  return { stdout: "", stderr, exitCode: 1 };
}

function commandKey(args: string[]): string {
  return `${args[0]} ${args[1]}`;
}

function scriptedExec(
  replies: Record<string, CommandResult | ((args: string[]) => CommandResult)>
): { calls: string[][]; exec: HerdrExec } {
  const calls: string[][] = [];
  return {
    calls,
    exec: async (args) => {
      calls.push(args);
      const reply = replies[commandKey(args)];
      if (reply === undefined) throw new Error(`unexpected herdr ${args.join(" ")}`);
      return typeof reply === "function" ? reply(args) : reply;
    },
  };
}

const herdrEnv = { HERDR_ENV: "1" };
const splitOk = jsonResult(splitPayload);
const startOk = jsonResult({ id: "cli:agent:start", result: {} });
const promptOk = jsonResult({ id: "cli:agent:prompt", result: {} });
const closeOk = jsonResult({ id: "cli:pane:close", result: {} });
const getIdle = jsonResult(getPayload);
const readOk = textResult("worker output\n");

describe("herdr JSON decoders", () => {
  test("paneId requires result.pane.pane_id", () => {
    expect(paneId(splitPayload)).toBe("w1:p2");
    expect(() => paneId({ result: { pane: {} } })).toThrow(/result.pane.pane_id/);
    expect(() => paneId({ result: {} })).toThrow(/result.pane must be an object/);
  });

  test("paneId reads the tab root pane when placing in a tab", () => {
    expect(paneId(tabPayload, "tab")).toBe("w1:p9");
    expect(() => paneId(tabPayload)).toThrow(/result.pane must be an object/);
    expect(() => paneId(splitPayload, "tab")).toThrow(/result.root_pane must be an object/);
  });

  test("parseAgentStatus accepts only Herdr's five states", () => {
    expect(parseAgentStatus("idle")).toBe("idle");
    expect(parseAgentStatus("working")).toBe("working");
    expect(parseAgentStatus("blocked")).toBe("blocked");
    expect(parseAgentStatus("done")).toBe("done");
    expect(parseAgentStatus("unknown")).toBe("unknown");
    expect(() => parseAgentStatus("ready")).toThrow(/invalid result.agent.agent_status/);
    expect(() => parseAgentStatus(undefined)).toThrow(/invalid result.agent.agent_status/);
  });

  test("agentStatus requires result.agent.agent_status and does not guess", () => {
    expect(agentStatus(getPayload)).toBe("idle");
    expect(
      agentStatus({ result: { agent: { agent_status: "unknown" } } })
    ).toBe("unknown");
    expect(() =>
      agentStatus({ result: { agent: { status: "idle" }, status: "idle" } })
    ).toThrow(/invalid result.agent.agent_status/);
    expect(() => agentStatus({ result: { status: "idle" } })).toThrow(
      /result.agent must be an object/
    );
  });
});

describe("herdr-dispatch Herdr sequence", () => {
  test("passes the same timeout to agent start and prompt --wait", async () => {
    const { calls, exec } = scriptedExec({
      "pane split": splitOk,
      "agent start": startOk,
      "agent prompt": promptOk,
      "agent get": getIdle,
      "agent read": readOk,
    });
    const result = await dispatch(
      { ...options, wait: true, timeout: 45000, readonly: false },
      herdrEnv,
      exec
    );
    expect(result).toMatchObject({
      agent: "ci-explorer",
      pane: "w1:p2",
      status: "idle",
      blocked: false,
      output: "worker output",
    });
    const start = calls.find((args) => commandKey(args) === "agent start");
    const prompt = calls.find((args) => commandKey(args) === "agent prompt");
    if (!start || !prompt) throw new Error("expected start and prompt");
    const dash = start.indexOf("--");
    const timeoutAt = start.indexOf("--timeout");
    expect(timeoutAt).toBeGreaterThan(-1);
    expect(start[timeoutAt + 1]).toBe("45000");
    expect(dash === -1 || timeoutAt < dash).toBe(true);
    expect(prompt).toContain("--wait");
    expect(prompt).toContain("45000");
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });

  test("--effort override reaches agent start's trailing CLI args", async () => {
    const { calls, exec } = scriptedExec({
      "pane split": splitOk,
      "agent start": startOk,
      "agent prompt": promptOk,
    });
    await dispatch({ ...options, effort: "max" }, herdrEnv, exec);
    const start = calls.find((args) => commandKey(args) === "agent start");
    if (!start) throw new Error("expected agent start");
    const dash = start.indexOf("--");
    expect(dash).toBeGreaterThan(-1);
    expect(start.slice(dash)).toContain("--effort");
    expect(start[start.indexOf("--effort") + 1]).toBe("max");
  });

  test("tab placement keeps the worker off the caller's screen", async () => {
    const { calls, exec } = scriptedExec({
      "tab create": jsonResult(tabPayload),
      "agent start": startOk,
      "agent prompt": promptOk,
    });
    const result = await dispatch({ ...options, placement: "tab" }, herdrEnv, exec);
    expect(result.pane).toBe("w1:p9");
    const create = calls.find((args) => commandKey(args) === "tab create");
    if (!create) throw new Error("expected tab create");
    expect(create).toContain("--no-focus");
    expect(create).not.toContain("--focus");
    expect(calls.some((args) => commandKey(args) === "pane split")).toBe(false);
  });

  test("placement chooses between a background tab and a visible split", () => {
    const env = ["--env", "K=v"];
    expect(placementArgs({ placement: "tab", direction: "right", name: "w" }, "/repo", env)).toEqual(
      ["tab", "create", "--cwd", "/repo", "--label", "w", "--no-focus", "--env", "K=v"]
    );
    expect(
      placementArgs({ placement: "split", direction: "down", name: "w" }, "/repo", env)
    ).toEqual([
      "pane",
      "split",
      "--current",
      "--direction",
      "down",
      "--cwd",
      "/repo",
      "--no-focus",
      "--env",
      "K=v",
    ]);
  });

  test("retries agent start while the fresh pane has no shell prompt yet", async () => {
    let attempts = 0;
    const { calls, exec } = scriptedExec({
      "pane split": splitOk,
      "agent start": () => {
        attempts += 1;
        return attempts < 3
          ? failed(
              '{"error":{"code":"agent_pane_busy","message":"agent target pane w1:p2 is not an available shell"}}'
            )
          : startOk;
      },
      "agent prompt": promptOk,
    });
    await dispatch(options, herdrEnv, exec);
    expect(attempts).toBe(3);
    expect(calls.map(commandKey)).toEqual([
      "pane split",
      "agent start",
      "agent start",
      "agent start",
      "agent prompt",
    ]);
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });

  test("only a pane that is not yet a shell is worth retrying", () => {
    expect(isPaneNotReady('{"error":{"code":"agent_pane_busy"}}')).toBe(true);
    expect(isPaneNotReady("agent target pane w1:p2 is not an available shell")).toBe(true);
    expect(isPaneNotReady("agent_not_ready")).toBe(false);
    expect(isPaneNotReady("agent_prompt_stalled")).toBe(false);
  });

  test("closes the pane when agent start fails", async () => {
    const { calls, exec } = scriptedExec({
      "pane split": splitOk,
      "agent start": failed("agent_not_ready"),
      "pane close": closeOk,
    });
    await expect(dispatch(options, herdrEnv, exec)).rejects.toThrow(/agent_not_ready/);
    expect(calls.map(commandKey)).toEqual(["pane split", "agent start", "pane close"]);
    expect(calls[2]).toEqual(["pane", "close", "w1:p2"]);
  });

  test("closes the pane when agent prompt fails", async () => {
    const { calls, exec } = scriptedExec({
      "pane split": splitOk,
      "agent start": startOk,
      "agent prompt": failed("agent_prompt_stalled"),
      "pane close": closeOk,
    });
    await expect(dispatch(options, herdrEnv, exec)).rejects.toThrow(/agent_prompt_stalled/);
    expect(calls.map(commandKey)).toEqual([
      "pane split",
      "agent start",
      "agent prompt",
      "pane close",
    ]);
  });

  test("leaves the pane when agent get fails after prompt acceptance", async () => {
    const { calls, exec } = scriptedExec({
      "pane split": splitOk,
      "agent start": startOk,
      "agent prompt": promptOk,
      "agent get": failed("agent_not_found"),
    });
    await expect(dispatch({ ...options, wait: true }, herdrEnv, exec)).rejects.toThrow(
      /agent_not_found/
    );
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });
});
