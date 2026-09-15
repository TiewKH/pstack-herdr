# Herdr execution mapping

When `HERDR_ENV=1`, pstack delegation uses the executable `scripts/herdr-dispatch.ts`. Do not use Claude Code `Agent`/`Task` or Codex `spawn_agent` for a delegation that this dispatcher can represent.

This is a structural runtime rule, not a session-start hint. Skills and playbooks keep their native spawn language. This file is the translation, the same way `codex-tools.md` is the Codex translation.

The dispatcher calls the installed `herdr` binary itself and owns pane creation, profile environment, agent startup, prompt delivery, lifecycle waiting, output reads, and delegation depth.

## Tool actions

| pstack / Claude action | Herdr equivalent |
|------------------------|------------------|
| Dispatch a subagent (`Agent` / `Task`) | `herdr-dispatch.ts` |
| Dispatch N parallel subagents in one turn | N dispatcher processes launched concurrently, then collect results |
| `subagent_type` | ignored; pass the semantic pstack `--role` |
| `model` | omit unless overriding; `--role` selects a profile from `~/.config/pstack-herdr/routes.yaml` |
| reasoning effort (no Claude `Agent`/`Task` equivalent) | omit unless overriding; a routed profile's `effort` becomes `--effort <level>` for Claude workers or `-c model_reasoning_effort="<level>"` for Codex workers |
| `readonly: true` | `--readonly` |
| `readonly: false` because Claude Ask mode strips MCP | still pass `--readonly`; it disables write tools and does not use Ask/plan mode |
| `isolation: "worktree"` / exclusive branch | caller creates the worktree or branch, then passes it as `--cwd` |
| `run_in_background: true` | omit `--wait`; drain later through Herdr agent state and output |
| Wait for a subagent result | `--wait` |

Write substantial worker prompts to a temporary file, then invoke:

```bash
bun <poteto-mode>/scripts/herdr-dispatch.ts \
  --role <role> \
  --name <unique-agent-name> \
  --prompt-file <brief.md> \
  --cwd <checkout-or-worktree> \
  --wait
```

`--readonly` prepends a no-write constraint to the prompt and passes Claude `--disallowedTools Write,Edit` or Codex `--sandbox read-only`. The brief must still prohibit writes.

Use `--profile`, `--kind`, `--model`, or `--effort` only to override routing deliberately.

For parallel fan-out, launch dispatcher processes concurrently rather than dispatching one and waiting before starting the next. Each dispatcher creates its own Herdr pane and agent. Collect each JSON result after all launches have begun.

## Roles

Use these role names consistently:

- `explorer`
- `implementation`
- `difficult-implementation`
- `judgment`
- `reviewer`
- `arena-candidate`
- `arena-judge`
- `verifier`
- `subcoordinator`

## Isolation

The caller chooses `--cwd`. Read-only workers may share the current checkout. Concurrent writers must receive separate worktrees or otherwise isolated writable paths before dispatch. Arena candidates are always isolated.

## Result handling

With `--wait`, the dispatcher returns JSON containing the Herdr agent name, pane, selected profile, kind, nesting depth, lifecycle status, blocked flag, and recent agent output. `blocked: true` is not completion. Inspect the worker in Herdr and resolve the approval/question deliberately. `unknown` is not proof of completion: it is the status Herdr reported, not a missing field.

`--timeout` and `orchestration.default_timeout_ms` are one budget applied to both `agent start` readiness and `agent prompt --wait`.

The dispatcher refuses to run outside `HERDR_ENV=1` and refuses recursive delegation at the configured depth limit. It owns the pane through prompt acceptance; a start or prompt failure closes that pane.

## Per-skill notes

Most skills need only the table above. These need one more mapping:

| Skill | On Herdr |
|-------|----------|
| `how` | Explorers and the simple explainer use `--role explorer --readonly`. The complex synthesizer uses `--role judgment --readonly`. |
| `why` | Investigators use `--role explorer --readonly`. The synthesizer uses `--role judgment --readonly`. Do not skip `--readonly` to preserve MCP; the flag does not use Ask mode. |
| `interrogate` | Reviewers use `--role reviewer --readonly`. Keep panel diversity through routing profiles or `--model`. |
| `arena` | Candidates use `--role arena-candidate` with an isolated `--cwd`. The judge uses `--role arena-judge --readonly`. |
| `swarm` | Writers use `--role implementation`. Read-only workers use `--role explorer --readonly` or `--role verifier --readonly`. |
| `reflect` | Reviewers use `--role reviewer --readonly`. The synthesizer uses `--role judgment --readonly`. |
| `automate-me` | Transcript-mining workers use `--role explorer --readonly`; launch slices concurrently and collect only their structured findings. |
| `maintain-verification-skill` | Source-wave workers use `--role explorer --readonly`, one per feature, launched concurrently. The coordinator still owns all live app driving. |
| `show-me-your-work` | The cross-model audit uses `--role reviewer --readonly`. When the skill requires a different model family, deliberately choose a suitable configured profile or `--model` override instead of relying on `spread`. |
| `recall` | Transcript-slice workers use `--role explorer --readonly`, launched concurrently. Keep raw transcript reads inside the workers and return only the requested summaries. |
| `no-comments` | Use `--role reviewer --readonly`. Build the worker brief from `poteto-mode/references/agents/comment-sicko.md` plus the requested scope; Herdr has no Claude `subagent_type`, so do not silently drop that reviewer contract. |
| Feature / bug-fix / refactoring / perf-issue / hillclimb | Implementation delegates use `--role implementation`, or `difficult-implementation` for concurrency, algorithms, or cross-cutting work, with an exclusive writer `--cwd`. |
| Eval | Candidates use `--role arena-candidate` in sanitized directories. The judge uses `--role arena-judge --readonly`. |
| Orchestrate / autopilot | Owners that must themselves delegate use `--role subcoordinator`. Direct writers use `--role implementation`. Verifiers use `--role verifier --readonly`. |
| Autonomous run | The watcher uses `--role explorer` without `--wait`. |

## Native fallback

When `HERDR_ENV` is not `1`, follow the normal Claude Code behavior or the Codex mapping in `codex-tools.md`. Herdr is not contacted from outside a Herdr-managed pane.
