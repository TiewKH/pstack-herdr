import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
  planDispatch,
  promptNeedle,
  readonlyAgentArgs,
  selectProfileName,
  stableIndex,
  turnEvidence,
  workerEnv,
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
  keepPane: false,
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

const waitOk = jsonResult({ id: "cli:agent:wait", result: {} });
const getStatus = (status: string): CommandResult =>
  jsonResult({
    id: "cli:agent:get",
    result: { agent: { agent: "claude", agent_status: status, name: "ci-explorer" } },
  });
// The first `agent get` answers the delivery poll; later ones answer the settled read.
const getAfterPrompt = (...statuses: string[]) => {
  let calls = 0;
  return () => getStatus(statuses[Math.min(calls++, statuses.length - 1)]);
};
const welcomeScreen = textResult("Welcome to Claude Code\n\n❯\n");
const happyPath = () => ({
  "pane split": splitOk,
  "agent start": startOk,
  "agent wait": waitOk,
  "agent prompt": promptOk,
  "agent get": getAfterPrompt("done", "idle"),
  "agent read": readOk,
});
const noDelay = { ...herdrEnv, PSTACK_HERDR_DELIVERY_WINDOW_MS: "0" };

describe("herdr-dispatch Herdr sequence", () => {
  test("passes the timeout and closes a completed worker after reading its output", async () => {
    const { calls, exec } = scriptedExec({ ...happyPath(), "pane close": closeOk });
    const result = await dispatch(
      { ...options, wait: true, timeout: 45000, readonly: false },
      herdrEnv,
      exec,
      () => true
    );
    expect(result).toMatchObject({
      agent: "ci-explorer",
      pane: "w1:p2",
      status: "idle",
      blocked: false,
      paneClosed: true,
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
    expect(prompt).not.toContain("--wait");
    expect(calls.find((args) => commandKey(args) === "agent wait" && !args.includes("--until"))).toEqual(
      ["agent", "wait", "ci-explorer", "--timeout", "45000"]
    );
    expect(calls.map(commandKey).slice(-2)).toEqual(["agent read", "pane close"]);
  });

  test("--keep-pane retains a completed worker for inspection", async () => {
    const { calls, exec } = scriptedExec(happyPath());
    const result = await dispatch(
      { ...options, wait: true, keepPane: true },
      herdrEnv,
      exec,
      () => true
    );
    expect(result).toMatchObject({ status: "idle", paneClosed: false, output: "worker output" });
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });

  test("waits for the worker to report idle before typing the prompt", async () => {
    const { calls, exec } = scriptedExec(happyPath());
    await dispatch(options, herdrEnv, exec);
    expect(calls.map(commandKey)).toEqual([
      "pane split",
      "agent start",
      "agent wait",
      "agent prompt",
      "agent get",
    ]);
    expect(calls[2]).toEqual([
      "agent",
      "wait",
      "ci-explorer",
      "--until",
      "idle",
      "--until",
      "blocked",
      "--timeout",
      "180000",
    ]);
  });

  test("a worker that never reports idle still gets the prompt", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent wait": failed('{"error":{"code":"timeout","message":"x"}}'),
    });
    await dispatch(options, herdrEnv, exec);
    expect(calls.map(commandKey)).toContain("agent prompt");
  });

  test("a worker that finishes inside the delivery window is prompted once and kept", async () => {
    const { calls, exec } = scriptedExec({ ...happyPath(), "agent get": getStatus("done") });
    await dispatch(options, herdrEnv, exec);
    expect(calls.filter((args) => commandKey(args) === "agent prompt")).toHaveLength(1);
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });

  test("a working or blocked worker also proves delivery", async () => {
    for (const status of ["working", "blocked"]) {
      const { calls, exec } = scriptedExec({ ...happyPath(), "agent get": getStatus(status) });
      await dispatch(options, herdrEnv, exec);
      expect(calls.filter((args) => commandKey(args) === "agent prompt")).toHaveLength(1);
    }
  });

  test("an echoed prompt on an idle agent is not delivery", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent get": getStatus("idle"),
      "agent read": textResult("❯ Read-only worker. Do not write files\n"),
      "pane close": closeOk,
    });
    const error = await dispatch(options, noDelay, exec).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/not delivered after 2 attempts/);
    expect(calls.filter((args) => commandKey(args) === "agent prompt")).toHaveLength(2);
    expect(calls.map(commandKey).at(-1)).toBe("pane close");
  });

  test("a swallowed prompt is retried once, then fails with the screen and closes the pane", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent get": getStatus("idle"),
      "agent read": welcomeScreen,
      "pane close": closeOk,
    });
    const error = await dispatch(options, noDelay, exec).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/not delivered after 2 attempts/);
    expect((error as Error).message).toMatch(/Welcome to Claude Code/);
    expect(calls.filter((args) => commandKey(args) === "agent prompt")).toHaveLength(2);
    expect(calls.map(commandKey).at(-1)).toBe("pane close");
  });

  test("--effort override reaches agent start's trailing CLI args", async () => {
    const { calls, exec } = scriptedExec(happyPath());
    await dispatch({ ...options, effort: "max" }, herdrEnv, exec);
    const start = calls.find((args) => commandKey(args) === "agent start");
    if (!start) throw new Error("expected agent start");
    const dash = start.indexOf("--");
    expect(dash).toBeGreaterThan(-1);
    expect(start.slice(dash)).toContain("--effort");
    expect(start[start.indexOf("--effort") + 1]).toBe("max");
  });

  test("tab placement keeps the worker off the caller's screen", async () => {
    const { calls, exec } = scriptedExec({ ...happyPath(), "tab create": jsonResult(tabPayload) });
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
      ...happyPath(),
      "agent start": () => {
        attempts += 1;
        return attempts < 3
          ? failed(
              '{"error":{"code":"agent_pane_busy","message":"agent target pane w1:p2 is not an available shell"}}'
            )
          : startOk;
      },
    });
    await dispatch(options, herdrEnv, exec);
    expect(attempts).toBe(3);
    expect(calls.map(commandKey).slice(0, 5)).toEqual([
      "pane split",
      "agent start",
      "agent start",
      "agent start",
      "agent wait",
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
    expect(calls.map(commandKey)).toEqual(["pane split", "agent start", "agent read", "pane close"]);
    expect(calls[3]).toEqual(["pane", "close", "w1:p2"]);
  });

  test("reads the worker screen, then closes the pane, when agent prompt is rejected", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent prompt": failed("agent_blocked"),
      "agent read": textResult("Choose the text style that looks best with your terminal\n"),
      "pane close": closeOk,
    });
    const error = await dispatch(options, herdrEnv, exec).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/agent_blocked/);
    expect((error as Error).message).toMatch(/Choose the text style/);
    expect(calls.map(commandKey)).toEqual([
      "pane split",
      "agent start",
      "agent wait",
      "agent prompt",
      "agent read",
      "pane close",
    ]);
    expect(calls[4]).toEqual(["agent", "read", "ci-explorer", "--source", "visible", "--lines", "24"]);
  });

  test("a rejected prompt's error names the prompt size, not its text", async () => {
    const { exec } = scriptedExec({
      ...happyPath(),
      "agent prompt": failed("agent_blocked"),
      "pane close": closeOk,
    });
    const error = await dispatch(
      { ...options, prompt: "x".repeat(2000), readonly: false },
      herdrEnv,
      exec
    ).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/herdr agent prompt ci-explorer <2000 chars> failed/);
    expect((error as Error).message).not.toContain("xxxxxxxxxx");
  });

  test("a failed screen read does not hide the prompt error", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent prompt": failed("agent_blocked"),
      "agent read": failed("agent_not_found"),
      "pane close": closeOk,
    });
    await expect(dispatch(options, herdrEnv, exec)).rejects.toThrow(/agent_blocked/);
    expect(calls.map(commandKey).at(-1)).toBe("pane close");
  });

  test("a --wait timeout leaves the pane open and reports the live status", async () => {
    let waits = 0;
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent wait": (args) => {
        waits += 1;
        return args.includes("--until")
          ? waitOk
          : failed('{"error":{"code":"timeout","message":"timed out waiting for agent status"},"id":"cli:agent:wait"}');
      },
      "agent get": getStatus("working"),
      "agent read": (args) =>
        args.includes("visible") ? textResult("Contemplating...\n") : failed("agent_not_idle"),
    });
    const result = await dispatch({ ...options, wait: true }, herdrEnv, exec);
    expect(waits).toBe(2);
    expect(result).toMatchObject({
      status: "working",
      blocked: false,
      paneClosed: false,
      output: "Contemplating...",
    });
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });

  test("blocked and unknown workers stay open", async () => {
    for (const status of ["blocked", "unknown"] as const) {
      const { calls, exec } = scriptedExec({
        ...happyPath(),
        "agent get": getAfterPrompt("working", status),
      });
      const result = await dispatch({ ...options, wait: true }, herdrEnv, exec);
      expect(result).toMatchObject({ status, paneClosed: false });
      expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
    }
  });

  test("reports a completed-worker cleanup failure", async () => {
    const { exec } = scriptedExec({ ...happyPath(), "pane close": failed("close failed") });
    await expect(
      dispatch({ ...options, wait: true }, herdrEnv, exec, () => true)
    ).rejects.toThrow(/close failed/);
  });

  test("a done verdict without a transcript of the prompt is a failed run, not a result", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent get": getAfterPrompt("done", "done"),
      "agent read": (args) =>
        args.includes("visible") ? textResult("OpenAI Codex\n\n› Ask Codex to do anything\n") : readOk,
    });
    await expect(
      dispatch({ ...options, wait: true }, herdrEnv, exec, () => false)
    ).rejects.toThrow(/reports done, but no claude transcript[\s\S]*never ran it[\s\S]*Ask Codex/);
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(true);
  });

  test("a verified idle verdict closes after its output is read", async () => {
    const seen: unknown[] = [];
    // The first read answers the delivery poll; the settled read carries the session id.
    let gets = 0;
    const sessionGet = () =>
      jsonResult({
        id: "cli:agent:get",
        result: {
          agent: {
            agent: "claude",
            agent_status: gets++ === 0 ? "done" : "idle",
            name: "ci-explorer",
            agent_session: { kind: "id", value: "abc-123" },
          },
        },
      });
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent get": sessionGet,
      "pane close": closeOk,
    });
    const before = Date.now();
    const result = await dispatch({ ...options, wait: true }, herdrEnv, exec, (query) => {
      seen.push(query);
      return true;
    });
    expect(result).toMatchObject({ status: "idle", paneClosed: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "claude", sessionId: "abc-123" });
    const query = seen[0] as { prompt: string; since: number };
    expect(query.prompt.endsWith("ping")).toBe(true);
    expect(query.since).toBeLessThanOrEqual(before);
    expect(calls.map(commandKey).at(-1)).toBe("pane close");
  });

  test("a working verdict needs no transcript yet", async () => {
    const { exec } = scriptedExec({
      ...happyPath(),
      "agent wait": (args) =>
        args.includes("--until")
          ? waitOk
          : failed('{"error":{"code":"timeout","message":"timed out"},"id":"cli:agent:wait"}'),
      "agent get": getStatus("working"),
      "agent read": textResult("Contemplating...\n"),
    });
    const result = await dispatch({ ...options, wait: true }, herdrEnv, exec, () => false);
    expect(result).toMatchObject({ status: "working" });
  });

  test("a wait failure that is not a timeout propagates and leaves the pane", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent wait": (args) =>
        args.includes("--until")
          ? waitOk
          : failed('{"error":{"code":"agent_not_found","message":"gone"},"id":"cli:agent:wait"}'),
    });
    await expect(dispatch({ ...options, wait: true }, herdrEnv, exec)).rejects.toThrow(
      /agent_not_found/
    );
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });

  test("leaves the pane when agent get fails after the prompt was typed", async () => {
    const { calls, exec } = scriptedExec({
      ...happyPath(),
      "agent get": failed("agent_not_found"),
    });
    await expect(dispatch({ ...options, wait: true }, herdrEnv, exec)).rejects.toThrow(
      /agent_not_found/
    );
    expect(calls.some((args) => commandKey(args) === "pane close")).toBe(false);
  });
});

