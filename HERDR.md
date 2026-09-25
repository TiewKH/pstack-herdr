# pstack-herdr runtime

This fork preserves the upstream `pstack-claude` command surface while making Herdr the structural delegation transport whenever `HERDR_ENV=1`.

## Architecture

```text
pstack coordinator
      |
      v
herdr-dispatch.ts
      |
 +----+----+
 |         |
Claude   Codex
```

pstack still decides decomposition, semantic role, worktree isolation, synthesis, review, and verification. The dispatcher owns pane creation, account/profile environment, CLI startup, prompt delivery, lifecycle state, output reads, and recursive depth.

Skills and playbooks keep Claude Agent/Task language. [`herdr-tools.md`](plugins/pstack/skills/poteto-mode/references/herdr-tools.md) translates it when `HERDR_ENV=1`, the same way `codex-tools.md` translates it on Codex.

Outside Herdr, inherited Claude Code and Codex behavior remains available.

## Install

Use the installation mechanisms in the main README, substituting `TiewKH/pstack-herdr` for the upstream repository. Install the Herdr CLI integrations you use:

```sh
herdr integration install claude
herdr integration install codex
```

Start the main coordinator inside Herdr so `HERDR_ENV=1` is present, then enter poteto-mode normally.

## Routing and subscriptions

Copy `config/routes.example.yaml` to `~/.config/pstack-herdr/routes.yaml` for explicit routing. Profiles may set `CLAUDE_CONFIG_DIR` or `CODEX_HOME` for a separately authenticated home; the dispatcher drops a value equal to the CLI's default home, because Claude Code moves its onboarding state into `$CLAUDE_CONFIG_DIR` and a worker given `~/.claude` boots into first-run onboarding. The drop is skipped when the shell that started the Herdr server exports a different `CLAUDE_CONFIG_DIR`, so a profile pinned to the default account still gets it. An optional profile `effort` sets reasoning effort independently of model: `--effort <level>` for Claude workers, `-c model_reasoning_effort="<level>"` for Codex workers; omit it to run the worker CLI's own default. Role `strategy` is `spread` (stable hash over the pool) or `first` (the first listed profile). A single authenticated profile may back multiple worker processes; separate subscriptions/accounts use separately authenticated config homes. Caller-owned `--cwd` is the isolation boundary.

Roles are `explorer`, `implementation`, `difficult-implementation`, `judgment`, `reviewer`, `arena-candidate`, `arena-judge`, `verifier`, and `subcoordinator`.

## Recursive delegation

Each child receives `PSTACK_HERDR_DEPTH=<parent + 1>` and `PSTACK_HERDR_PARENT_KIND=<child kind>`. Default `max_depth` is 3. This preserves coordinator -> subcoordinator -> worker/verifier nesting without unbounded fan-out.

## Worktrees

Read-only explorers/reviewers may share a checkout. Concurrent writers and arena/eval candidates receive isolated writable worktrees or directories. The caller passes the selected location through `--cwd`.

## Dispatcher

```sh
bun <poteto-mode>/scripts/herdr-dispatch.ts \
  --role implementation \
  --name feature-worker \
  --prompt-file /tmp/feature-brief.md \
  --cwd /path/to/worktree \
  --wait
```

`--timeout` / `orchestration.default_timeout_ms` is the same budget for `agent start` and the `agent wait` after the prompt; Herdr rejects an `agent start` timeout above 300000 ms, so the dispatcher clamps the start budget to that and passes the full value to the wait. The dispatcher waits for the worker to report idle before typing, then counts the prompt delivered once the agent leaves idle within `PSTACK_HERDR_DELIVERY_WINDOW_MS` (default 8000 ms), retrying once. A prompt that is not accepted or not delivered closes the pane and includes the worker's last visible screen in the error. A `--wait` budget that runs out after acceptance leaves the pane open and returns the live status, usually `working`; finish it with `herdr-dispatch.ts --collect --name <name>`, which waits, reads the output, and closes the pane once the worker is done. A dispatch or `--collect` stopped by SIGTERM, SIGINT, or SIGHUP while it waits closes the worker's pane before it exits.

On Claude Code a `PreToolUse` hook on `Agent` (`plugins/pstack/hooks/herdr-agent-gate.sh`) denies native subagent calls while `HERDR_ENV=1` and both `herdr` and `bun` are available, and returns the dispatcher command instead. When either binary is missing it allows the call and names the missing one. `PSTACK_HERDR_ALLOW_NATIVE_AGENT=1` bypasses it. For parallel fan-out, launch all dispatcher processes before waiting. `blocked` is not completion; inspect the worker's approval/question. `unknown` is not proof of completion.

## Migrated delegation paths

Herdr routing is structural in the direct delegation paths for:

- Feature, Bug fix, Refactoring, Perf issue, Hillclimb, Eval, Autonomous run.
- How, Why, Arena, Swarm, Interrogate, Reflect.
- Automate me, Recall, No comments, Show me your work, Maintain verification skill.
- Orchestrate, Autopilot-full, and Autopilot-stack.
- Architect inherits Herdr through How/Why/Arena/Interrogate.
- Figure-it-out inherits it through Architect and whatever delegated execution playbook it designs.

The repository contract test fails when fan-out skills stop pointing at `herdr-tools.md`, or when playbooks grow inline Herdr dual-paths. SessionStart does not own Herdr activation.

## Workflow safety

CI and security workflows use repository-wide `contents: read`, disable checkout credential persistence, do not consume repository secrets, pin GitHub Actions by commit SHA, give lint containers read-only checkout mounts, and cap job runtime. Pull-request workflows therefore execute untrusted repository code without a write-capable GitHub token.

The OSV scanner requires outbound network access to obtain advisory data. Its checkout mount is read-only and its workflow token remains read-only. Review scanner version changes deliberately.

## Attribution

- pstack / Poteto Mode: Lauren Tan (poteto), MIT.
- pstack-claude portable Claude/Codex port: Michael Denyer.
- imported cursor-team-kit components: Cursor, MIT.
- Herdr: herdrdev, Apache-2.0; external runtime, not vendored or relicensed.

See `NOTICE.md`, `NOTICE-skills.md`, `LICENSE`, and `LICENSE-cursor-team-kit`.
