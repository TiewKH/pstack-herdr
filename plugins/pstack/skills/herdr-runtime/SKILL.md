---
name: herdr-runtime
description: Internal pstack execution adapter for Herdr-managed Claude and Codex agents. Use when HERDR_ENV=1 to translate pstack subagent delegation into Herdr panes and agents.
user-invocable: false
---

# Herdr runtime

This skill changes pstack's execution transport, not its engineering semantics. Poteto mode and the routed pstack skills still decide what work to delegate, how many independent attempts to run, what model role is required, what must be verified, and who owns the final result. Herdr owns the process, pane, account profile, lifecycle, and terminal transport used to execute that delegation.

## Activation

Use this adapter only when `HERDR_ENV=1`.

Before controlling Herdr, verify the environment:

```sh
test "${HERDR_ENV:-}" = 1
```

If the check fails, use the runtime-native pstack behavior instead.

The official Herdr skill is the authority for current CLI syntax and lifecycle semantics. Load the installed `herdr` skill before issuing Herdr control commands. If it is unavailable, stop using this adapter rather than guessing CLI syntax. The installed `herdr` binary is authoritative; inspect `herdr --help` and the relevant command-group help when the skill tells you to.

## Runtime substitution

When this adapter is active, every pstack instruction that would create a Claude `Agent`/`Task`, a Codex `spawn_agent`, a background subagent, a reviewer, an arena candidate, a verifier, or a subcoordinator is executed as a Herdr-managed coding agent instead.

Conceptually:

| pstack action | Herdr execution |
|---|---|
| create a subagent | create or choose a pane, then `herdr agent start` |
| send the delegated brief | `herdr agent prompt` |
| run N agents in parallel | start N independent panes/agents before waiting |
| wait for a result | `herdr agent wait` or prompt with `--wait` |
| inspect the result | `herdr agent read` |
| inspect a blocked worker | `herdr agent get` plus `herdr agent read` |
| stop an abandoned worker | use the Herdr agent/pane lifecycle commands documented by the installed skill |

Do not fall back to Claude Code native subagents or Codex native `spawn_agent` while Herdr is healthy. The point of this adapter is that the root coordinator can route work across independent CLI processes and account profiles.

## Routing configuration

Read `~/.config/pstack-herdr/routes.yaml` when it exists. If it does not exist, treat the current parent runtime as the only available profile and run all children with the same authenticated account.

A profile selects:

- `kind`: `claude` or `codex`;
- optional model arguments appropriate to that CLI;
- environment overrides such as `CLAUDE_CONFIG_DIR` or `CODEX_HOME`.

One subscription does not require multiple profiles. Multiple Herdr agents may use the same profile and therefore the same authenticated subscription. They remain separate processes and context windows, but they share the provider account's usage and concurrency limits.

Multiple subscriptions are represented as multiple profiles with distinct authentication homes. Never copy tokens, cookies, session files, or credentials between profiles. The user authenticates each profile with the vendor CLI.

Use semantic pstack roles for routing rather than hard-coding a vendor in playbooks. Recommended roles are:

- `explorer`
- `implementation`
- `difficult-implementation`
- `judgment`
- `reviewer`
- `arena-candidate`
- `arena-judge`
- `verifier`
- `subcoordinator`

See `references/routes.example.yaml` for the configuration shape.

## Depth and recursive delegation

Herdr workers may themselves delegate when the active pstack workflow requires it. Preserve the original pstack hierarchy rather than flattening it.

Track depth with `PSTACK_HERDR_DEPTH`:

- root coordinator: depth `0`;
- each child receives `PSTACK_HERDR_DEPTH=<parent + 1>`;
- default maximum depth: `3`, unless configuration specifies a lower value.

The normal topology is coordinator -> worker, or coordinator -> subcoordinator -> worker/verifier. A regular worker may spawn a descendant when its active playbook explicitly requires delegation or when pstack's context-window discipline requires it. Verifiers and judges are leaves by default.

Every coordinator owns the descendants it creates. A subcoordinator rolls up child findings into one result for its parent. Do not dump raw descendant transcripts into the root context.

## Pane creation and profiles

Prefer a sibling pane in the current Herdr tab and preserve focus for background work. Parse pane and agent identifiers from Herdr JSON output; never predict identifiers.

When a route profile carries environment overrides, apply them to the new pane before starting the coding agent. Common examples are:

```text
CLAUDE_CONFIG_DIR=~/.claude
CODEX_HOME=~/.codex
PSTACK_HERDR_DEPTH=1
```

For multiple subscriptions, use distinct config homes such as `~/.claude-a`, `~/.claude-b`, `~/.codex-a`, and `~/.codex-b`.

Start the selected `claude` or `codex` agent only after the pane exists. `herdr agent start` does not create layout by itself.

## Worker brief

Every Herdr worker brief must include:

1. the pstack role it owns;
2. the exact task or exploration angle;
3. whether it may write or is read-only;
4. the repository/worktree scope;
5. the expected output or acceptance criteria;
6. the current pstack playbook or skill it must follow;
7. the instruction to load poteto-mode before ad-hoc pstack work;
8. the next `PSTACK_HERDR_DEPTH` value;
9. whether recursive delegation is permitted for this role.

For ad-hoc workers that correspond to `pstack:poteto-agent`, tell the new CLI session to read the installed `poteto-mode` skill in full before beginning. A Herdr agent kind is `claude` or `codex`; `poteto-agent` is a prompt/skill contract, not a Herdr agent kind.

## Worktree isolation

Follow pstack's **Separate Before Serializing Shared State** principle.

- Read-only explorers and reviewers may share the parent's checkout.
- A single writer may share the checkout only when no concurrent writer exists and the active playbook permits it.
- Two or more concurrent writers require separate git worktrees or otherwise separate writable output paths.
- Arena candidates always use separate writable worktrees or output directories.
- A verifier is read-only by default and verifies the produced worktree/branch rather than editing it.

Prefer the installed Herdr worktree commands when available. Inspect `herdr worktree --help`; do not hard-code stale syntax. Preserve a failed writer's worktree until its parent has inspected the failure.

## Waiting and blocked workers

Use Herdr's agent lifecycle rather than terminal-output guesses. `idle` and `done` are settled states. `blocked` means the worker is waiting on an approval or question. `unknown` is not proof of completion.

If a wait reports a blocked or stalled worker, inspect it with the official Herdr skill's recommended `agent get` and `agent read` flow. Do not blindly resend the task prompt.

For normal shell commands such as tests or dev servers, use Herdr pane commands and output waiting. For coding agents, use Herdr agent lifecycle commands.

## Completion contract

A child report is evidence, not acceptance. The owning coordinator must inspect the artifact and run the pstack playbook's required verification before reporting success.

Ask workers to return a compact structured result when practical:

```text
STATUS: PASS | ISSUES | BLOCKED
SUMMARY:
CHANGES:
TESTS:
EVIDENCE:
COMMIT:
```

The parent writes its own synthesis. It does not forward the worker report verbatim.
