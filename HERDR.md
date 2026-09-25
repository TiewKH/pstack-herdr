# Herdr runtime

When `HERDR_ENV=1`, pstack delegates through [`herdr-dispatch.ts`](plugins/pstack/skills/poteto-mode/scripts/herdr-dispatch.ts) instead of the native `Agent` tool. pstack still decides decomposition, roles, isolation, synthesis, review, and verification. The dispatcher owns the worker's pane from creation to cleanup. [`herdr-tools.md`](plugins/pstack/skills/poteto-mode/references/herdr-tools.md) is the per-skill mapping agents read. This file is the contract behind it.

## Roles

| Role | Use |
| --- | --- |
| `explorer` | read-only investigation |
| `implementation` | normal implementation |
| `difficult-implementation` | cross-cutting, concurrency, or algorithm work |
| `judgment` | trade-offs and synthesis |
| `reviewer` | independent diff review |
| `arena-candidate` | one competing attempt in an arena |
| `arena-judge` | picks among arena candidates |
| `verifier` | tests and validation |
| `subcoordinator` | owns a delegated branch and may delegate further |

## Routing

`/setup-pstack` writes `~/.config/pstack-herdr/routes.yaml` through `configure-herdr.ts`. Do not edit it by hand. [`config/routes.example.yaml`](config/routes.example.yaml) shows the format.

- A **profile** names a CLI (`kind: claude` or `codex`), a `model`, an optional `effort`, and optional `env`.
- A **role** names a pool of profiles and a `strategy`. `first` always takes the first profile. `spread` hashes the worker name over the pool.
- Write a full model ID such as `claude-opus-5-5` or `gpt-6-sol` to pin a version. A family name runs whichever model is current in that family. setup-pstack's Models section lists the confirmed IDs.
- `effort` becomes `--effort <level>` for Claude or `-c model_reasoning_effort="<level>"` for Codex. Omit it to use the CLI's default.
- One authenticated profile can back many workers, which share its rate and usage limits. For a second account, give a profile its own `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. Leave the default home (`~/.claude`, `~/.codex`) out. Claude Code keeps its onboarding state under `$CLAUDE_CONFIG_DIR`, so a worker given `~/.claude` boots into first-run onboarding. The dispatcher drops a default home unless the shell that started Herdr exports a different one.

## Depth and isolation

Each worker gets `PSTACK_HERDR_DEPTH=<parent + 1>` and `PSTACK_HERDR_PARENT_KIND=<its kind>`. The dispatcher refuses to start a worker at `orchestration.max_depth`, which defaults to 3. That allows coordinator, subcoordinator, then worker.

The caller's `--cwd` is the isolation boundary. Read-only workers may share a checkout. Concurrent writers and arena candidates each get their own worktree.

## Dispatch lifecycle

```sh
bun <poteto-mode>/scripts/herdr-dispatch.ts \
  --role implementation \
  --name feature-worker \
  --prompt-file /tmp/feature-brief.md \
  --cwd /path/to/worktree \
  --wait
```

1. The dispatcher opens a background tab, starts the CLI, and waits for it to report idle.
2. It types the prompt and counts it delivered once the agent leaves idle within `PSTACK_HERDR_DELIVERY_WINDOW_MS` (default 8000 ms). It retries once. A prompt that is rejected or never lands closes the pane and puts the worker's last screen in the error.
3. With `--wait`, it waits up to `--timeout` (default `orchestration.default_timeout_ms`, 180000 ms). `agent start` gets at most the 300000 ms Herdr accepts.
4. A `done` or `idle` status counts only when a transcript written after the prompt quotes its first line: a Codex rollout under `$CODEX_HOME/sessions`, or the Claude session file Herdr names. Without one, the dispatcher closes the pane and throws. Herdr reads a CLI that booted and stalled as a finished turn.
5. A verified worker's output is read and its pane closed. `--keep-pane` keeps it open.

`working`, `blocked`, and `unknown` panes stay open. `blocked` means the worker is waiting on an approval or question, so inspect it. `unknown` is not completion. Finish a `working` worker with `herdr-dispatch.ts --collect --name <name>`, which waits, reads the output, and closes the pane once it is done. A dispatch or `--collect` stopped by SIGTERM, SIGINT, or SIGHUP while waiting closes the worker's pane first. SIGKILL cannot be caught and leaves the pane open.

For parallel fan-out, start every dispatcher process before waiting on any.

## The Agent gate

On Claude Code, a `PreToolUse` hook on `Agent` ([`herdr-agent-gate.sh`](plugins/pstack/hooks/herdr-agent-gate.sh)) denies native subagent calls while `HERDR_ENV=1` and both `herdr` and `bun` are available, and returns the dispatcher command. When either binary is missing, it allows the call and names the missing one. Outside Herdr it does nothing. `PSTACK_HERDR_ALLOW_NATIVE_AGENT=1` bypasses it.

## Delegation paths on Herdr

These workflows delegate through the dispatcher:

- Feature, Bug fix, Refactoring, Perf issue, Hillclimb, Eval, Autonomous run.
- How, Why, Arena, Swarm, Interrogate, Reflect.
- Automate me, Recall, No comments, Show me your work, Maintain verification skill.
- Orchestrate, Autopilot-full, Autopilot-stack.

Architect reaches Herdr through How, Why, Arena, and Interrogate. Figure-it-out reaches it through Architect and the playbook it designs. `tests/herdr-runtime.test.mjs` fails when a fan-out skill stops pointing at `herdr-tools.md`, or when a playbook grows its own Herdr branch.

## Workflow safety

CI and security workflows run with `contents: read`, no checkout credentials, no repository secrets, actions pinned by commit SHA, read-only container mounts, and job time limits. A pull request's code therefore runs without a write-capable token. The OSV scanner needs outbound network access for advisory data; its mount and token stay read-only.
