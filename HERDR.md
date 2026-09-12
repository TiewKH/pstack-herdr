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

Outside Herdr, inherited Claude Code and Codex behavior remains available.

## Install

Use the installation mechanisms in the main README, substituting `TiewKH/pstack-herdr` for the upstream repository. Install the Herdr CLI integrations you use:

```sh
herdr integration install claude
herdr integration install codex
```

Start the main coordinator inside Herdr so `HERDR_ENV=1` is present, then enter poteto-mode normally.

## Routing and subscriptions

Copy `config/routes.example.yaml` to `~/.config/pstack-herdr/routes.yaml` for explicit routing. Profiles may set `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. A single authenticated profile may back multiple worker processes; separate subscriptions/accounts use separately authenticated config homes.

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

For parallel fan-out, launch all dispatcher processes before waiting. `blocked` is not completion; inspect the worker's approval/question. `unknown` is not proof of completion.

## Migrated delegation paths

Herdr routing is structural in the direct delegation paths for:

- Feature, Bug fix, Refactoring, Perf issue, Hillclimb, Eval, Autonomous run.
- How, Why, Arena, Swarm, Interrogate, Reflect.
- Orchestrate, Autopilot-full, and Autopilot-stack.
- Architect inherits Herdr through How/Why/Arena/Interrogate.
- Figure-it-out inherits it through Architect and whatever delegated execution playbook it designs.

The repository contract test fails when these paths stop referencing the dispatcher. SessionStart does not own Herdr activation.

## Workflow safety

CI and security workflows use repository-wide `contents: read`, disable checkout credential persistence, do not consume repository secrets, pin GitHub Actions by commit SHA, give lint containers read-only checkout mounts, and cap job runtime. Pull-request workflows therefore execute untrusted repository code without a write-capable GitHub token.

The OSV scanner requires outbound network access to obtain advisory data. Its checkout mount is read-only and its workflow token remains read-only. Review scanner version changes deliberately.

## Attribution

- pstack / Poteto Mode: Lauren Tan (poteto), MIT.
- pstack-claude portable Claude/Codex port: Michael Denyer.
- imported cursor-team-kit components: Cursor, MIT.
- Herdr: herdrdev, Apache-2.0; external runtime, not vendored or relicensed.

See `NOTICE.md`, `NOTICE-skills.md`, `LICENSE`, and `LICENSE-cursor-team-kit`.
