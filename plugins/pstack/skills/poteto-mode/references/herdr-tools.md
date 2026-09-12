# Herdr execution mapping

When `HERDR_ENV=1`, pstack delegation uses the executable `scripts/herdr-dispatch.ts`. Do not use Claude Code `Agent`/`Task` or Codex `spawn_agent` for a delegation that this dispatcher can represent.

This is a structural runtime rule, not a session-start hint. The dispatcher calls the installed `herdr` binary itself and owns pane creation, profile environment, agent startup, prompt delivery, lifecycle waiting, output reads, and delegation depth.

## Dispatch

Write substantial worker prompts to a temporary file, then invoke:

```bash
bun <poteto-mode>/scripts/herdr-dispatch.ts \
  --role <role> \
  --name <unique-agent-name> \
  --prompt-file <brief.md> \
  --cwd <checkout-or-worktree> \
  --wait
```

Use `--readonly` for explorers, reviewers, judges, and other workers that must not edit. The flag records intent; the brief must still prohibit writes because Claude/Codex permissions are runtime-specific.

Use `--profile`, `--kind`, or `--model` only to override routing deliberately. Normally the semantic `--role` selects a profile from `~/.config/pstack-herdr/routes.yaml`.

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

With `--wait`, the dispatcher returns JSON containing the Herdr agent name, pane, selected profile, kind, nesting depth, lifecycle status, blocked flag, and recent agent output. `blocked: true` is not completion. Inspect the worker in Herdr and resolve the approval/question deliberately.

The dispatcher refuses to run outside `HERDR_ENV=1` and refuses recursive delegation at the configured depth limit.

## Native fallback

When `HERDR_ENV` is not `1`, follow the normal Claude Code behavior or the Codex mapping in `codex-tools.md`. Herdr is not contacted from outside a Herdr-managed pane.
