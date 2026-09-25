# Herdr execution mapping

When `HERDR_ENV=1`, pstack delegation uses the executable `scripts/herdr-dispatch.ts`. Do not use Claude Code `Agent`/`Task` or Codex `spawn_agent` for a delegation that this dispatcher can represent.

This is a structural runtime rule, not a session-start hint. Skills and playbooks keep their native spawn language. This file is the translation, the same way `codex-tools.md` is the Codex translation.

The dispatcher calls the installed `herdr` binary itself and owns pane creation, profile environment, agent startup, prompt delivery, lifecycle waiting, output reads, and delegation depth.

## The Agent gate

A `PreToolUse` hook on `Agent` (`herdr-agent-gate.sh` under the plugin hooks directory) enforces this mapping on Claude Code. With `HERDR_ENV=1`, and `herdr` and `bun` both found (`bun` on PATH or at `~/.bun/bin/bun`), it denies the call and returns the dispatcher command. If `herdr` or `bun` is missing it allows the call and says which one to install. Outside Herdr it is silent. `PSTACK_HERDR_ALLOW_NATIVE_AGENT=1` bypasses it for a delegation the dispatcher cannot represent.

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

## Worker environment

A profile's `env` reaches the worker pane as `--env` flags, except a config home equal to the CLI's default (`CLAUDE_CONFIG_DIR=~/.claude`, `CODEX_HOME=~/.codex`), which the dispatcher drops unless the shell that started Herdr exports a different home for that variable. Claude Code keeps its onboarding state in `$CLAUDE_CONFIG_DIR/.claude.json` once the variable is set, so a worker given the default home boots into first-run onboarding and the prompt lands on a menu. A separately authenticated home such as `~/.claude-a` still passes through; complete its onboarding once by hand.

## Result handling

When the prompt is not accepted or not delivered, the dispatcher reads the worker's visible screen, closes the pane, and puts that screen in the error, so a stuck onboarding menu or trust prompt is visible from the caller.

With `--wait`, the dispatcher returns JSON containing the Herdr agent name, pane, selected profile, kind, nesting depth, lifecycle status, blocked flag, `paneClosed`, and recent agent output. A verified `done` or `idle` worker closes after the dispatcher reads its output. Pass `--keep-pane` to retain one for inspection. A cleanup failure makes the dispatch fail instead of reporting a result with a leaked pane.

`blocked: true` is not completion. Inspect the worker in Herdr and resolve the approval or question. `unknown` is not proof of completion; it is the status Herdr reported. `working` means the wait budget ran out with the worker still running. The dispatcher leaves `working`, `blocked`, and `unknown` panes open. Finish a `working` worker through the dispatcher, not raw `herdr` commands, so its pane closes when it is done:

```bash
bun <poteto-mode>/scripts/herdr-dispatch.ts --collect --name <agent-name> --timeout <ms>
```

It returns the same settled JSON without `profile` and `depth`, and leaves the pane open again if the worker is still running when the budget ends. Close a pane with `herdr pane close <pane>` only when the work is no longer wanted. A dispatcher stopped by SIGTERM, SIGINT, or SIGHUP closes the pane it opened before it exits; SIGKILL cannot be caught and still leaks the pane.

`--timeout` and `orchestration.default_timeout_ms` are one budget applied to `agent start` readiness (at most the 300000 ms Herdr accepts) and to the `agent wait` that follows a prompt. Before typing, the dispatcher waits for the worker to report idle, then counts the prompt delivered once the agent leaves idle (`working`, `blocked`, or `done`) within `PSTACK_HERDR_DELIVERY_WINDOW_MS` (default 8000), retrying the prompt once. A prompt that never lands is an error that carries the screen, never a `done` over an empty composer.

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
