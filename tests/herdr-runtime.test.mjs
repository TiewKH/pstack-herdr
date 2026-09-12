#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const runtime = read("plugins/pstack/skills/herdr-runtime/SKILL.md");
const hook = read("plugins/pstack/hooks/session-start-context.md");
const routes = read("plugins/pstack/skills/herdr-runtime/references/routes.example.yaml");

const requiredRuntimeTerms = [
  "HERDR_ENV=1",
  "PSTACK_HERDR_DEPTH",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "herdr agent start",
  "herdr agent prompt",
  "herdr agent wait",
  "herdr agent read",
  "Separate Before Serializing Shared State",
];

for (const term of requiredRuntimeTerms) {
  if (!runtime.includes(term)) throw new Error(`herdr-runtime is missing required contract: ${term}`);
}

if (!hook.includes("pstack:herdr-runtime")) {
  throw new Error("session-start mandate does not activate pstack:herdr-runtime");
}

if (!hook.includes("HERDR_ENV=1")) {
  throw new Error("session-start mandate does not gate Herdr activation on HERDR_ENV=1");
}

for (const role of [
  "explorer",
  "implementation",
  "reviewer",
  "arena-candidate",
  "arena-judge",
  "verifier",
  "subcoordinator",
]) {
  if (!routes.includes(`${role}:`)) throw new Error(`route example is missing role: ${role}`);
}

console.log("Herdr runtime contract checks passed");
