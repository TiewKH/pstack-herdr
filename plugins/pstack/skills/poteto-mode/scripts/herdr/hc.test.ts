import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { herdrRuntime, sandboxHint, type DispatchOptions } from "./dispatch.ts";
import {
  collectApp,
  dispatchApp,
  nextApp,
  parseTerminal,
  settledStatus,
  socketRpc,
  tidyScreen,
  unsettledStatus,
  workerArgv,
  workerEnvironment,
  workerLabels,
  type AppWatcher,
  type HcRpc,
} from "./hc.ts";

const routesDir = mkdtempSync(join(tmpdir(), "pstack-herdr-app-routes-"));
const routes = join(routesDir, "routes.json");
writeFileSync(
  routes,
  JSON.stringify({
    profiles: {
      "claude-a": { kind: "claude", model: "haiku", effort: "low" },
      "codex-a": { kind: "codex" },
    },
    roles: {
      explorer: { profiles: ["claude-a"], strategy: "first" },
      reviewer: { profiles: ["codex-a"], strategy: "first" },
    },
  })
);
afterAll(() => rmSync(routesDir, { recursive: true, force: true }));

const env: NodeJS.ProcessEnv = {
  HC_TERMINAL_ID: "t2",
  HC_TERMINAL_SOCKET: "/nonexistent/hc.sock",
  PATH: "/nonexistent/bin",
};

const options: DispatchOptions = {
  role: "explorer",
  name: "app-explorer",
  prompt: "ping",
  cwd: ".",
  wait: false,
  keepPane: false,
  readonly: false,
  direction: "right",
  placement: "tab",
  routes,
};

const immediate: AppWatcher = async () => ({
  live: true,
  changed: async () => {},
  close() {},
});

function term(fields: Record<string, unknown> = {}) {
  return {
    address: "t9",
    name: "app-explorer",
    state: "live",
    turn: 0,
    status: null,
    labels: { "pstack.kind": "claude" },
    ...fields,
  };
}

