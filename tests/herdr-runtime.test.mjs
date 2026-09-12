#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const dispatcher = read("plugins/pstack/skills/poteto-mode/scripts/herdr-dispatch.ts");
const mapping = read("plugins/pstack/skills/poteto-mode/references/herdr-tools.md");
const poteto = read("plugins/pstack/skills/poteto-mode/SKILL.md");
const hook = read("plugins/pstack/hooks/session-start-context.md");
const routes = read("config/routes.example.yaml");
const skills = ["how", "why", "arena", "interrogate", "swarm", "reflect"];
const playbooks = [
  "feature",
  "bug-fix",
  "refactoring",
  "perf-issue",
  "hillclimb",
  "eval",
  "multi-phase-plan",
  "autonomous-run",
  "orchestrate",
  "autopilot-full",
  "autopilot-stack",
];

for (const term of [
  "HERDR_ENV",
  "PSTACK_HERDR_DEPTH",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "--disallowedTools",
  "read-only",
  '"pane"',
  '"split"',
  '"agent"',
  '"start"',
  '"prompt"',
  '"get"',
  '"read"',
]) {
  if (!dispatcher.includes(term)) throw new Error(`native Herdr dispatcher is missing: ${term}`);
}
if (hook.includes("pstack:herdr-runtime") || hook.includes("HERDR_ENV=1")) {
  throw new Error("session-start hook must not own Herdr delegation");
}
if (!mapping.includes("herdr-dispatch.ts")) throw new Error("Herdr mapping does not point to dispatcher");
if (!mapping.includes("| `how` |") || !mapping.includes("| Feature / bug-fix")) {
  throw new Error("Herdr mapping is missing per-skill notes");
}
if (!poteto.includes("herdr-tools.md")) {
  throw new Error("poteto-mode Platform Adaptation does not point at the Herdr mapping");
}
for (const skill of skills) {
  const body = read(`plugins/pstack/skills/${skill}/SKILL.md`);
  if (!body.includes("herdr-tools.md")) {
    throw new Error(`${skill} does not point at the Herdr mapping`);
  }
  if (body.includes("Under Herdr") || body.includes("Outside Herdr") || body.includes("herdr-dispatch")) {
    throw new Error(`${skill} dual-paths Herdr instead of using the mapping`);
  }
}
for (const playbook of playbooks) {
  const body = read(`plugins/pstack/skills/poteto-mode/playbooks/${playbook}.md`);
  if (
    body.includes("herdr-dispatch") ||
    body.includes("Under Herdr") ||
    body.includes("Outside Herdr") ||
    body.includes("HERDR_ENV")
  ) {
    throw new Error(`${playbook} dual-paths Herdr instead of inheriting the mapping`);
  }
}
const plan = read("plugins/pstack/skills/poteto-mode/playbooks/multi-phase-plan.md");
if (!plan.includes("````markdown")) {
  throw new Error("multi-phase-plan.md must keep the live plan skeleton");
}
for (const role of [
  "explorer",
  "implementation",
  "difficult-implementation",
  "judgment",
  "reviewer",
  "arena-candidate",
  "arena-judge",
  "verifier",
  "subcoordinator",
]) {
  if (!routes.includes(`${role}:`)) throw new Error(`route example is missing role: ${role}`);
}
if (routes.includes("workspace:") || routes.includes("round-robin") || routes.includes("strongest-first")) {
  throw new Error("route example still documents unused workspace or collapsed strategy names");
}
console.log("Native Herdr dispatch contract checks passed");
