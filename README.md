# pstack-herdr

Run poteto's pstack workflows through [Herdr](https://herdr.dev), with Claude Code or Codex CLI workers behind one long-lived coordinator.

This fork is for people who want pstack's engineering playbooks without making Cursor the agent runtime. Start one main Claude or Codex session inside Herdr, enter `poteto-mode`, and let pstack route explorers, implementers, reviewers, arena candidates, judges, and verifiers into independent Herdr-managed CLI processes.

> if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence.

## Why this fork

[pstack-claude](https://github.com/michael-denyer/pstack-claude) translates Cursor's pstack primitives to Claude Code and Codex. This fork keeps that skill tree and adds Herdr as the orchestration transport.

- **pstack decides what work to do.** Playbooks, principles, decomposition, model roles, review, synthesis, and verification stay pstack concerns.
- **Herdr decides how delegated agents run.** Panes, processes, CLI startup, account profiles, lifecycle state, waiting, blocked workers, and terminal output stay Herdr concerns.
- **Claude Code and Codex remain the workers.** A Herdr agent is a real `claude` or `codex` CLI process with its own context window.

There is only one `poteto-mode`, one `arena`, one `how`, one `interrogate`, and one copy of every other pstack workflow. Herdr support is an execution adapter, not a shadow skill tree.

## Architecture

```text
You
 │
 ▼
Herdr
 │
 ▼
Claude Code or Codex
MAIN COORDINATOR
poteto-mode
 │
 ├── pstack playbooks and principles
 ├── role routing
 └── pstack:herdr-runtime
       │
       ├── Claude worker
       ├── Codex worker
       ├── Claude reviewer
       └── Codex verifier
```

The coordinator stays alive and owns the human-facing result. Workers may recursively delegate when the active pstack workflow requires it. The default Herdr nesting limit is three levels.

## What Herdr adds

- One long-lived coordinator with visible worker panes.
- Claude and Codex workers in the same pstack run.
- One subscription shared by many workers, or multiple independently authenticated subscriptions.
- Separate context windows for each worker process.
- Role-based routing for explorers, implementers, reviewers, arena candidates, judges, and verifiers.
- Recursive delegation through Herdr instead of native-only subagents.
- Worktree isolation for concurrent writers and arena candidates.
- Explicit handling of `idle`, `done`, `blocked`, and `unknown` agent states.

## Requirements

Install [Herdr](https://herdr.dev), Claude Code and/or Codex CLI, Git, and the official Herdr Agent Skill.

```shell
npx skills add herdrdev/herdr --skill herdr -g
```

The Herdr runtime activates only inside a Herdr-managed environment where `HERDR_ENV=1`. Outside Herdr, the existing pstack Claude/Codex behavior remains available.

## Install pstack-herdr

### Claude Code

```text
/plugin marketplace add TiewKH/pstack-herdr
/plugin install pstack@pstack-claude
```

Launch Claude Code from a Herdr pane. The SessionStart mandate detects `HERDR_ENV=1`, loads `pstack:herdr-runtime`, and routes non-trivial engineering work through `pstack:poteto-mode`.

### Shared Agent Skills

```shell
git clone https://github.com/TiewKH/pstack-herdr
cd pstack-herdr
mkdir -p ~/.agents/skills
for s in plugins/pstack/skills/*/; do ln -s "$PWD/$s" ~/.agents/skills/"$(basename "$s")"; done
```

Or:

```shell
npx skills add https://github.com/TiewKH/pstack-herdr/tree/main/plugins/pstack/skills --skill "*" --agent "*" --yes
```

### Codex

Codex uses the same `skills/` tree. Inside Herdr, pstack delegation is routed through `pstack:herdr-runtime`, so workers can be Claude, Codex, or a mixture selected by routing configuration.

```shell
mkdir -p ~/.codex/prompts
for c in plugins/pstack/.codex-plugin/prompts/*.md; do ln -s "$PWD/$c" ~/.codex/prompts/"$(basename "$c")"; done
```

## Quick start

```text
herdr
  └── claude
       └── /poteto-mode implement this feature
```

The coordinator chooses a pstack playbook and spawns the required Herdr workers. A feature run can use Codex explorers, an isolated implementation worker, independent Claude/Codex reviewers, and a verifier while the root Claude session remains the coordinator.

## One subscription is enough

You do not need multiple subscriptions. Multiple Herdr agents can use the same authenticated profile:

```yaml
profiles:
  claude-main:
    kind: claude
    model: inherit
    env:
      CLAUDE_CONFIG_DIR: ~/.claude

roles:
  explorer:
    pool: [claude-main]
  implementation:
    pool: [claude-main]
  reviewer:
    pool: [claude-main]
  verifier:
    pool: [claude-main]
```

Each worker is a separate process and context window, but workers using that profile share the provider account's usage, rate, and concurrency limits.

## Multiple subscriptions

Multiple subscriptions are optional. Use separate CLI config homes such as `~/.claude-main`, `~/.claude-a`, `~/.claude-b`, `~/.codex-a`, and `~/.codex-b`, then route roles in `~/.config/pstack-herdr/routes.yaml`:

```yaml
version: 1
orchestration:
  max_depth: 3
  default_timeout_ms: 180000

profiles:
  claude-main:
    kind: claude
    model: inherit
    env:
      CLAUDE_CONFIG_DIR: ~/.claude-main
  claude-a:
    kind: claude
    model: inherit
    env:
      CLAUDE_CONFIG_DIR: ~/.claude-a
  codex-a:
    kind: codex
    model: inherit
    env:
      CODEX_HOME: ~/.codex-a

roles:
  explorer:
    strategy: round-robin
    pool: [codex-a, claude-a]
  implementation:
    strategy: first-available
    pool: [codex-a, claude-a]
  judgment:
    strategy: strongest-first
    pool: [claude-main, claude-a]
  reviewer:
    strategy: round-robin
    pool: [claude-a, codex-a]
  arena-candidate:
    strategy: spread
    pool: [claude-a, codex-a]
  arena-judge:
    strategy: strongest-first
    pool: [claude-main]
  verifier:
    strategy: first-available
    pool: [codex-a, claude-a]
```

Authenticate each profile using the vendor CLI. Do not copy authentication tokens, cookies, or session files between profiles. A complete example lives at [`config/routes.example.yaml`](config/routes.example.yaml).

## Recursive delegation

Original pstack allows hierarchical delegation. pstack-herdr preserves it:

```text
root coordinator
 │
 ├── worker
 ├── verifier
 └── subcoordinator
      │
      ├── worker
      └── verifier
```

`PSTACK_HERDR_DEPTH` tracks nesting. The default maximum is `3`. Workers create descendants only when the active pstack workflow requires delegation or context-window discipline calls for it. Judges and verifiers are leaves by default.

## Parallel writers and worktrees

- Read-only explorers and reviewers may share the coordinator's checkout.
- One writer may share it only when no concurrent writer exists and the playbook permits it.
- Two or more concurrent writers use separate git worktrees or separate writable output paths.
- Arena candidates always receive isolated writable worktrees or output directories.
- Verifiers are read-only by default.

The runtime consults the installed Herdr worktree commands instead of baking version-sensitive Herdr CLI syntax into pstack.

## Herdr lifecycle

The official Herdr skill is authoritative for exact CLI syntax and lifecycle semantics. pstack-herdr distinguishes `idle` and `done` as settled states, `blocked` as waiting on an approval or question, and `unknown` as not proof of completion.

Blocked or stalled workers are inspected before any prompt is resent. The coordinator owns every child result and independently verifies the resulting artifact before reporting success.

See [`HERDR.md`](HERDR.md) for the runtime-specific guide.

## Runtime mapping

| pstack action | Herdr execution |
| --- | --- |
| create a subagent | create/select a pane, then start a Herdr coding agent |
| send delegated work | prompt the Herdr agent |
| fan out N workers | start N independent panes/agents before waiting |
| wait for completion | use Herdr agent lifecycle waiting |
| inspect output | read the Herdr agent stream |
| inspect a blocked worker | inspect agent state and recent output |
| isolate a writer | create/use a dedicated worktree and start the pane there |

The installed Herdr skill and binary remain authoritative for concrete commands.

## Project layout

```text
.
├── config/
│   └── routes.example.yaml
├── plugins/pstack/
│   ├── skills/
│   │   ├── herdr-runtime/
│   │   ├── poteto-mode/
│   │   └── ...
│   ├── hooks/
│   ├── agents/
│   └── .codex-plugin/
├── tests/
│   └── herdr-runtime.test.mjs
├── HERDR.md
├── NOTICE-HERDR.md
├── NOTICE.md
└── README.md
```

## Upstream pstack-claude compatibility

pstack-herdr is a fork of [Michael Denyer's pstack-claude](https://github.com/michael-denyer/pstack-claude). The fork preserves the upstream skill/playbook structure so future pstack-claude changes can be synchronized without maintaining a second Herdr-specific copy of every workflow.

Outside `HERDR_ENV=1`, existing Claude Code and Codex adaptations remain the baseline. The upstream Codex mapping remains at [`plugins/pstack/skills/poteto-mode/references/codex-tools.md`](plugins/pstack/skills/poteto-mode/references/codex-tools.md). The shared Agent Skills tree remains usable by Prime Agent, opencode, Gemini CLI, and other compatible runtimes.

## Slash commands

| command | use it when |
| --- | --- |
| `/poteto-mode` | default entry point for any non-trivial task |
| `/how` | walk through how a subsystem works |
| `/why` | investigate why something was built this way (parallel multi-MCP evidence) |
| `/architect` | settle types and module shape before writing code that crosses a function boundary |
| `/arena` | run N parallel attempts at the same task and pick the best parts |
| `/interrogate` | have three different models try to break a diff |
| `/automate-me` | draft your own personal -mode skill from recent transcripts |
| `/reflect` | capture a long task's lessons as a skill edit |
| `/tdd` | fix a bug by writing the failing test first, then the fix |
| `/typescript-best-practices` | ground type-system discipline in TypeScript syntax |
| `/teach` | explain a subsystem plainly by composing how + why |
| `/swarm` | fan out N parallel workers across slices or races, then return one aggregated report |
| `/technical-writing` | write docs, RFCs, readmes, PR descriptions, and commit messages to one layered standard |
| `/bro` | restate the last message in plain human language, no jargon |
| `/figure-it-out` | design a rigorous, auditable playbook for a task no bundled playbook fits |
| `/show-me-your-work` | log decisions to a reviewable tsv decision trail |
| `/blast-radius` | find what a change could break beyond the diff and prove safety by running code |
| `/recall` | catch up on recent working context from chat history, live state, and the shared record |
| `/setup-pstack` | configure pstack per-role model choices |
| `/unslop` | clean up writing by removing AI tells |
| `/no-comments` | strip comments before review, fix the accepted findings, encode claimed constraints |
| `/create-verification-skill` | generate a project-local verification skill and feature map |
| `/maintain-verification-skill` | re-sync a drifted verification skill and its feature map |
| `/deslop` | deslop a diff before commit |
| `/babysit` | monitor an open PR, fix CI/comments, keep it merge-ready |
| `/thermo-nuclear-code-quality-review` | extremely strict maintainability audit |
| `/make-pr-easy-to-review` | clean noisy history and improve PR description before review |
| `/fix-ci` | find failing PR checks, inspect logs, apply focused fixes |
| `/fix-merge-conflicts` | non-interactively resolve merge conflicts, validate, finalize |
| `/get-pr-comments` | fetch and summarize review comments from the active PR |
| `/what-did-i-get-done` | summarize authored commits over a user-chosen period |

## Attribution and lineage

**pstack.** The original pstack engineering workflows and Poteto Mode were created by [Lauren Tan (poteto)](https://x.com/poteto) and published in [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) under the MIT License.

**pstack-claude.** [Michael Denyer](https://github.com/michael-denyer) authored and maintains [pstack-claude](https://github.com/michael-denyer/pstack-claude), the Claude Code/Codex portability work this repository forks. That project also preserves notices for imported `cursor-team-kit` components from Cursor.

**Herdr.** [herdrdev](https://github.com/herdrdev/herdr) maintains Herdr and the official Herdr Agent Skill. Herdr is licensed under Apache License 2.0. This repository uses Herdr as a runtime and does not claim authorship of Herdr itself.

pstack-herdr is an independent fork. It is not an official project of Lauren Tan, Michael Denyer, Cursor, Anthropic, OpenAI, or herdrdev.

See [`NOTICE.md`](NOTICE.md), [`NOTICE-skills.md`](NOTICE-skills.md), [`NOTICE-HERDR.md`](NOTICE-HERDR.md), [`LICENSE`](LICENSE), and [`LICENSE-cursor-team-kit`](LICENSE-cursor-team-kit) for preserved notices and license boundaries.

## Upstream synchronization

The fork keeps pstack-claude's synchronization machinery under `tools/`. When upstream changes, prefer a focused sync/rebase that preserves the Herdr adapter as a small runtime-specific layer.

The design rule is simple: do not rewrite upstream playbooks merely to mention Herdr. Put transport behavior in `herdr-runtime`; change a shared skill only when its semantic contract truly needs to know about the runtime.

## Status

The Herdr integration is under active validation. Static CI covers the runtime contract, routing configuration, and skill-tree invariants. Live Claude/Codex execution with authenticated Herdr profiles is the final acceptance test before relying on the fork for unattended or long-running orchestration.

## License

The pstack-derived code remains under its preserved MIT terms. Imported cursor-team-kit components retain their MIT terms. Herdr itself and its official skill are Apache-2.0 and are referenced, not relicensed by this repository. See the notice files above for exact boundaries.
