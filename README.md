# pstack-herdr

Run poteto's pstack workflows through [Herdr](https://herdr.dev), with Claude Code and Codex CLI workers behind one long-lived coordinator.

This fork keeps the pstack playbooks from [pstack-claude](https://github.com/michael-denyer/pstack-claude), but replaces prompt-level Herdr adaptation with a native dispatcher. When pstack delegates inside Herdr, a Bun script calls the `herdr` CLI directly to create panes, start Claude/Codex workers, deliver prompts, wait for lifecycle state, and read results.

> if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence.

## Why this fork

pstack decides **what** to delegate. Herdr decides **how the worker process runs**.

```text
You
 │
 ▼
Herdr
 │
 ▼
Claude Code / Codex
MAIN COORDINATOR
poteto-mode
 │
 ├── how / architect / feature / arena / swarm / interrogate / ...
 │
 └── scripts/herdr-dispatch.ts
       │
       ├── herdr pane split
       ├── herdr agent start
       ├── herdr agent prompt
       ├── herdr agent get/read
       │
       ├── Claude worker
       ├── Codex worker
       └── recursively dispatched workers
```

Herdr delegation does **not** depend on a SessionStart instruction telling the model to remember an extra runtime skill. The SessionStart hook remains only for pstack's normal `poteto-mode` auto-entry. Delegation-heavy pstack workflows explicitly call the dispatcher when `HERDR_ENV=1`.

## What the dispatcher owns

[`herdr-dispatch.ts`](plugins/pstack/skills/poteto-mode/scripts/herdr-dispatch.ts) is the runtime boundary. It:

- refuses to control Herdr unless `HERDR_ENV=1`;
- selects Claude/Codex profiles by semantic pstack role;
- creates a sibling pane without stealing focus;
- applies profile environment such as `CLAUDE_CONFIG_DIR` or `CODEX_HOME`;
- propagates `PSTACK_HERDR_DEPTH` and the child runtime kind;
- starts the selected `claude` or `codex` agent through Herdr;
- submits the worker brief through `herdr agent prompt`;
- optionally waits for a settled lifecycle state;
- reads the worker state and recent output;
- reports `blocked` instead of treating an approval/question as completion;
- enforces a configurable recursive delegation depth.

The pstack skill still owns decomposition, worktree choice, worker briefs, synthesis, review, and final verification.

## Requirements

- [Herdr](https://herdr.dev)
- Claude Code and/or Codex CLI
- Git
- Bun

Install Herdr's CLI integrations for the agents you use:

```shell
herdr integration install claude
herdr integration install codex
```

The separate Herdr Agent Skill is useful for interactive Herdr control, but pstack-herdr's worker dispatch does not depend on an agent remembering or loading it. The dispatcher invokes the Herdr CLI itself.

## Install

### Claude Code

```text
/plugin marketplace add TiewKH/pstack-herdr
/plugin install pstack@pstack-claude
```

Start Claude Code inside a Herdr-managed pane, then use `/poteto-mode` normally. The existing SessionStart hook can still auto-enter poteto-mode for non-trivial engineering tasks.

### Shared Agent Skills / Codex

```shell
git clone https://github.com/TiewKH/pstack-herdr
cd pstack-herdr
mkdir -p ~/.agents/skills
for s in plugins/pstack/skills/*/; do ln -s "$PWD/$s" ~/.agents/skills/"$(basename "$s")"; done
```

Or install the skills subtree:

```shell
npx skills add https://github.com/TiewKH/pstack-herdr/tree/main/plugins/pstack/skills --skill "*" --agent "*" --yes
```

For Codex slash shortcuts:

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

For a feature, the pstack Feature playbook creates an isolated writer worktree and invokes the native dispatcher with role `implementation`. `how`, `arena`, `swarm`, and `interrogate` similarly use the dispatcher for their explorers, candidates, workers, judges, and reviewers.

The direct command shape is:

```shell
bun <poteto-mode>/scripts/herdr-dispatch.ts \
  --role implementation \
  --name feature-worker \
  --prompt-file /tmp/feature-brief.md \
  --cwd /path/to/worker-worktree \
  --wait
```

Normally the pstack workflow constructs this call. You should not need to invoke it manually.

## One subscription is enough

A routes file is optional. If no role route matches, the dispatcher falls back to the current CLI kind when it can infer Claude Code or Codex. You can also set `PSTACK_HERDR_PARENT_KIND=claude` or `codex` explicitly.

Multiple workers can therefore use the same authenticated CLI profile. They are separate processes and context windows, but they share the provider account's usage and concurrency limits.

For explicit routing, copy [`config/routes.example.yaml`](config/routes.example.yaml) to:

```text
~/.config/pstack-herdr/routes.yaml
```

## Multiple subscriptions

Use separate authenticated CLI homes and route semantic roles to them:

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
    profiles: [codex-a, claude-a]
    strategy: round-robin
  implementation:
    profiles: [codex-a, claude-a]
    strategy: round-robin
  difficult-implementation:
    profiles: [claude-main, codex-a]
    strategy: strongest-first
  reviewer:
    profiles: [claude-main, codex-a, claude-a]
    strategy: spread
  arena-candidate:
    profiles: [claude-main, codex-a, claude-a]
    strategy: spread
  arena-judge:
    profiles: [claude-main, codex-a]
    strategy: spread
  verifier:
    profiles: [codex-a, claude-main]
    strategy: round-robin
  subcoordinator:
    profiles: [claude-main]
    strategy: strongest-first
```

Authenticate each profile using its vendor CLI. Do not copy tokens, cookies, or session files between profile homes.

## Role routing

The dispatcher understands these pstack roles:

| Role | Typical work |
| --- | --- |
| `explorer` | read-only codebase exploration |
| `implementation` | normal code-writing delegate |
| `difficult-implementation` | concurrency, algorithms, cross-cutting implementation |
| `judgment` | synthesis and high-judgment reasoning |
| `reviewer` | independent review / interrogate |
| `arena-candidate` | isolated competing implementation/design |
| `arena-judge` | read-only candidate scoring |
| `verifier` | independent verification |
| `subcoordinator` | nested pstack coordinator |

`round-robin` and `spread` deterministically distribute worker names across a configured pool. `strongest-first` and `first-available` currently prefer the first profile in the configured list, so order those pools intentionally.

## Recursive delegation

Original pstack permits hierarchical delegation. pstack-herdr preserves that model.

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

The root starts at depth `0`. Every dispatcher-created pane receives `PSTACK_HERDR_DEPTH=<parent + 1>` and `PSTACK_HERDR_PARENT_KIND=<claude|codex>`. The default maximum depth is `3`.

This lets a Herdr-managed worker run a pstack workflow and dispatch descendants without relying on the root session to remind it how Herdr works.

## Parallel writers and worktrees

pstack remains responsible for isolation before it calls the dispatcher:

- read-only explorers and reviewers may share the coordinator checkout;
- concurrent writers must receive separate worktrees or writable output paths;
- arena candidates always receive isolated writable worktrees/output directories;
- verifiers are read-only by default.

The assigned checkout is passed to the dispatcher through `--cwd`; the dispatcher starts the new Herdr pane directly in that location.

## Blocked workers

With `--wait`, Herdr waits for the worker to settle. The dispatcher then queries the agent and reads recent unwrapped output. Its JSON result includes the agent, pane, selected profile, kind, depth, status, `blocked`, and recent output.

A blocked approval/question is therefore explicit runtime state rather than something the coordinator must infer from terminal text. A blocked worker is not a successful worker.

## Native vs non-Herdr execution

When `HERDR_ENV=1`, delegation-heavy workflows use [`herdr-tools.md`](plugins/pstack/skills/poteto-mode/references/herdr-tools.md) and the native dispatcher.

Outside Herdr, the inherited pstack-claude behavior remains available:

- Claude Code uses its native Agent tooling.
- Codex uses [`codex-tools.md`](plugins/pstack/skills/poteto-mode/references/codex-tools.md).
- Other Agent Skills runtimes continue to use their own equivalents.

## Current Herdr-routed workflows

The fork currently wires the native dispatcher directly into the highest-value delegation paths:

- Feature implementation delegation
- `/how`
- `/arena`
- `/swarm`
- `/interrogate`

Additional pstack workflows that directly spawn agents should be migrated to the same dispatcher contract rather than adding SessionStart instructions.

## Tests

The poteto-mode tooling test suite includes `herdr-dispatch.test.ts` for deterministic routing and parser behavior. The repository-level Herdr contract test checks that the SessionStart hook no longer owns Herdr activation and that the core delegation workflows reference the native dispatcher.

Live end-to-end testing still requires a machine running Herdr with authenticated Claude/Codex profiles.

## Slash commands

| command | use it when |
| --- | --- |
| `/poteto-mode` | default entry point for any non-trivial task |
| `/how` | walk through how a subsystem works |
| `/why` | investigate why something was built this way |
| `/architect` | design types and module shape before implementation |
| `/arena` | run parallel attempts and synthesize the best result |
| `/interrogate` | independent adversarial review |
| `/swarm` | parallel coverage, races, and exploration |
| `/tdd` | reproduce a bug with a failing test before fixing it |
| `/teach` | compose how + why into an explanation |
| `/reflect` | capture durable lessons from a task |
| `/technical-writing` | docs, RFCs, readmes, PR descriptions, commits |
| `/figure-it-out` | design a rigorous playbook for an unusual task |
| `/show-me-your-work` | maintain an auditable decision trail |
| `/setup-pstack` | configure pstack model roles |
| `/unslop` | remove AI writing tells |
| `/no-comments` | remove unnecessary comments before review |
| `/deslop` | clean a diff before commit |
| `/babysit` | monitor and repair an open PR |

The repository retains the rest of the pstack-claude skill tree as well.

## Attribution and lineage

**pstack.** The original pstack engineering workflows and Poteto Mode were created by [Lauren Tan (poteto)](https://x.com/poteto) and published in [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) under the MIT License.

**pstack-claude.** [Michael Denyer](https://github.com/michael-denyer) authored and maintains [pstack-claude](https://github.com/michael-denyer/pstack-claude), the Claude Code/Codex portability work this repository forks. It also preserves notices for imported `cursor-team-kit` components from Cursor.

**Herdr.** [herdrdev](https://github.com/herdrdev/herdr) maintains Herdr. Herdr is Apache-2.0 licensed. This repository invokes the separately installed Herdr runtime and does not vendor or relicense it.

pstack-herdr is an independent fork. It is not an official project of Lauren Tan, Michael Denyer, Cursor, Anthropic, OpenAI, or herdrdev.

See [`NOTICE.md`](NOTICE.md), [`NOTICE-skills.md`](NOTICE-skills.md), [`LICENSE`](LICENSE), and [`LICENSE-cursor-team-kit`](LICENSE-cursor-team-kit) for preserved notices and license boundaries.

## Upstream synchronization

The fork keeps pstack-claude's synchronization machinery under `tools/`. Herdr-specific changes should stay concentrated in the dispatcher, the Herdr platform mapping, routing config, tests, and the small set of delegation call sites. This keeps future upstream syncs reviewable.

## License

The pstack-derived code remains under its preserved MIT terms. Imported cursor-team-kit components retain their MIT terms. Herdr remains under its own Apache-2.0 license and is invoked as an external runtime.