describe("herdr-dispatch worker environment", () => {
  test("a config home equal to the CLI default is not passed to the worker", () => {
    expect(workerEnv("claude", { CLAUDE_CONFIG_DIR: "~/.claude", EXTRA_FLAG: "1" }, "/Users/x", {})).toEqual({
      EXTRA_FLAG: "1",
    });
    expect(workerEnv("claude", { CLAUDE_CONFIG_DIR: "/Users/x/.claude/" }, "/Users/x", {})).toEqual({});
    expect(workerEnv("codex", { CODEX_HOME: "~/.codex" }, "/Users/x", {})).toEqual({});
    expect(
      workerEnv("claude", { CLAUDE_CONFIG_DIR: "~/.claude" }, "/Users/x", {
        CLAUDE_CONFIG_DIR: "/Users/x/.claude",
      })
    ).toEqual({});
  });

  test("the default home still overrides an ambient home that points at another account", () => {
    expect(
      workerEnv("claude", { CLAUDE_CONFIG_DIR: "~/.claude" }, "/Users/x", {
        CLAUDE_CONFIG_DIR: "~/.claude-a",
      })
    ).toEqual({ CLAUDE_CONFIG_DIR: "~/.claude" });
  });

  test("a separately authenticated config home still reaches the worker", () => {
    expect(workerEnv("claude", { CLAUDE_CONFIG_DIR: "~/.claude-a" }, "/Users/x", {})).toEqual({
      CLAUDE_CONFIG_DIR: "~/.claude-a",
    });
    expect(workerEnv("codex", { CODEX_HOME: "~/.codex-a" }, "/Users/x", {})).toEqual({
      CODEX_HOME: "~/.codex-a",
    });
  });

  test("the plan caps agent start at Herdr's 300000 ms and keeps the full wait budget", () => {
    const plan = planDispatch({ ...options, timeout: 900000 }, herdrEnv);
    expect(plan.startTimeout).toBe(300000);
    expect(plan.timeout).toBe(900000);
    expect(plan.deliveryWindow).toBe(8000);
    expect(planDispatch(options, { ...herdrEnv, PSTACK_HERDR_DELIVERY_WINDOW_MS: "250" }).deliveryWindow).toBe(250);
  });

  test("the plan drops the default Claude home from the pane environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-herdr-default-home-"));
    const routes = join(dir, "routes.json");
    writeFileSync(
      routes,
      JSON.stringify({
        profiles: { "claude-main": { kind: "claude", env: { CLAUDE_CONFIG_DIR: "~/.claude" } } },
        roles: { judgment: { profiles: ["claude-main"], strategy: "first" } },
      })
    );
    try {
      const plan = planDispatch({ ...options, role: "judgment", routes }, herdrEnv);
      const envValues = plan.placeArgs.filter((_, i) => plan.placeArgs[i - 1] === "--env");
      expect(envValues.some((v) => v.startsWith("CLAUDE_CONFIG_DIR="))).toBe(false);
      expect(envValues).toContain("PSTACK_HERDR_DEPTH=1");
      expect(plan.profile).toBe("claude-main");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("herdr-dispatch turn evidence", () => {
  test("the needle is the prompt's first line after the read-only prefix, JSON-escaped", () => {
    expect(promptNeedle(applyReadonlyPrompt('# Task "one"\nbody', true))).toBe('# Task \\"one\\"');
    expect(promptNeedle("\n\nSecond line first\nmore")).toBe("Second line first");
    expect(promptNeedle("x".repeat(200)).length).toBe(120);
  });

  test("a codex rollout written after the prompt that quotes it is evidence; older or silent files are not", () => {
    const home = mkdtempSync(join(tmpdir(), "pstack-herdr-evidence-"));
    try {
      const day = join(home, ".codex", "sessions", "2026", "09", "16");
      mkdirSync(day, { recursive: true });
      const since = Date.now() - 1000;
      const prompt = "# PARK-1: rename the flag\n\nDo the work.";
      const line = JSON.stringify({ payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } });
      const stale = join(day, "rollout-old.jsonl");
      writeFileSync(stale, `${line}\n`);
      const old = new Date(since - 60_000);
      utimesSync(stale, old, old);
      const query = { kind: "codex" as const, prompt, since, env: {}, home };
      expect(turnEvidence(query)).toBe(false);
      writeFileSync(join(day, "rollout-silent.jsonl"), `${JSON.stringify({ payload: { type: "session_meta" } })}\n`);
      expect(turnEvidence(query)).toBe(false);
      writeFileSync(join(day, "rollout-live.jsonl"), `${line}\n`);
      expect(turnEvidence(query)).toBe(true);
      expect(turnEvidence({ ...query, prompt: "# PARK-2: something else" })).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a claude worker is pinned to its own session transcript under the configured home", () => {
    const home = mkdtempSync(join(tmpdir(), "pstack-herdr-evidence-"));
    try {
      const projects = join(home, "claude-alt", "projects", "-Users-me-repo");
      mkdirSync(projects, { recursive: true });
      const prompt = "Review the diff.\nDetails follow.";
      const line = JSON.stringify({ type: "user", message: { role: "user", content: prompt } });
      writeFileSync(join(projects, "other.jsonl"), `${line}\n`);
      const since = Date.now() - 1000;
      const env = { CLAUDE_CONFIG_DIR: join(home, "claude-alt") };
      expect(turnEvidence({ kind: "claude", prompt, since, sessionId: "mine", env, home })).toBe(false);
      writeFileSync(join(projects, "mine.jsonl"), `${line}\n`);
      expect(turnEvidence({ kind: "claude", prompt, since, sessionId: "mine", env, home })).toBe(true);
      expect(turnEvidence({ kind: "claude", prompt, since, env, home })).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a claude transcript under the default config home is evidence with no session id known", () => {
    const home = mkdtempSync(join(tmpdir(), "pstack-herdr-evidence-"));
    try {
      const prompt = "pstack-herdr-e2e";
      const since = Date.now() - 1000;
      const query = { kind: "claude" as const, prompt, since, env: {}, home };
      expect(turnEvidence(query)).toBe(false);
      const projects = join(home, ".claude", "projects", "pstack-herdr-e2e");
      mkdirSync(projects, { recursive: true });
      const line = JSON.stringify({ type: "user", message: { role: "user", content: prompt } });
      writeFileSync(join(projects, "session.jsonl"), `${line}\n`);
      expect(turnEvidence(query)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
