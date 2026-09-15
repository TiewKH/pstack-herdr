#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const mapping = read("plugins/pstack/skills/poteto-mode/references/herdr-tools.md");
const poteto = read("plugins/pstack/skills/poteto-mode/SKILL.md");
const hook = read("plugins/pstack/hooks/session-start-context.md");
const routes = read("config/routes.example.yaml");
const setup = read("plugins/pstack/skills/setup-pstack/SKILL.md");
const skills = [
  "how",
  "why",
  "arena",
  "interrogate",
  "swarm",
  "reflect",
  "automate-me",
  "maintain-verification-skill",
  "show-me-your-work",
  "recall",
  "no-comments",
];
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

if (hook.includes("pstack:herdr-runtime") || hook.includes("HERDR_ENV=1")) {
  throw new Error("session-start hook must not own Herdr delegation");
}
const hooks = JSON.parse(read("plugins/pstack/hooks/hooks.json")).hooks;
const agentGate = (hooks.PreToolUse ?? []).find(
  (group) =>
    group.matcher === "Agent" &&
    group.hooks.some((h) => h.command.includes("hooks/herdr-agent-gate.sh"))
);
if (!agentGate) throw new Error("hooks.json must gate the Agent tool with herdr-agent-gate.sh");
if (!mapping.includes("herdr-agent-gate.sh") || !mapping.includes("PSTACK_HERDR_ALLOW_NATIVE_AGENT")) {
  throw new Error("Herdr mapping does not document the Agent gate and its bypass");
}
if (!mapping.includes("herdr-dispatch.ts")) throw new Error("Herdr mapping does not point to dispatcher");
if (!mapping.includes("| `how` |") || !mapping.includes("| Feature / bug-fix")) {
  throw new Error("Herdr mapping is missing per-skill notes");
}
for (const skill of ["automate-me", "maintain-verification-skill", "show-me-your-work", "recall", "no-comments"]) {
  if (!mapping.includes("| `" + skill + "` |")) {
    throw new Error(`Herdr mapping is missing delegated skill note: ${skill}`);
  }
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

if (!setup.includes("If `HERDR_ENV=1`, follow **Herdr setup**")) {
  throw new Error("setup-pstack does not branch on Herdr runtime");
}
if (!setup.includes("configure-herdr.ts") || !setup.includes("Do not write YAML yourself.")) {
  throw new Error("setup-pstack does not delegate Herdr config writes to the deterministic script");
}
if (!setup.includes("~/.config/pstack-herdr/routes.yaml")) {
  throw new Error("setup-pstack does not configure the Herdr route file");
}
if (!setup.includes("Herdr-backed delegation does not read `~/.claude/pstack-models.md`")) {
  throw new Error("setup-pstack does not explain the native override is bypassed by Herdr");
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
  if (!setup.includes("`" + role + "`")) {
    throw new Error(`setup-pstack Herdr setup is missing role: ${role}`);
  }
}
if (!setup.includes("If `~/.config/pstack-herdr/routes.yaml` already exists, read it")) {
  throw new Error("setup-pstack Herdr setup does not load existing routes as current choices");
}
if (!setup.includes("Show every profile") || !setup.includes("Ask whether to accept as-is")) {
  throw new Error("setup-pstack Herdr setup does not show current routes and confirm before rewriting");
}
if (!setup.includes("Multiple profiles may share the same config home")) {
  throw new Error("setup-pstack does not document single-subscription multi-profile routing");
}
if (!setup.includes("## Native setup") || !setup.includes("~/.claude/pstack-models.md")) {
  throw new Error("setup-pstack lost the native fallback configuration path");
}

console.log("Native Herdr dispatch contract checks passed");
