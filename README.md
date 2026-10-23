# pstack-herdr

[pstack](https://github.com/cursor/plugins/tree/main/pstack) for Claude Code and Codex, with delegated agents running as visible [Herdr](https://github.com/herdrdev/herdr) panes.

This is a fork of [`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude), the Claude Code, Codex, Pi, GitHub Copilot, and Muse port of Lauren Tan's pstack. It has 65 Agent Skills: 41 public skills and 24 `principle-*` leaves. The skill tree is synced against upstream `7b353f7` from `cursor/plugins/pstack`.

Inside Herdr (`HERDR_ENV=1`), workflows that delegate start real Claude Code or Codex workers in Herdr panes, routed by role. You can watch and answer each worker. Outside Herdr, the plugin behaves like pstack-claude.

For concurrency bugs and invariants that tests cannot reach, `/create-formal-verification-skill` picks the riskiest property in your code, verifies it with a tool that fits, and leaves a project skill the next agent reruns. The separate [agent-formal-verify](https://github.com/michael-denyer/agent-formal-verify) plugin goes deeper on the method, with guided TLA+ model checking, Lean proofs, and Kani for Rust.

## Install

### Claude Code

Run in Claude Code 2.1.292 or later:

```text
/plugin marketplace add TiewKH/pstack-herdr
/plugin install pstack@pstack-claude
```

### Codex

```shell
codex plugin marketplace add TiewKH/pstack-herdr
codex plugin add pstack@pstack-claude
```

### Pi

Run in your terminal:

```shell
pi install git:github.com/TiewKH/pstack-herdr
```

The package loads the skills and the pstack Pi extension, which adds the subagent, question, and wake-up tools the skills use, plus `/loop` and the routing instruction. Invoke a skill with `/skill:<name>`. Herdr delegation is verified from Claude Code and Codex coordinators only.

### GitHub Copilot

Run in your terminal:

```shell
copilot plugin marketplace add TiewKH/pstack-herdr
copilot plugin install pstack@pstack-claude
```

This installs pstack for the Copilot CLI and the GitHub Copilot app, which share `~/.copilot`. Start a new session afterwards. Copilot ships no default pstack models, so the first skill that needs one runs `setup-pstack` to pick from the models your account lists, and later sessions reuse that choice. Herdr delegation is verified from Claude Code and Codex coordinators only.

The Copilot build is tested on Copilot CLI 1.0.87 through 1.0.92. On those versions the routing hook's context reaches the session alongside other plugins' session-start context. If a later version keeps only one plugin's context, `setup-pstack` offers a [standing instruction](plugins/pstack/skills/setup-pstack/copilot.md#wire-it-in) for `~/.copilot/copilot-instructions.md` instead. On 1.0.92, once the CLI caches its computer-use experiment assignment, `copilot -p` sessions list no plugin skills and a `skill` call returns "Skill not found". Interactive sessions, the hooks, and the agents are unaffected.

### Muse

Run in your terminal:

```shell
git clone https://github.com/TiewKH/pstack-herdr
cd pstack-herdr
muse plugins install ./plugins/pstack
muse plugins approve pstack
```

The first command installs the native Muse plugin bundle. The second approves its `SessionStart` hook and agent definitions, which Muse runs only after approval. Start a new session afterwards. Invoke a skill with `/<name>` (for example `/poteto-mode`), which Muse lists for each user-invocable skill. Herdr delegation is verified from Claude Code and Codex coordinators only.

### Other harnesses

OpenCode (the CLI and the desktop app), Gemini CLI, Prime Agent, and skills-only Codex installs read skills from `~/.agents/skills/`. Run in your terminal:

```shell
git clone https://github.com/TiewKH/pstack-herdr
cd pstack-herdr
mkdir -p ~/.agents/skills
for s in plugins/pstack/skills/*/; do
  target=~/.agents/skills/"$(basename "$s")"
  test -e "$target" || test -L "$target" || ln -s "$(pwd)/$s" "$target"
done
```

To update, run `git pull` in the clone, then run the `for` loop again to link skills added since the last run. These installs have no routing hook, so ask for `poteto-mode` by name or add a standing instruction to the harness's instruction file. See [shared installation](docs/reference.md#shared-skills-installation) for per-harness notes and uninstalling.

### Configure

pstack routes tasks to `poteto-mode` automatically. At session start, a hook injects an instruction that points the agent at it: the plugin's hook on Claude Code, Codex, GitHub Copilot, and Muse, and the pstack extension on Pi. Codex runs the hook only after you trust it through `/hooks`, and Muse only after `muse plugins approve pstack`. Other harnesses have no hook.

Run `setup-pstack` to turn automatic routing on or off, change model defaults, or set a reasoning effort per role (`arena runners: opus @xhigh, fable @max`). In Claude Code and the Copilot CLI, use `/pstack:setup-pstack`.

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
| [`herdr/dispatch.ts`](plugins/pstack/skills/poteto-mode/scripts/herdr/dispatch.ts) | pane creation, profile environment, CLI startup, prompt delivery, waiting, output reads, pane cleanup, delegation depth |
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

## Data handling

pstack has no server or telemetry. Anything its skills ask your agent to read, including session transcripts, goes to your model provider. Scripts run locally, and PR tools use your GitHub CLI login. Herdr workers run as local Claude Code or Codex processes under the profiles you configure.

## Attribution

- pstack and Poteto Mode by Lauren Tan ([poteto](https://github.com/poteto)), MIT.
- pstack-claude, the Claude Code, Codex, Pi, GitHub Copilot, and Muse port, by [Michael Denyer](https://github.com/michael-denyer).
- Imported cursor-team-kit and thermos skills by Cursor, MIT.
- Herdr by [herdrdev](https://github.com/herdrdev/herdr), Apache-2.0. It is an external runtime, not vendored or relicensed here.

This fork's changes are also [MIT-licensed](LICENSE). See [NOTICE.md](NOTICE.md), [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit), and [LICENSE-thermos](LICENSE-thermos).

To support maintenance of the upstream port, [buy its maintainer a coffee](https://buymeacoffee.com/codenyer).