// An hc core that answers terminal.get from a script of states, one per read.
function fakeCore(
  states: Record<string, Array<Record<string, unknown>>>,
  caller: Record<string, unknown> = term({
    address: "t2",
    name: null,
    labels: { "herdr.space": "sp1", "herdr.tab": "tb1" },
  })
) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const addresses = new Map<string, string>();
  for (const [name, script] of Object.entries(states))
    addresses.set(String(script[0]?.address ?? "t9"), name);
  const rpc: HcRpc = async (method, params) => {
    calls.push({ method, params });
    const target = String(params.terminal ?? "");
    const name = addresses.get(target) ?? target;
    switch (method) {
      case "terminal.get": {
        if (target === "t2") return caller;
        const script = states[name];
        if (!script) throw new Error(`no terminal "${target}"`);
        return script.length > 1 ? script.shift() : script[0];
      }
      case "terminal.run":
        return term({ name: params.name, labels: params.labels });
      case "terminal.read":
        return { text: `answer from ${name}\n\n\n\n\n   \n`, complete: true, how: "stitched" };
      case "terminal.kill":
      case "terminal.rm":
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  return { rpc, calls, methods: () => calls.map((call) => call.method) };
}

describe("herdr app runtime detection", () => {
  test("a TUI pane wins over the app terminal it runs in", () => {
    expect(herdrRuntime({ HERDR_ENV: "1", HC_TERMINAL_ID: "t1" })).toBe("tui");
    expect(herdrRuntime({ HC_TERMINAL_ID: "t1" })).toBe("app");
    expect(herdrRuntime({})).toBeUndefined();
  });

  test("dispatch outside an app terminal fails before it starts anything", async () => {
    await expect(dispatchApp(options, { PATH: "/bin" }, fakeCore({}).rpc)).rejects.toThrow(
      /HC_TERMINAL_ID and HC_TERMINAL_SOCKET/
    );
  });
});

describe("herdr app settlement", () => {
  test("a task is done once a turn ends; startup idle is not done", () => {
    const at = (turn: number, state: string | null) =>
      settledStatus(parseTerminal(term({ turn, status: state ? { state } : null })));
    expect(at(0, "idle")).toBeUndefined();
    expect(at(0, "working")).toBeUndefined();
    expect(at(0, null)).toBeUndefined();
    expect(at(1, "working")).toBeUndefined();
    expect(at(1, "done")).toBe("done");
    expect(at(1, "idle")).toBe("idle");
    expect(at(1, null)).toBe("done");
    expect(at(0, "blocked")).toBe("blocked");
    expect(at(2, "error")).toBe("error");
    expect(settledStatus(parseTerminal(term({ state: "finished", turn: 0 })))).toBe("exited");
  });

  test("an unsettled worker is working, or unknown when it never started its task", () => {
    expect(unsettledStatus(parseTerminal(term({ status: { state: "working" } })))).toBe("working");
    expect(unsettledStatus(parseTerminal(term({ status: { state: "idle" } })))).toBe("unknown");
  });

  test("tidyScreen drops trailing padding and blank runs", () => {
    expect(tidyScreen("\n a  \n\n\n\n b \n\n\n")).toBe("a\n\n b");
  });
});

describe("herdr app worker launch", () => {
  test("the brief follows -- so a variadic flag cannot swallow it", () => {
    expect(
      workerArgv({ kind: "claude", model: "haiku", effort: "low", prompt: "brief" }, true, "/bin/claude")
    ).toEqual([
      "/bin/claude",
      "--disallowedTools",
      "Write,Edit",
      "--model",
      "haiku",
      "--effort",
      "low",
      "--",
      "brief",
    ]);
    expect(
      workerArgv({ kind: "codex", model: "inherit", effort: undefined, prompt: "brief" }, true, "codex")
    ).toEqual(["codex", "--no-daemon", "--sandbox", "read-only", "--", "brief"]);
  });

  test("a tab joins the caller's space; a split also joins its tab", () => {
    const worker = { profile: "claude-a", kind: "claude" as const, depth: 1 };
    const caller = { "herdr.space": "sp1", "herdr.tab": "tb1" };
    expect(workerLabels({ role: "explorer", placement: "tab" }, worker, caller)).toEqual({
      "pstack.role": "explorer",
      "pstack.profile": "claude-a",
      "pstack.kind": "claude",
      "pstack.depth": "1",
      "herdr.space": "sp1",
    });
    expect(workerLabels({ role: "explorer", placement: "split" }, worker, caller)["herdr.tab"]).toBe("tb1");
    const hidden = workerLabels({ role: "explorer", placement: "split" }, worker, {});
    expect(hidden["herdr.space"]).toBeUndefined();
    expect(hidden["herdr.tab"]).toBeUndefined();
  });

  test("the worker gets the caller's PATH and routes file, and expanded profile env", () => {
    expect(
      workerEnvironment(
        { childEnv: { CLAUDE_CONFIG_DIR: "~/.claude-b", PSTACK_HERDR_DEPTH: "1" } },
        { PATH: "/a:/b", PSTACK_HERDR_ROUTES: "/r.yaml", SECRET: "x" }
      )
    ).toEqual({
      PATH: "/a:/b",
      PSTACK_HERDR_ROUTES: "/r.yaml",
      CLAUDE_CONFIG_DIR: join(homedir(), ".claude-b"),
      PSTACK_HERDR_DEPTH: "1",
    });
  });

  test("a background dispatch starts one labelled terminal and returns its handle", async () => {
    const core = fakeCore({ "app-explorer": [term()] });
    const owned: Array<string | undefined> = [];
    const result = await dispatchApp(options, env, core.rpc, immediate, (t) => owned.push(t));
    expect(result).toEqual({
      agent: "app-explorer",
      terminal: "t9",
      profile: "claude-a",
      kind: "claude",
      depth: 1,
    });
    expect(core.methods()).toEqual(["terminal.get", "terminal.run"]);
    const run = core.calls[1].params;
    expect(run.argv).toEqual(["claude", "--model", "haiku", "--effort", "low", "--", "ping"]);
    expect(run.caller).toBe("t2");
    expect(run.cwd).toBe(resolve("."));
    expect(run.no_notify).toBe(true);
    expect((run.labels as Record<string, string>)["herdr.space"]).toBe("sp1");
    expect((run.env as Record<string, string>).PSTACK_HERDR_DEPTH).toBe("1");
    expect(owned).toEqual(["t9"]);
  });

  test("--wait skips startup idle, reads the finished turn, and closes the terminal", async () => {
    const core = fakeCore({
      "app-explorer": [
        term({ status: { state: "idle" } }),
        term({ status: { state: "working" } }),
        term({ turn: 1, status: { state: "done" } }),
      ],
    });
    const result = await dispatchApp({ ...options, wait: true }, env, core.rpc, immediate);
    expect(result).toMatchObject({
      status: "done",
      blocked: false,
      paneClosed: true,
      output: "answer from app-explorer",
    });
    expect(core.methods().slice(-3)).toEqual(["terminal.read", "terminal.kill", "terminal.rm"]);
  });

  test("a budget that runs out hands the worker back open as working", async () => {
    const core = fakeCore({ "app-explorer": [term({ status: { state: "working" } })] });
    const result = await dispatchApp({ ...options, wait: true, timeout: 0 }, env, core.rpc, immediate);
    expect(result).toMatchObject({ status: "working", paneClosed: false });
    expect(core.methods()).not.toContain("terminal.kill");
  });

  test("a blocked worker stays open for the person to answer", async () => {
    const core = fakeCore({ "app-explorer": [term({ status: { state: "blocked" } })] });
    const result = await dispatchApp({ ...options, wait: true }, env, core.rpc, immediate);
    expect(result).toMatchObject({ status: "blocked", blocked: true, paneClosed: false });
    expect(core.methods()).not.toContain("terminal.rm");
  });

  test("--keep-pane leaves a finished worker open", async () => {
    const core = fakeCore({ "app-explorer": [term({ turn: 1, status: { state: "done" } })] });
    const result = await dispatchApp(
      { ...options, wait: true, keepPane: true },
      env,
      core.rpc,
      immediate
    );
    expect(result).toMatchObject({ status: "done", paneClosed: false });
    expect(core.methods()).not.toContain("terminal.kill");
  });

  test("an exited worker is removed without a kill", async () => {
    const core = fakeCore({ "app-explorer": [term({ state: "finished", exit_code: 1 })] });
    const result = await dispatchApp({ ...options, wait: true }, env, core.rpc, immediate);
    expect(result).toMatchObject({ status: "exited", paneClosed: true });
    expect(core.methods()).toContain("terminal.rm");
    expect(core.methods()).not.toContain("terminal.kill");
  });
});

describe("herdr app collection", () => {
  test("--collect refuses a terminal the dispatcher did not start", async () => {
    const core = fakeCore({ stranger: [term({ name: "stranger", labels: {} })] });
    await expect(
      collectApp({ name: "stranger", keepPane: false, routes }, env, core.rpc, immediate)
    ).rejects.toThrow(/not a pstack worker/);
  });

  test("--collect finishes a working worker", async () => {
    const core = fakeCore({
      "app-explorer": [
        term({ status: { state: "working" } }),
        term({ turn: 1, status: { state: "idle" } }),
      ],
    });
    const result = await collectApp(
      { name: "app-explorer", keepPane: false, routes },
      env,
      core.rpc,
      immediate
    );
    expect(result).toMatchObject({ agent: "app-explorer", terminal: "t9", status: "idle", paneClosed: true });
  });

  test("--next returns the first settled worker and leaves the rest pending", async () => {
    const core = fakeCore({
      a: [term({ address: "t5", name: "a", turn: 1, status: { state: "done" } })],
      b: [term({ address: "t6", name: "b", labels: { "pstack.kind": "codex" }, status: { state: "working" } })],
    });
    const result = await nextApp({ names: ["a b"], keepPane: false, routes }, env, core.rpc, immediate);
    expect(result.pending).toEqual(["b"]);
    expect(result.settled).toEqual([
      {
        agent: "a",
        terminal: "t5",
        kind: "claude",
        status: "done",
        blocked: false,
        paneClosed: true,
        output: "answer from a",
      },
    ]);
    const killed = core.calls.filter((call) => call.method === "terminal.kill");
    expect(killed.map((call) => call.params.terminal)).toEqual(["t5"]);
  });

  test("--next reports a missing worker as a failure without waiting", async () => {
    const core = fakeCore({});
    const result = await nextApp({ names: ["gone"], keepPane: false, routes }, env, core.rpc, immediate);
    expect(result.pending).toEqual([]);
    expect(result.settled[0]).toMatchObject({ agent: "gone" });
    expect((result.settled[0] as { error: string }).error).toMatch(/no terminal/);
  });
});

describe("Codex sandbox hint", () => {
  test("a socket denial inside a network-less Codex sandbox names the fix", () => {
    const sandboxed = { CODEX_SANDBOX: "seatbelt", CODEX_SANDBOX_NETWORK_DISABLED: "1" };
    for (const detail of [
      "connect ECONNREFUSED /x/default.sock",
      'Error: Os { code: 1, kind: PermissionDenied, message: "Operation not permitted" }',
    ]) {
      expect(sandboxHint(detail, sandboxed)).toContain("network_access = true under [sandbox_workspace_write]");
    }
  });

  test("other errors, and denials outside the sandbox, are left alone", () => {
    expect(sandboxHint("connect ECONNREFUSED /x", {})).toBe("connect ECONNREFUSED /x");
    expect(sandboxHint("agent target x not found", { CODEX_SANDBOX_NETWORK_DISABLED: "1" })).toBe(
      "agent target x not found"
    );
  });

  test("a refused hc socket inside the sandbox carries the hint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-hc-sock-"));
    const path = join(dir, "core.sock");
    // A socket whose listener was SIGKILLed stays on disk and refuses connections,
    // as the sandbox does.
    const listener = Bun.spawn(["bun", "-e", `require("net").createServer().listen(${JSON.stringify(path)}, () => console.log("up"))`], {
      stdout: "pipe",
    });
    await listener.stdout.getReader().read();
    listener.kill("SIGKILL");
    await listener.exited;
    try {
      const rpc = socketRpc(path, { CODEX_SANDBOX_NETWORK_DISABLED: "1" });
      await expect(rpc("terminal.get", { terminal: "t1" })).rejects.toThrow(/network_access = true/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
