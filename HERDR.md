# Herdr runtime

Inside Herdr, pstack delegates through [`herdr/dispatch.ts`](plugins/pstack/skills/poteto-mode/scripts/herdr/dispatch.ts) instead of the native `Agent` tool. pstack still decides decomposition, roles, isolation, synthesis, review, and verification. The dispatcher owns the worker's pane from creation to cleanup. [`herdr-tools.md`](plugins/pstack/skills/poteto-mode/references/herdr-tools.md) is the per-skill mapping agents read. This file is the contract behind it.

## Runtimes

The dispatcher drives either form of Herdr and picks one from the environment:

- **Herdr TUI** (`herdr`): panes carry `HERDR_ENV=1`. The dispatcher calls the `herdr` binary. [Dispatch lifecycle](#dispatch-lifecycle) below describes this runtime.
- **Herdr app** (`herdr-app`, whose terminals `herdr-core` runs): terminals carry `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET`. The dispatcher speaks herdr-core's JSON-RPC on that socket. [Herdr app lifecycle](#herdr-app-lifecycle) describes this runtime.

`HERDR_ENV=1` wins when both are set, because a TUI pane started inside an app terminal is the inner runtime. Roles, routing, depth, flags, and the result JSON are shared; [`hc.ts`](plugins/pstack/skills/poteto-mode/scripts/herdr/hc.ts) holds the app backend.

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

`/setup-pstack` writes `~/.config/pstack-herdr/routes.yaml` through `herdr/configure.ts`. Do not edit it by hand. [`config/routes.example.yaml`](config/routes.example.yaml) shows the format.

- A **profile** names a CLI (`kind: claude` or `codex`), a `model`, an optional `effort`, and optional `env`.
- A **role** names a pool of profiles and a `strategy`. `first` always takes the first profile. `spread` hashes the worker name over the pool. `--kind` keeps only the pool's profiles of that CLI before the strategy runs.
- Write a full model ID such as `claude-opus-5-5` or `gpt-6-sol` to pin a version. A family name runs whichever model is current in that family. setup-pstack's Models section lists the confirmed IDs.
- `effort` becomes `--effort <level>` for Claude or `-c model_reasoning_effort="<level>"` for Codex. Omit it to use the CLI's default.
- One authenticated profile can back many workers, which share its rate and usage limits. For a second account, give a profile its own `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. Leave the default home (`~/.claude`, `~/.codex`) out. Claude Code keeps its onboarding state under `$CLAUDE_CONFIG_DIR`, so a worker given `~/.claude` boots into first-run onboarding. The dispatcher drops a default home unless the shell that started Herdr exports a different one.

## Depth and isolation

Each worker gets `PSTACK_HERDR_DEPTH=<parent + 1>` and `PSTACK_HERDR_PARENT_KIND=<its kind>`. The dispatcher refuses to start a worker at `orchestration.max_depth`, which defaults to 3. That allows coordinator, subcoordinator, then worker.

A worker that delegates reaches Herdr over a local socket, and Codex's `workspace-write` sandbox blocks that socket while its network is off. A Codex profile routed to `subcoordinator` therefore needs `network_access = true` under `[sandbox_workspace_write]` in that profile's `$CODEX_HOME/config.toml`. Without it, nested dispatch fails under both runtimes; the dispatcher appends that fix to the socket error when Codex sets `CODEX_SANDBOX_NETWORK_DISABLED=1`. `/setup-pstack` asks about the setting when it routes `subcoordinator` to Codex.

The caller's `--cwd` is the isolation boundary. Read-only workers may share a checkout. Concurrent writers and arena candidates each get their own worktree.

## Dispatch lifecycle

```sh
bun <poteto-mode>/scripts/herdr/dispatch.ts \
  --role implementation \
  --name feature-worker \
  --prompt-file /tmp/feature-brief.md \
  --cwd /path/to/worktree \
  --wait
```

1. The dispatcher opens a background tab, starts the CLI, and waits for it to report idle. Herdr 0.9.2+ never reports a ready Codex composer as idle, so `unknown` and `done` also end the wait for a Codex worker. Herdr 0.9.3 reads a fresh Codex composer as `done`.
2. It types the prompt and counts it delivered once the agent leaves idle (for Codex, once it reads `working` or `blocked`, or its rollout quotes the prompt) within `PSTACK_HERDR_DELIVERY_WINDOW_MS` (default 8000 ms). It retries once. A prompt that is rejected or never lands closes the pane and puts the worker's last screen in the error.
3. With `--wait`, it waits up to `--timeout` (default `orchestration.default_timeout_ms`, 180000 ms). `agent start` gets at most the 300000 ms Herdr accepts.
4. For a Claude worker, a `done` or `idle` status counts only when the session file Herdr names, written after the prompt, quotes its first line. Without one, the dispatcher closes the pane and throws. Herdr reads a CLI that booted and stalled as a finished turn.
5. The dispatcher appends a marker line, `[pstack-herdr turn <name>-<time>]`, to every Codex prompt. A Codex worker's turn ends when the rollout that quotes the marker, under the worker's `$CODEX_HOME/sessions`, records `task_complete` after it, whatever Herdr reports. The prompt also counts as delivered once that rollout quotes the marker. Herdr 0.9.2+ reads a finished Codex turn as `unknown`, and 0.9.1 can read a running one as `idle`. The dispatcher polls the rollout, returns `done` with the turn's final message as the output, and reports `working` while the rollout shows the turn still open. The dispatch saves the pane, sessions directory, marker, and start time to `$TMPDIR/pstack-herdr/<name>.json` before it types the prompt, so `--collect` checks the same turn.
6. A verified worker's output is read and its pane closed. `--keep-pane` keeps it open.

`working`, `blocked`, and `unknown` panes stay open. `blocked` means the worker is waiting on an approval or question, so inspect it. `unknown` is not completion. Finish a `working` worker with `herdr/dispatch.ts --collect --name <name>`, which waits, reads the output, and closes the pane once it is done. A dispatch or `--collect` stopped by SIGTERM, SIGINT, or SIGHUP while waiting closes the worker's pane first. SIGKILL cannot be caught and leaves the pane open.

For parallel fan-out, start every dispatcher process without `--wait`, then collect them with `--next`:

```sh
bun <poteto-mode>/scripts/herdr/dispatch.ts --next worker-a worker-b worker-c --timeout 600000
```

`--next` blocks until the first named worker settles, reads and closes every worker that has, and prints `{"settled": [...], "pending": [...]}`. Call it again with the `pending` names until none are left. Each Claude worker's status change reaches it through a Herdr `events.subscribe` stream on `HERDR_SOCKET_PATH`, so it wakes when the status changes. Reading the output and closing the pane takes under a second more. A Codex worker's rollout is read every second. Without the socket, it reads every second. `--next` only watches: a stopped `--next`, or one whose budget ends, leaves every worker open. It works the same from a Claude Code or a Codex orchestrator, so neither needs a sleep loop.

## Herdr app lifecycle

1. The dispatcher reads the caller's terminal (`HC_TERMINAL_ID`) for its `herdr.space` and `herdr.tab` labels.
2. It starts one `terminal.run` with the CLI as `argv` and the brief after `--` as the launch prompt. Codex gets `--no-daemon`. The terminal is named `--name`, is a child of the caller, has `no_notify` set so herdr-core types no notes into the coordinator, and carries `pstack.kind`, `pstack.role`, `pstack.profile`, and `pstack.depth` labels. `herdr.space` is copied from the caller, so the app opens the worker as a background tab in that space; `--placement split` also copies `herdr.tab`, which puts it beside the caller. herdr-core starts programs with its own login environment, so `env` carries the caller's `PATH`, `PSTACK_HERDR_ROUTES` when set, the profile's `env`, and the depth variables. The rule that drops a profile's default config home (`~/.claude`, `~/.codex`) checks herdr-core's own environment, read once per dispatch, because that is what the worker inherits.
3. The dispatcher labels the worker with its launch pid (`pstack.pid`). The app keeps every terminal it shows, so herdr-core replaces a lost program with a shell instead of ending the terminal. A live terminal with a `reason`, or with a pid other than the launch pid, is a lost worker and settles as `exited`.
4. The worker settles on the CLI's own OSC 7501 status. `turn` rises each time the status leaves `working`, so a task is finished once `turn` is above zero and the status is not `working`. Codex reports `idle` while it boots, at turn 0, so that is not completion. `blocked`, `error`, and an exited program also settle.
5. A `done`, `idle`, or `exited` worker's screen and 240 lines of history are read, then its terminal is killed and removed (`--keep-pane` keeps it). `blocked` and `error` workers stay open. A budget that ends returns `working`, or `unknown` when the worker never started its task, and leaves the terminal open for `--collect`.
6. `--next` subscribes to herdr-core's event stream and wakes on status, turn, and exit events for its workers, reading every 10 seconds if an event is missed and every second without a subscription.

A dispatch or `--collect` stopped by SIGTERM, SIGINT, or SIGHUP kills and removes its worker over the herdr-core socket, so cleanup does not need the `hc` binary on PATH, then exits with the signal's code. Workers also end when the caller's terminal program ends, because they are its children.

## The Agent gate

On Claude Code, a `PreToolUse` hook on `Agent` ([`herdr-agent-gate.sh`](plugins/pstack/hooks/herdr-agent-gate.sh)) denies native subagent calls while `HERDR_ENV=1` and both `herdr` and `bun` are available, or in a Herdr app terminal (`HC_TERMINAL_ID`) with `bun` and `HC_TERMINAL_SOCKET`, and returns the dispatcher command. When one is missing, it allows the call and names it. Outside Herdr it does nothing, and it does nothing in MiniMax Code (`MINIMAX_PLUGIN_ROOT`), which loads the same hooks file through its Claude Code reader. `PSTACK_HERDR_ALLOW_NATIVE_AGENT=1` bypasses it.

## Delegation paths on Herdr

These workflows delegate through the dispatcher:

- Feature, Bug fix, Refactoring, Perf issue, Hillclimb, Eval, Autonomous run.
- How, Why, Arena, Architect, Swarm, Interrogate, Reflect, Thermos.
- Automate me, Recall, No comments, Show me your work, Maintain verification skill.
- Orchestrate, Autopilot-full, Autopilot-stack.

Figure-it-out reaches Herdr through poteto-mode and the playbook it designs. The Herdr pointer on each skill is generated: [`tools/herdr.mjs`](tools/herdr.mjs) stamps it on every skill that `herdr-tools.md`'s Per-skill notes table names, after the runtime pointers. `tests/herdr-runtime.test.mjs` enforces the coverage:

- It fails when a skill that mentions spawning, subagents, workers, or fan-out has no pointer and no `noHerdrPointer` reason in the test.
- It fails when a delegating playbook has no Playbook notes row and no `noHerdrPlaybookRow` reason.
- It fails when a `models.json` role line has no Sheet lines row.
- It fails when any such reason goes stale, or when a skill or playbook grows its own Herdr branch.

Panels such as arena runners and interrogate reviewers take their models from the role's profile pool, not from `pstack-models.md`. Dispatch one worker per seat with no `--model`, and `spread` spreads the seats across the pool.

## Workflow safety

CI and security workflows run with `contents: read`, no checkout credentials, no repository secrets, actions pinned by commit SHA, read-only container mounts, and job time limits. A pull request's code therefore runs without a write-capable token. The OSV scanner needs outbound network access for advisory data; its mount and token stay read-only.
