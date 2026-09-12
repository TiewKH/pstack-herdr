---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
---

# Swarm

On Codex, read the [platform mapping](../poteto-mode/references/codex-tools.md), including its per-skill notes, before following this skill. When `HERDR_ENV=1`, read [the Herdr execution mapping](../poteto-mode/references/herdr-tools.md) and use `scripts/herdr-dispatch.ts` for every worker instead of native Agent/Task/spawn_agent delegation.

Fan out N parallel workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not the number that run at once.
4. Pick the worker model from `swarm workers` in `~/.claude/pstack-models.md` when present. Otherwise use the default in [Models](#models). For a model race, name each arm's model up front.
5. Give each worker its own writable output when it writes.

## Phase B: Fan out

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence.

Under Herdr, write each brief to a temporary file and launch N concurrent dispatcher processes with `--role implementation` for writers or `--role explorer --readonly` for read-only workers. Pass each worker's assigned checkout/worktree through `--cwd`. Start all N dispatcher processes before waiting for results. Route configuration chooses the Claude/Codex profile. For a model race, pass the arm's model explicitly with `--model`.

Outside Herdr, spawn all N workers in one message with `subagent_type: "general-purpose"`, `run_in_background: true`, and the configured model.

When a worker must start from a non-default branch, check that branch out in the worker's own worktree and name the worktree path in its brief. If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the worker results. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.

## Models

Role defaults, stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`). A matching role line in `~/.claude/pstack-models.md` overrides each at runtime; see `/setup-pstack`.

- swarm workers: `claude-opus-5`
