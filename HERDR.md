# pstack-herdr runtime

This fork preserves the upstream `pstack-claude` README and generated command table. Herdr-specific execution lives here and in `plugins/pstack/skills/poteto-mode/references/herdr-tools.md`.

## Architecture

When `HERDR_ENV=1`, delegation-heavy pstack workflows invoke `plugins/pstack/skills/poteto-mode/scripts/herdr-dispatch.ts` instead of relying on a SessionStart instruction to reinterpret native subagents.

```text
poteto-mode / routed pstack skill
              |
              v
      herdr-dispatch.ts
              |
      +-------+--------+
      |                |
 Claude CLI         Codex CLI
 worker             worker
```

The dispatcher calls Herdr directly to split a pane, apply the selected profile environment, start a `claude` or `codex` process, prompt it, wait when requested, inspect lifecycle state, and read output. Outside `HERDR_ENV=1`, inherited Claude/Codex behavior remains unchanged.

## Install

Install this fork using the same Claude Code or shared Agent Skills mechanisms documented in the main README, substituting `TiewKH/pstack-herdr` for the upstream repository URL.

Install the Herdr integrations for the worker CLIs you use:

```sh
herdr integration install claude
herdr integration install codex
```

Start the main coordinator from inside Herdr so it receives `HERDR_ENV=1`, then enter `poteto-mode` normally.

## Routing

Routing is optional. Without a matching configured role, set `PSTACK_HERDR_PARENT_KIND=claude` or `codex` and children use that CLI kind. For explicit account/model routing, copy `config/routes.example.yaml` to `~/.config/pstack-herdr/routes.yaml`.

Profiles may set `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. One authenticated profile may back many independent worker processes. Multiple subscriptions are optional and use separately authenticated config homes; do not copy credentials between them.

Semantic roles include `explorer`, `implementation`, `difficult-implementation`, `judgment`, `reviewer`, `arena-candidate`, `arena-judge`, `verifier`, and `subcoordinator`.

## Recursive delegation

The dispatcher passes `PSTACK_HERDR_DEPTH=<parent + 1>` and `PSTACK_HERDR_PARENT_KIND=<child kind>` into every new pane. Default maximum depth is 3, preserving pstack's coordinator -> subcoordinator -> worker topology without unbounded recursive spawning.

## Worktrees

pstack decides isolation before dispatch. Read-only explorers/reviewers may share a checkout. Concurrent writers and arena candidates receive separate worktrees or writable output directories. The selected checkout is passed with `--cwd`, so Herdr starts the worker in the correct filesystem scope.

## Direct dispatcher shape

```sh
bun <poteto-mode>/scripts/herdr-dispatch.ts \
  --role implementation \
  --name feature-worker \
  --prompt-file /tmp/feature-brief.md \
  --cwd /path/to/worktree \
  --wait
```

Normally a pstack workflow constructs this command.

## Attribution

- pstack / Poteto Mode: Lauren Tan (poteto), MIT.
- pstack-claude portable Claude/Codex port: Michael Denyer; this repository is a fork of that work.
- imported cursor-team-kit components: Cursor, MIT.
- Herdr: herdrdev, Apache-2.0. Herdr is an external runtime and is not vendored or relicensed here.

See `NOTICE.md`, `NOTICE-skills.md`, `LICENSE`, and `LICENSE-cursor-team-kit` for preserved upstream attribution and license boundaries.
