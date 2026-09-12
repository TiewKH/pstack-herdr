import { describe, expect, test } from "bun:test";
import { parseRoutes, selectProfileName, stableIndex, type RoutesConfig } from "./herdr-dispatch.ts";

describe("herdr-dispatch routing", () => {
  const config: RoutesConfig = {
    profiles: {
      "claude-a": { kind: "claude" },
      "codex-a": { kind: "codex" },
    },
    roles: {
      explorer: {
        profiles: ["claude-a", "codex-a"],
        strategy: "round-robin",
      },
      judgment: {
        profiles: ["claude-a"],
        strategy: "strongest-first",
      },
    },
  };

  test("stableIndex is deterministic", () => {
    expect(stableIndex("reviewer-a", 3)).toBe(stableIndex("reviewer-a", 3));
  });

  test("spread roles deterministically select from their pool", () => {
    const selected = selectProfileName(config, "explorer", "explorer-a");
    if (!selected) throw new Error("expected configured explorer profile");
    expect(["claude-a", "codex-a"]).toContain(selected);
  });

  test("strongest-first uses the first configured profile", () => {
    expect(selectProfileName(config, "judgment", "judge-a")).toBe("claude-a");
  });

  test("unknown roles fall back to the parent runtime", () => {
    expect(selectProfileName(config, "missing", "worker-a")).toBeUndefined();
  });

  test("JSON routes are supported for environments without YAML parsing", () => {
    expect(parseRoutes(JSON.stringify(config))).toEqual(config);
  });
});
