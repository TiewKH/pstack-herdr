# pstack-herdr

**pstack workflows with native Herdr-backed multi-agent delegation for Claude Code and Codex.**

`pstack-herdr` is a fork of [`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude) that preserves pstack's rigorous engineering workflows while adding [Herdr](https://github.com/herdrdev/herdr) as the structural runtime for delegated agents.

When the coordinator runs inside Herdr (`HERDR_ENV=1`), delegation-heavy pstack workflows launch real Claude Code or Codex processes in Herdr panes. Workers are visible, independently routable, and can participate in bounded recursive delegation. Outside Herdr, the inherited Claude Code and Codex behavior remains available.

> **pstack decides what work should be delegated and how it should be isolated, reviewed, and verified. Herdr provides where delegated agents run and how they are observed and controlled.**

## Why this fork exists

pstack provides engineering playbooks that explore before editing, isolate concurrent writers, fan work out to specialists, synthesize results, review changes, and verify before completion.

`pstack-herdr` adds a first-class execution layer for users who want those workflows to run visible terminal agents rather than opaque background subagents.

The design goals are:

- **Visible delegation** — delegated Claude/Codex workers run in Herdr panes you can inspect and interact with.
- **Role-aware routing** — semantic roles such as implementation, reviewer, verifier, and subcoordinator can be mapped to Claude or Codex profiles.
- **Subscription flexibility** — one authenticated profile can run multiple workers, while multiple subscriptions/accounts can be represented by separate authenticated config homes.
- **Preserved pstack semantics** — Herdr replaces the delegation transport, not pstack's decomposition, worktree isolation, synthesis, review, or verification rules.

## Architecture

```text
                         pstack workflow
                               |
                    decomposition + roles
                               |
                               v
                     herdr-dispatch.ts
                               |
                  routing + depth + cwd
                               |
                 +-------------+-------------+
                 |                           |
                 v                           v
          Claude Code worker            Codex worker
          in a Herdr pane               in a Herdr pane
                 |                           |
                 +-------------+-------------+
                               |
                     result / review / verify
                               |
                               v
                       parent coordinator
```

| Layer | Responsibility |
| --- | --- |
| **pstack** | decomposition, semantic roles, playbooks, worktree/isolation policy, synthesis, review, verification |
| **`herdr-dispatch.ts`** | pane creation, profile environment, CLI startup, prompt delivery, lifecycle waiting, output reads, recursive depth |
| **Herdr** | terminal panes, agent lifecycle/status, visibility, interaction |
| **Claude Code / Codex** | execution of delegated work |

The skill bodies retain their Claude-native Agent/Task vocabulary. [`herdr-tools.md`](plugins/pstack/skills/poteto-mode/references/herdr-tools.md) translates that vocabulary when `HERDR_ENV=1`, analogous to the inherited [`codex-tools.md`](plugins/pstack/skills/poteto-mode/references/codex-tools.md) mapping.

See [`HERDR.md`](HERDR.md) for the lower-level runtime contract.

## What PR #1 added

PR #1 made Herdr routing structural rather than a prompt-only convention. It introduced:

- `herdr-dispatch.ts` as the executable pstack/Herdr worker boundary.
- semantic role routing across Claude Code and Codex.
- one or multiple authenticated CLI profiles.
- stable profile spreading for route pools.
- bounded recursive delegation with a default maximum depth of 3.
- propagation of caller-selected `--cwd`, preserving pstack worktree isolation.
- direct Herdr routing across the main delegation-heavy workflows.
- contract tests that detect accidental loss of dispatcher integration.
- a real Herdr dispatch CI exercise.
- hardened CI execution with read-only repository access and explicit timeouts.

Herdr activation is deliberately **not** owned by a `SessionStart` prompt. Workflows select the dispatcher structurally when running in the Herdr environment.

## Delegation roles

Routing is based on semantic intent rather than hard-coded worker names:

| Role | Intended use |
| --- | --- |
| `explorer` | read-only investigation and codebase reconnaissance |
| `implementation` | normal implementation work |
| `difficult-implementation` | harder implementation routed to a stronger/different worker |
| `judgment` | reasoning, trade-offs, and decision support |
| `reviewer` | independent code/diff review |
| `arena-candidate` | competing solution in an Arena workflow |
| `arena-judge` | evaluation of competing Arena candidates |
| `verifier` | testing and validation of completed work |
| `subcoordinator` | decomposition of a delegated branch of work, including further delegation |

This separates workflow intent from provider selection: you can change which CLI/profile handles a role without rewriting the playbook.

## Recursive delegation

Herdr workers can themselves delegate when a workflow needs another coordination layer. Each child receives:

```text
PSTACK_HERDR_DEPTH=<parent depth + 1>
PSTACK_HERDR_PARENT_KIND=<child kind>
```

The default `max_depth` is **3**, supporting structures such as:

```text
coordinator
  -> subcoordinator
       -> implementation worker
       -> reviewer / verifier
```

without allowing unbounded fan-out.

## Worktrees and isolation

Herdr does not replace pstack's isolation model. Read-only explorers/reviewers may share a checkout. Concurrent writers, Arena/Eval candidates, and other potentially conflicting tasks should receive separate writable worktrees or directories.

The pstack caller chooses the location and passes it to the dispatcher via `--cwd`. The workflow therefore remains authoritative about filesystem isolation.

## Requirements

You need Herdr, Claude Code and/or Codex authenticated for the worker types you intend to use, and this fork's pstack skills installed for your coordinator runtime.

Install the Herdr integrations you use:

```sh
herdr integration install claude
herdr integration install codex
```

Then start the main coordinator **inside Herdr**. `HERDR_ENV=1` selects the Herdr delegation path.

## Installation

### Claude Code

Add this fork as a marketplace source and install pstack:

```text
/plugin marketplace add TiewKH/pstack-herdr
/plugin install pstack@pstack-claude
```

The important difference from upstream is that the marketplace source is `TiewKH/pstack-herdr`.

### Shared Agent Skills

Codex and other runtimes that discover Agent Skills from `~/.agents/skills/` can use the shared skill tree directly:

```sh
git clone https://github.com/TiewKH/pstack-herdr.git
cd pstack-herdr
mkdir -p ~/.agents/skills
for s in plugins/pstack/skills/*/; do
  ln -s "$PWD/$s" ~/.agents/skills/"$(basename "$s")"
done
```

Or use the `skills` CLI:

```sh
npx skills add https://github.com/TiewKH/pstack-herdr/tree/main/plugins/pstack/skills \
  --skill "*" --agent "*" --yes
```

Keep the internal `principle-*` directories installed even if your runtime exposes them differently; `poteto-mode` uses them as references.

### Codex

If you also want native Codex subagents outside the Herdr path, enable multi-agent support:

```toml
# ~/.codex/config.toml
[features]
multi_agent = true
```

For slash-command shortcuts, link the generated prompts:

```sh
mkdir -p ~/.codex/prompts
for c in plugins/pstack/.codex-plugin/prompts/*.md; do
  ln -s "$PWD/$c" ~/.codex/prompts/"$(basename "$c")"
done
```

Inside Herdr, migrated pstack delegation paths use the Herdr dispatcher rather than depending on Codex's native subagent transport.

## Routing workers and subscriptions

Explicit routing lives at:

```text
~/.config/pstack-herdr/routes.yaml
```

Start from the repository example:

```sh
mkdir -p ~/.config/pstack-herdr
cp config/routes.example.yaml ~/.config/pstack-herdr/routes.yaml
```

Profiles can provide runtime-specific config homes:

- Claude Code: `CLAUDE_CONFIG_DIR`
- Codex: `CODEX_HOME`

### One subscription, multiple workers

A single authenticated Claude or Codex profile can back multiple worker processes. You do **not** need multiple subscriptions just to spawn multiple agents.

Those workers share the same provider account and therefore share its concurrency, rate, and usage limits.

### Multiple subscriptions/accounts

Give independently authenticated profiles separate config homes and put them into the appropriate route pools. pstack-herdr can then select among them without mixing credentials.

Pool strategies are:

- `spread` — stable-hash workers across the configured pool.
- `first` — always use the first configured profile.

Authentication remains owned by the underlying Claude/Codex CLI; pstack-herdr only selects the configured profile.

## Dispatcher CLI

The runtime can also be exercised directly:

```sh
bun <poteto-mode>/scripts/herdr-dispatch.ts \
  --role implementation \
  --name feature-worker \
  --prompt-file /tmp/feature-brief.md \
  --cwd /path/to/worktree \
  --wait
```

`--timeout` / `orchestration.default_timeout_ms` supplies the budget for Herdr agent startup and prompt waiting.

For parallel fan-out, launch all dispatcher processes before waiting. A Herdr state of `blocked` is not completion; inspect the worker for an approval or question. `unknown` likewise must not be treated as successful completion.

## Workflows routed through Herdr

PR #1 migrated direct delegation paths for:

- Feature, Bug fix, Refactoring, Perf issue, Hillclimb, Eval, Autonomous run.
- How, Why, Arena, Swarm, Interrogate, Reflect.
- Orchestrate, Autopilot-full, Autopilot-stack.

`Architect` inherits Herdr through How/Why/Arena/Interrogate. `Figure-it-out` inherits it through Architect and through the delegated execution plan it creates.

Repository contract tests guard this boundary so future edits cannot silently return migrated workflows to inline/native delegation.

## Relationship to upstream pstack-claude

This is a fork, not a rewrite. It retains the upstream skill collection, Claude Code plugin packaging, Codex compatibility layer, generated command stubs, workflow tooling, and pstack engineering philosophy. Herdr is an additional delegation runtime beneath those workflows.

Upstream documentation and implementation therefore remain relevant for individual skill behavior, `poteto-mode`, Claude-to-Codex translation, portable skill assets, slash-command generation, and synchronization with pstack upstream.

See [`CHANGES.md`](CHANGES.md) for the detailed port/sync audit and [`NOTICE.md`](NOTICE.md) for source attribution.

## Repository layout

```text
.
├── config/
│   └── routes.example.yaml            # Herdr role/profile routing example
├── plugins/pstack/
│   ├── skills/
│   │   └── poteto-mode/
│   │       ├── references/
│   │       │   ├── herdr-tools.md     # pstack -> Herdr translation
│   │       │   └── codex-tools.md     # Claude -> Codex translation
│   │       └── scripts/
│   │           └── herdr-dispatch.ts  # Herdr delegation boundary
│   ├── agents/                        # Claude-native agent definitions
│   ├── hooks/                         # inherited Claude Code plugin hooks
│   └── .codex-plugin/                 # Codex plugin metadata/prompts
├── tests/
│   ├── herdr-runtime.test.mjs         # integration contracts
│   └── herdr-e2e.sh                   # real Herdr dispatch exercise
├── HERDR.md                           # detailed Herdr runtime contract
├── CHANGES.md                         # pstack port/sync audit
├── NOTICE.md                          # attribution and upstream pins
└── README.md
```

## Development and validation

Useful local checks include:

```sh
bun tools/generate.mjs
bun test tests/
node tests/herdr-runtime.test.mjs
```

CI also covers vendored tooling, shell scripts, Markdown, links, workflow linting, vulnerability scanning, and a real Herdr dispatch path.

Pull-request workflows are constrained with read-only repository permissions, disabled checkout credential persistence, read-only lint/scanner mounts, pinned actions, and job timeouts.

## Behavior outside Herdr

`pstack-herdr` does not force Herdr on every installation. When `HERDR_ENV=1`, migrated delegation workflows use `herdr-dispatch.ts`. Otherwise the inherited Claude Code/Codex execution path remains available.

This allows the fork to behave like normal pstack until you deliberately launch the coordinator through Herdr.

## Attribution

`pstack-herdr` builds on and credits the projects it extends:

- **pstack / Poteto Mode** — Lauren Tan ([poteto](https://github.com/poteto)), MIT.
- **pstack-claude** — portable Claude Code/Codex port by [Michael Denyer](https://github.com/michael-denyer).
- **cursor-team-kit components** — Cursor, MIT.
- **Herdr** — [herdrdev](https://github.com/herdrdev/herdr), Apache-2.0; an external runtime, not vendored or relicensed here.

See [`NOTICE.md`](NOTICE.md), [`LICENSE`](LICENSE), and [`LICENSE-cursor-team-kit`](LICENSE-cursor-team-kit) for complete attribution and license information.

## Project status

The Herdr runtime introduced by PR #1 is merged into `main`. Static contracts and CI protect the integration boundary; live use requires a running Herdr environment and authenticated Claude Code and/or Codex CLI profiles.

For routing semantics, recursive-depth behavior, dispatcher details, and workflow safety, continue with [`HERDR.md`](HERDR.md).
