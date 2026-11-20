#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  "architect",
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
  "thermos",
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

if (hook.includes("pstack:herdr-runtime") || hook.includes("HERDR_ENV=1") || hook.includes("HC_TERMINAL_ID")) {
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
if (!mapping.includes("herdr/dispatch.ts")) throw new Error("Herdr mapping does not point to dispatcher");
if (!mapping.includes("`HERDR_ENV=1` or `HC_TERMINAL_ID` is set") || !mapping.includes("## Runtimes")) {
  throw new Error("Herdr mapping does not cover both the Herdr TUI and the Herdr app");
}
if (!mapping.includes("| `how` |") || !mapping.includes("| [feature](../playbooks/feature.md), [bug-fix](../playbooks/bug-fix.md)")) {
  throw new Error("Herdr mapping is missing per-skill notes");
}
for (const skill of ["automate-me", "maintain-verification-skill", "show-me-your-work", "recall", "no-comments", "thermos"]) {
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
  // A pointer gated on HERDR_ENV alone never fires in the Herdr app.
  if (body.includes("When `HERDR_ENV=1`,")) {
    throw new Error(`${skill} gates its Herdr pointer on HERDR_ENV alone; add HC_TERMINAL_ID for the Herdr app`);
  }
}
// A skill that mentions delegation either points at the Herdr mapping or says here why it needs no pointer,
// so every new upstream skill that mentions delegation forces that decision.
const noHerdrPointer = {
  babysit: "says a subagent that opens a PR hands back to its parent; starts none",
  "figure-it-out": "fans out through poteto-mode, which it reads first and which points at the mapping",
  ketchup: "summarizes subagent reports; starts none",
  "poteto-help": "explains where subagents spend tokens; starts none",
  "principle-build-the-lever": "principle leaf; starts none",
  "principle-guard-the-context-window": "principle leaf; starts none",
  "principle-separate-before-serializing-shared-state": "principle leaf; starts none",
  "setup-pstack": "writes the Herdr routes itself; starts no worker",
  statechart: "names a TLA+ worker process; starts none",
  "thermo-nuclear-code-quality-review": "fans out only through swarm, which points at the mapping",
};
const skillDirs = readdirSync(join(root, "plugins/pstack/skills"));
for (const entry of Object.keys(noHerdrPointer)) {
  if (!skillDirs.includes(entry)) throw new Error(`noHerdrPointer names ${entry}, which is not a skill`);
}
const delegation = /subagent_type|run_in_background|\b[Ss]pawn(s|ing|ed)?\b|\bsubagents?\b|\b[Ff]ans? out\b|\bworkers?\b/;
for (const entry of skillDirs) {
  const path = join(root, "plugins/pstack/skills", entry, "SKILL.md");
  if (!existsSync(path)) continue;
  const body = readFileSync(path, "utf8");
  const points = body.includes("herdr-tools.md");
  if (points && (body.includes("Under Herdr") || body.includes("Outside Herdr") || body.includes("herdr/dispatch"))) {
    throw new Error(`${entry} dual-paths Herdr instead of using the mapping`);
  }
  if (delegation.test(body) && !points && !(entry in noHerdrPointer)) {
    throw new Error(`${entry} mentions delegation but neither points at the Herdr mapping nor has a noHerdrPointer reason`);
  }
  if (entry in noHerdrPointer && (points || !delegation.test(body))) {
    throw new Error(`${entry} no longer needs its noHerdrPointer entry`);
  }
}
// Every role line the model sheet can hold names a delegate kind. A new line from
// upstream fails here until herdr-tools.md's Sheet lines table gives it a Herdr role.
const models = JSON.parse(read("plugins/pstack/models.json"));
for (const { role } of models.roles) {
  if (!mapping.includes("| `" + role + "` |")) {
    throw new Error(`herdr-tools.md Sheet lines table has no row for the sheet line \`${role}\``);
  }
}

// A playbook that mentions delegation either has a row in herdr-tools.md's Playbook
// notes table or says here why it needs none, the same rule the skills follow.
const noHerdrPlaybookRow = {
  "opening-a-pr": "says what a subagent that opens a PR runs; starts none",
};
const playbookDir = join(root, "plugins/pstack/skills/poteto-mode/playbooks");
const playbookStems = readdirSync(playbookDir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
const playbookRows = mapping.slice(mapping.indexOf("| Playbook | On Herdr |"));
const rowStems = new Set(
  [...playbookRows.matchAll(/^\| ([^|]+) \|/gm)].flatMap((m) =>
    [...m[1].matchAll(/\[([a-z0-9-]+)\]\(\.\.\/playbooks\/\1\.md\)/g)].map((s) => s[1])
  )
);
for (const stem of rowStems) {
  if (!playbookStems.includes(stem)) throw new Error(`herdr-tools.md Playbook notes names ${stem}, which is not a playbook`);
}
for (const entry of Object.keys(noHerdrPlaybookRow)) {
  if (!playbookStems.includes(entry)) throw new Error(`noHerdrPlaybookRow names ${entry}, which is not a playbook`);
}
for (const stem of playbookStems) {
  const delegates = delegation.test(read(`plugins/pstack/skills/poteto-mode/playbooks/${stem}.md`));
  if (delegates && !rowStems.has(stem) && !(stem in noHerdrPlaybookRow)) {
    throw new Error(`playbook ${stem} mentions delegation but has no herdr-tools.md Playbook notes row or noHerdrPlaybookRow reason`);
  }
  if (stem in noHerdrPlaybookRow && (rowStems.has(stem) || !delegates)) {
    throw new Error(`playbook ${stem} no longer needs its noHerdrPlaybookRow entry`);
  }
}

for (const playbook of playbooks) {
  const body = read(`plugins/pstack/skills/poteto-mode/playbooks/${playbook}.md`);
  if (
    body.includes("herdr/dispatch") ||
    body.includes("Under Herdr") ||
    body.includes("Outside Herdr") ||
    body.includes("HERDR_ENV") ||
    body.includes("HC_TERMINAL_ID")
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

if (!setup.includes("If `HERDR_ENV=1` or `HC_TERMINAL_ID` is set, follow **Herdr setup**")) {
  throw new Error("setup-pstack does not branch on Herdr runtime");
}
if (!setup.includes("herdr/configure.ts") || !setup.includes("Do not write YAML yourself.")) {
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
