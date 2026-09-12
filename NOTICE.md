# NOTICE

This repository is a fork of `michael-denyer/pstack-claude`, which ports upstream MIT-licensed pstack work to Claude Code and Codex. All upstream copyright notices and license terms are preserved.

## Project lineage

- **pstack** — original engineering workflows and Poteto Mode by Lauren Tan (poteto), published in `cursor/plugins/pstack`, MIT License.
- **pstack-claude** — Claude Code/Codex portability work authored and maintained by Michael Denyer. `pstack-herdr` is forked from this project.
- **cursor-team-kit components** — selected imported skills copyright (c) 2026 Cursor, MIT License.
- **Herdr** — external terminal/agent runtime and official Agent Skill maintained by herdrdev, Apache License 2.0.

`pstack-herdr` is an independent fork. It is not an official project of Lauren Tan, Michael Denyer, Cursor, Anthropic, OpenAI, or herdrdev.

## Herdr attribution

The Herdr execution support in this fork integrates with the external Herdr project and its official Agent Skill:

- Project: Herdr
- Maintainer/organization: herdrdev
- Upstream: https://github.com/herdrdev/herdr
- Official skill used as the runtime authority: `skills/herdr/SKILL.md`
- License: Apache License 2.0

Herdr is not vendored into this repository. Users install Herdr and its official skill separately. This fork adds pstack-specific instructions that call the installed Herdr runtime. Existing pstack, pstack-claude, and cursor-team-kit material remains governed by the repository's preserved license and notice files.

## Upstream sources

| Component | Upstream | Copyright | License | License file |
| --- | --- | --- | --- | --- |
| `plugins/pstack/skills/poteto-mode/`, `plugins/pstack/skills/architect/`, `plugins/pstack/skills/arena/`, `plugins/pstack/skills/automate-me/`, `plugins/pstack/skills/figure-it-out/`, `plugins/pstack/skills/how/`, `plugins/pstack/skills/interrogate/`, `plugins/pstack/skills/reflect/`, `plugins/pstack/skills/show-me-your-work/`, `plugins/pstack/skills/tdd/`, `plugins/pstack/skills/typescript-best-practices/`, `plugins/pstack/skills/unslop/`, `plugins/pstack/skills/why/`, `plugins/pstack/skills/principle-*/`, `plugins/pstack/agents/poteto-agent.md` | [cursor/plugins/pstack @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |
| `plugins/pstack/skills/deslop/` | [cursor/plugins/cursor-team-kit/skills/deslop @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/deslop) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/thermo-nuclear-code-quality-review/` | [cursor/plugins/cursor-team-kit/skills/thermo-nuclear-code-quality-review @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/thermo-nuclear-code-quality-review) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/make-pr-easy-to-review/` | [cursor/plugins/cursor-team-kit/skills/make-pr-easy-to-review @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/make-pr-easy-to-review) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/fix-ci/` | [cursor/plugins/cursor-team-kit/skills/fix-ci @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/fix-ci) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/fix-merge-conflicts/` | [cursor/plugins/cursor-team-kit/skills/fix-merge-conflicts @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/fix-merge-conflicts) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/get-pr-comments/` | [cursor/plugins/cursor-team-kit/skills/get-pr-comments @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/get-pr-comments) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/what-did-i-get-done/` | [cursor/plugins/cursor-team-kit/skills/what-did-i-get-done @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/what-did-i-get-done) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/teach/`, `plugins/pstack/skills/principle-model-the-domain/`, `plugins/pstack/skills/create-verification-skill/`, `plugins/pstack/skills/maintain-verification-skill/` (v0.11.3 additions) | [cursor/plugins/pstack @ 3fe2823](https://github.com/cursor/plugins/tree/3fe2823ce17c1656c222d4b7c59d3f82fbf20143/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |
| `plugins/pstack/skills/{swarm,no-comments,technical-writing,bro}/`, `plugins/pstack/agents/comment-sicko.md`, `plugins/pstack/skills/poteto-mode/playbooks/{babysit,shipping,orchestrate,autopilot-full,autopilot-stack,worktree-cleanup}.md`, `plugins/pstack/skills/poteto-mode/references/bugbot-triage.md`, `plugins/pstack/skills/poteto-mode/scripts/`, `plugins/pstack/skills/architect/references/design-red-flags.md`, `plugins/pstack/skills/create-verification-skill/references/feature-map-example/` (v0.14.2 additions) | [cursor/plugins/pstack @ 4612556](https://github.com/cursor/plugins/tree/4612556/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |
| `plugins/pstack/skills/poteto-mode/playbooks/multi-phase-plan.md`, `plugins/pstack/skills/poteto-mode/scripts/check-plan.mjs` (v0.14.8 additions) | [cursor/plugins/pstack @ 7314f72](https://github.com/cursor/plugins/tree/7314f72/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |
| `plugins/pstack/skills/principle-attack-the-premise/`, `plugins/pstack/skills/principle-test-behavior-not-implementation/` (post-v0.14.8 additions) | [cursor/plugins/pstack @ e8d856f](https://github.com/cursor/plugins/tree/e8d856f/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |

## What changed in the pstack-claude port

The pstack-claude port is editorial, not mechanical. See [CHANGES.md](CHANGES.md) for the full per-skill audit of substitutions applied by that port.

Summary of structural changes inherited by this fork:

- Plugin content lives at `plugins/pstack/` (with its own `.claude-plugin/plugin.json`). The repo root holds `.claude-plugin/marketplace.json` and the LICENSE / NOTICE / README / CHANGES docs.
- `.claude-plugin/marketplace.json` makes the repo installable via `/plugin marketplace add`.
- `plugins/pstack/.codex-plugin/prompts/<name>.md` stubs make public skills reachable as slash commands on Codex.
- Seven skills are imported from `cursor-team-kit`: `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, `what-did-i-get-done`.
- `plugins/pstack/skills/babysit/` is independently authored as the Claude Code analog of Cursor's `/babysit` built-in.
- `plugins/pstack/skills/poteto-mode/scripts/` is vendored from upstream with the pstack-claude port edits documented in CHANGES.md.
- `plugins/pstack/agents/comment-sicko.md` is upstream's `Comment Sicko` agent, renamed to `comment-sicko` for Claude Code compatibility.
- The Codex build shares the same `skills/` tree and uses `plugins/pstack/skills/poteto-mode/references/codex-tools.md` for Claude-to-Codex mappings.

## pstack-herdr modifications

This fork adds Herdr as an execution transport while preserving the pstack playbook and principle tree. Herdr-specific authored files include:

- `plugins/pstack/skills/herdr-runtime/SKILL.md`
- `plugins/pstack/skills/herdr-runtime/references/routes.example.yaml`
- `config/routes.example.yaml`
- `tests/herdr-runtime.test.mjs`
- Herdr activation additions to `plugins/pstack/hooks/session-start-context.md`
- Herdr runtime documentation and attribution in `README.md` and this file

Per the MIT license, modifications to pstack-derived material are permitted. Existing upstream copyright notices in source files, where present, are preserved.

## Port-authored files inherited from pstack-claude

- `plugins/pstack/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugins/pstack/.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`
- `plugins/pstack/skills/poteto-mode/references/codex-tools.md`
- `plugins/pstack/.codex-plugin/prompts/*.md`
- `plugins/pstack/skills/babysit/SKILL.md`
- `plugins/pstack/hooks/hooks.json` and the original session-start mandate
- `NOTICE.md`
- `NOTICE-skills.md`
- `README.md`
- `CHANGES.md`

`LICENSE-cursor-team-kit` is copied verbatim from upstream cursor-team-kit rather than authored for this port.
