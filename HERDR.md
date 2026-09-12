# Running pstack through Herdr

This fork adds a Herdr execution adapter to the portable pstack skill tree. pstack still owns the engineering workflow. Herdr replaces the native subagent transport when the root coding agent is running inside Herdr (`HERDR_ENV=1`).

## What changes

The main Claude or Codex session remains the root coordinator. It selects pstack playbooks, decomposes work, chooses semantic roles, synthesizes results, reviews diffs, and verifies the final artifact.

When pstack delegates, `pstack:herdr-runtime` starts independent Claude or Codex CLI processes in Herdr panes. This makes it possible to use independent context windows, mix Claude and Codex workers, route roles to separately authenticated subscriptions, and keep parallel writers in separate worktrees.

A single subscription works too. Multiple Herdr workers can use the same Claude or Codex profile. They are independent agent processes but share that provider account's limits.

## Requirements

- Herdr 0.9.0 or newer.
- The official Herdr Agent Skill.
- Claude Code and/or Codex CLI installed and authenticated.
- pstack installed from this fork.

Install Herdr's official skill using the method recommended by Herdr. With the Skills CLI:

```sh
npx skills add herdrdev/herdr --skill herdr -g
```

Install Herdr's CLI integrations for the runtimes you use:

```sh
herdr integration install claude
herdr integration install codex
```

The Herdr skill deliberately treats the installed binary as the source of truth. Inspect `herdr --help` and relevant command-group help instead of copying old command syntax from this document.

## Install this fork

For Claude Code, add this fork as the plugin marketplace instead of the upstream pstack-claude repository, then install its pstack plugin.

For Codex and other Agent Skills runtimes, use the upstream shared-skills installation pattern but clone this repository. The portable skill tree is `plugins/pstack/skills/`.

## Start the coordinator

Launch Herdr, then start the Claude or Codex session you want to act as the root coordinator inside a Herdr-managed pane. Herdr exposes `HERDR_ENV=1` to managed agents. The pstack session-start mandate sees that environment and activates `pstack:herdr-runtime` for delegation.

For the intended setup, use Claude/Fable as the main coordinator. Poteto mode remains the front door. The coordinator can then route exploration, implementation, review, arena candidates, judges, and verification to Herdr workers.

## One subscription

No route file is required. Without `~/.config/pstack-herdr/routes.yaml`, Herdr delegation uses the parent runtime/account as the available profile.

You can still fan out multiple workers. They share the subscription's provider limits.

## Multiple subscriptions

Authenticate each account into a separate CLI config home. For example:

```text
~/.claude
~/.claude-a
~/.claude-b
~/.codex-a
~/.codex-b
```

Claude profiles are selected with `CLAUDE_CONFIG_DIR`. Codex profiles are selected with `CODEX_HOME`. Do not copy authentication material between profiles. Log into each profile through its vendor CLI.

Copy the example route file from:

```text
plugins/pstack/skills/herdr-runtime/references/routes.example.yaml
```

to:

```text
~/.config/pstack-herdr/routes.yaml
```

Then edit the profile list to match the accounts you actually authenticated.

The route file maps semantic pstack roles such as `explorer`, `implementation`, `reviewer`, `arena-candidate`, and `verifier` to one or more Claude/Codex profiles. This keeps playbooks independent of vendor and subscription details.

## Recursive delegation

This fork preserves pstack's nested delegation model. Workers are not globally forbidden from spawning descendants.

The root starts at `PSTACK_HERDR_DEPTH=0`. Each Herdr child receives the next depth. The default maximum is 3. Subcoordinators can fan out workers and verifiers. Regular workers may delegate when their active pstack playbook explicitly requires it or when pstack's context-window discipline calls for it. Judges and verifiers are leaves by default.

A child rolls up its descendants. The root coordinator should not absorb raw nested transcripts.

## Parallel writers

Read-only workers may share the parent checkout. Parallel writers may not.

When two or more workers can write, each gets a separate worktree or other isolated writable output path. Arena candidates are always isolated. This preserves pstack's Separate Before Serializing Shared State principle while using Herdr as the process runtime.

## Runtime responsibilities

pstack owns:

- playbook selection;
- decomposition;
- role selection;
- model intent;
- worktree requirements;
- nesting policy;
- synthesis;
- review and verification.

Herdr owns:

- pane/process lifecycle;
- starting Claude/Codex CLI agents;
- applying profile environment variables;
- delivering prompts;
- waiting for agent state;
- detecting blocked workers;
- reading worker output;
- terminal and worktree mechanics.

The official Herdr skill owns the exact control procedure. `pstack:herdr-runtime` supplies the pstack-specific policy layered on top.
