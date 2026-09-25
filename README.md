# pstack-herdr

[pstack](https://github.com/cursor/plugins/tree/main/pstack) for Claude Code and Codex, with delegated agents running as visible [Herdr](https://github.com/herdrdev/herdr) panes.

This is a fork of [`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude), the Claude Code and Codex port of Lauren Tan's pstack. It has 54 Agent Skills: 31 public skills and 23 `principle-*` leaves. The skill tree is synced against upstream `12d587d` from `cursor/plugins/pstack`.

Inside Herdr (`HERDR_ENV=1`), workflows that delegate start real Claude Code or Codex workers in Herdr panes, routed by role. You can watch and answer each worker. Outside Herdr, the plugin behaves like pstack-claude.

## Install

### Claude Code

```text
/plugin marketplace add TiewKH/pstack-herdr
/plugin install pstack@pstack-claude
```

### Codex

```shell
codex plugin marketplace add TiewKH/pstack-herdr
codex plugin add pstack@pstack-claude
```

Codex asks you to trust the routing hook through `/hooks` before it runs. For skills-only installs and other runtimes, see [shared installation](docs/reference.md#shared-skills-installation).

## Use it with Herdr

1. Install Herdr, then its integrations for the CLIs you use: `herdr integration install claude` and `herdr integration install codex`.
2. Inside Herdr, run `/pstack:setup-pstack`. It writes `~/.config/pstack-herdr/routes.yaml`, which maps each role to a Claude or Codex profile, model, and effort. [`config/routes.example.yaml`](config/routes.example.yaml) shows the format.
3. Start the coordinator inside Herdr and give `poteto-mode` a task:

```text
Use poteto-mode to fix the search filter resetting when I change pages.
```

`poteto-mode` picks the playbook. For a bug, it reproduces the failure, investigates with `how` and `why`, delegates the fix to an `implementation` worker, and reruns the failing case.

## How delegation works

| Layer | Owns |
| --- | --- |
| pstack skills | decomposition, roles, worktree isolation, synthesis, review, verification |
| [`herdr-dispatch.ts`](plugins/pstack/skills/poteto-mode/scripts/herdr-dispatch.ts) | pane creation, profile environment, CLI startup, prompt delivery, waiting, output reads, pane cleanup, delegation depth |
| [`herdr-agent-gate.sh`](plugins/pstack/hooks/herdr-agent-gate.sh) | on Claude Code, denies the native `Agent` tool inside Herdr and returns the dispatcher command |
| Herdr | panes, agent status, visibility |
| Claude Code, Codex | the delegated work |

Skills keep Claude's Agent vocabulary. [`herdr-tools.md`](plugins/pstack/skills/poteto-mode/references/herdr-tools.md) translates it to dispatcher calls when `HERDR_ENV=1`, the same way `codex-tools.md` does for Codex. [HERDR.md](HERDR.md) is the runtime contract: roles, routing, depth limits, isolation, and the dispatcher's lifecycle.

## More

- [Skills and slash commands](docs/reference.md#slash-commands)
- [Runtime setup](docs/reference.md#runtime-support)
- [Models and dependencies](docs/reference.md#configuration-and-dependencies)
- [Maintenance and port scope](docs/reference.md#maintenance)
- [Contributing](CONTRIBUTING.md) and [security reports](SECURITY.md)

## Attribution

- pstack and Poteto Mode by Lauren Tan ([poteto](https://github.com/poteto)), MIT.
- pstack-claude, the Claude Code and Codex port, by [Michael Denyer](https://github.com/michael-denyer).
- Imported cursor-team-kit skills by Cursor, MIT.
- Herdr by [herdrdev](https://github.com/herdrdev/herdr), Apache-2.0. It is an external runtime, not vendored or relicensed here.

This fork's changes are also [MIT-licensed](LICENSE). See [NOTICE.md](NOTICE.md) and [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit).
