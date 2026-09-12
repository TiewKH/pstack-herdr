#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const dispatcher = read("plugins/pstack/skills/poteto-mode/scripts/herdr-dispatch.ts");
const mapping = read("plugins/pstack/skills/poteto-mode/references/herdr-tools.md");
const hook = read("plugins/pstack/hooks/session-start-context.md");
const routes = read("config/routes.example.yaml");

for (const term of ["HERDR_ENV", "PSTACK_HERDR_DEPTH", "CLAUDE_CONFIG_DIR", "CODEX_HOME", '"pane", "split"', '"agent", "start"', '"agent", "prompt"', '"agent", "get"', '"agent", "read"']) {
  if (!dispatcher.includes(term)) throw new Error(`native Herdr dispatcher is missing: ${term}`);
}
if (hook.includes("pstack:herdr-runtime") || hook.includes("HERDR_ENV=1")) throw new Error("session-start hook must not own Herdr delegation");
if (!mapping.includes("herdr-dispatch.ts")) throw new Error("Herdr mapping does not point to dispatcher");

for (const skill of ["how", "why", "arena", "interrogate", "swarm", "reflect"]) {
  const body = read(`plugins/pstack/skills/${skill}/SKILL.md`);
  if (!body.includes("herdr-dispatch")) throw new Error(`${skill} does not structurally route Herdr delegation`);
}
for (const playbook of ["feature", "bug-fix", "refactoring", "perf-issue", "hillclimb", "eval", "autonomous-run", "orchestrate", "autopilot-full", "autopilot-stack"]) {
  const body = read(`plugins/pstack/skills/poteto-mode/playbooks/${playbook}.md`);
  if (!body.includes("herdr-dispatch")) throw new Error(`${playbook} does not structurally route Herdr delegation`);
}
for (const role of ["explorer", "implementation", "difficult-implementation", "judgment", "reviewer", "arena-candidate", "arena-judge", "verifier", "subcoordinator"]) {
  if (!routes.includes(`${role}:`)) throw new Error(`route example is missing role: ${role}`);
}
console.log("Native Herdr dispatch contract checks passed");
