---
name: setup-pstack
description: Configure which models and worker profiles pstack uses. In Herdr sessions, writes role/profile routing to ~/.config/pstack-herdr/routes.yaml; outside Herdr, writes the current runtime's override sheet. Use for /setup-pstack, "configure pstack models", changing pstack's model choices, or turning the SessionStart hook on or off.
---

# Setup pstack

Choose the setup path from the runtime first:

- If `HERDR_ENV=1`, follow **Herdr setup** below. Herdr-backed delegation does not read `~/.claude/pstack-models.md`; worker kind, account/config home, and model come from `~/.config/pstack-herdr/routes.yaml`.
- Otherwise follow **Native setup**. On Codex, read the [platform mapping](../poteto-mode/references/codex-tools.md), including its per-skill notes, before following the native steps.

Do not configure both layers unless the user explicitly wants native fallback behavior configured too.

## Herdr setup

Herdr-backed delegation reads `~/.config/pstack-herdr/routes.yaml`. Do not hand-author that file. The deterministic writer is:

```bash
bun ../poteto-mode/scripts/configure-herdr.ts --input <setup.json>
```

The setup skill owns discovery and user choices. The script owns validation, canonical serialization, preservation rules, atomic writes, and idempotency.

### 1. Detect worker runtimes and models

Determine which worker CLIs are available for Herdr to launch: Claude Code, Codex, or both. Enumerate only model slugs confirmed usable by the corresponding CLI/session.

If the user has additional authenticated CLI homes, ask for their paths. Do not copy, move, or inspect credentials. Treat each config home as an opaque authenticated profile.

Multiple profiles may share the same config home. This is how one Claude or Codex subscription can provide multiple worker/model profiles; those workers share that account's concurrency, rate, and usage limits.

### 2. Load current state

If `~/.config/pstack-herdr/routes.yaml` already exists, read it and treat its profiles, roles, strategies, models, config homes, extra env, and orchestration as the current choices. Do not rewrite it by hand; reading is the load step. If the file is missing or empty, start from the detected runtimes and the example shape in step 4. If the file exists but does not parse, stop and show the error instead of guessing.

When reconstructing setup JSON from an existing file, set each profile's `config_home` from `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, and keep any other `env` entries. Leave `config_home` out for the CLI's default home (`~/.claude`, `~/.codex`). Claude Code keeps its onboarding state under `$CLAUDE_CONFIG_DIR`, so a worker given the default home boots into first-run onboarding; the dispatcher ignores such a value at run time. Omit `orchestration` from the JSON unless the user is changing it, so the writer preserves the current values.

### 3. Map and confirm

Show every profile (name, kind, model, effort, config home, extra env) and every role with its current profile pool and strategy. Call out which profiles share a subscription/config home. Mark any model not in the detected set as needing a choice.

Ask whether to accept as-is or change specific profiles or roles. Prefer `AskUserQuestion` over free text.

Collect profiles with:

- a stable profile `name`,
- `kind`: `claude` or `codex`,
- optional `model` (use `inherit` when no model should be forced),
- optional `effort`, a reasoning-effort override passed straight to the worker CLI: `claude --effort <level>` (`low`, `medium`, `high`, `xhigh`, `max`) or `codex -c model_reasoning_effort="<level>"` (`minimal`, `low`, `medium`, `high`, `xhigh`). Leave unset to run the CLI's own default. Effort is a separate axis from model — offer it as its own question rather than folding it into the model choice,
- optional `config_home`,
- optional extra `env` entries.

Collect all nine required semantic roles:

- `explorer`
- `implementation`
- `difficult-implementation`
- `judgment`
- `reviewer`
- `arena-candidate`
- `arena-judge`
- `verifier`
- `subcoordinator`

Each role has a non-empty `profiles` array and `strategy` of `first` or `spread`.

Prefer capable/cheap profiles for `explorer` and `verifier`, stronger profiles for `difficult-implementation`, `judgment`, `arena-judge`, and `subcoordinator`, and diverse pools for `reviewer` and `arena-candidate` when more than one runtime/model is available.

### 4. Write the setup input JSON

Create a temporary JSON file shaped exactly like this (a committed copy lives at `config/setup.example.json`):

```json
{
  "profiles": [
    {
      "name": "claude-strong",
      "kind": "claude",
      "model": "<confirmed-strong-model>",
      "effort": "high"
    },
    {
      "name": "claude-fast",
      "kind": "claude",
      "model": "<confirmed-fast-model>"
    }
  ],
  "roles": {
    "explorer": { "profiles": ["claude-fast"], "strategy": "first" },
    "implementation": { "profiles": ["claude-fast"], "strategy": "first" },
    "difficult-implementation": { "profiles": ["claude-strong"], "strategy": "first" },
    "judgment": { "profiles": ["claude-strong"], "strategy": "first" },
    "reviewer": { "profiles": ["claude-strong", "claude-fast"], "strategy": "spread" },
    "arena-candidate": { "profiles": ["claude-strong", "claude-fast"], "strategy": "spread" },
    "arena-judge": { "profiles": ["claude-strong"], "strategy": "first" },
    "verifier": { "profiles": ["claude-fast"], "strategy": "first" },
    "subcoordinator": { "profiles": ["claude-strong"], "strategy": "first" }
  }
}
```

Only include `orchestration` when the user explicitly changes it:

```json
{
  "orchestration": {
    "max_depth": 3,
    "default_timeout_ms": 180000
  }
}
```

Do not write YAML yourself.

### 5. Preview, then apply

Preview the exact canonical YAML first:

```bash
bun ../poteto-mode/scripts/configure-herdr.ts \
  --input <setup.json> \
  --dry-run
```

Then apply it:

```bash
bun ../poteto-mode/scripts/configure-herdr.ts \
  --input <setup.json>
```

The script deterministically:

1. validates profile names, kinds, env keys, strategies, and all nine required roles;
2. rejects role references to unknown profiles;
3. preserves existing `orchestration` values unless the JSON explicitly changes them;
4. preserves unrelated existing `env` entries on reused profile names while replacing the runtime config-home variable;
5. writes profiles in sorted order and roles in canonical semantic-role order;
6. writes `~/.config/pstack-herdr/routes.yaml` atomically;
7. returns `unchanged` when the same input produces the same bytes.

The same subscription/config home may appear on several profiles. Separate subscriptions/accounts require separately authenticated config homes.

### 6. Confirm effective behavior

Tell the user:

- the route file path,
- which profiles share the same subscription/config home,
- which role maps to which profile pool,
- which profiles force a model and which inherit,
- which profiles set an effort override and which run the CLI's own default,
- and that the routes take effect for pstack delegation while running inside Herdr.

If the user also wants native non-Herdr sessions configured, continue with **Native setup**.

## Native setup

On another runtime, read [Other runtimes](#other-runtimes) below for where the sheet lives and how it loads; the steps are the same.

Write the current runtime's per-role model override sheet, using the path in [Other runtimes](#other-runtimes). Each pstack skill names a default model inline; the override sheet adapts those defaults to the models you actually have access to.

Claude Code has no auto-applied "rules" mechanism like Cursor's `.mdc`. Inclusion is explicit: the user adds a line to `~/.claude/CLAUDE.md` (or their project `CLAUDE.md`) such as:

```text
@~/.claude/pstack-models.md
```

so the file is loaded as context for every session.

### 1. Detect available models

Enumerate the model names the `Agent` tool's `model` parameter accepts in this session. That is the dependable source. On Claude Code they are the family names listed in [Models](#models) below, each running that family's current model, and a full model ID is rejected. The default panel is listed there too. The panel is chosen for cross-family diversity. Ask the user to confirm or paste any additional slugs they want available. Never write a real slug you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs. Both mean the role runs on the parent session's model, which the `Agent` call expresses by omitting `model`.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in the Write the override sheet step below. If the current runtime's sheet already exists, read it and treat its values as the current choices. Otherwise start from those defaults. A line whose role is not in that shape, such as `how critics`, is from a retired role. Drop it. An older sheet may name full model IDs that start with `claude-`, which the `Agent` tool rejects. Replace each with its family name, the word after `claude-`.

### 3. Map and confirm

Show every role with its current model, marking any real slug not in the detected set as needing a choice. Also list each line step 2 dropped or rewrote. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` as the options. Prefer `AskUserQuestion` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Choose whether the session hook routes tasks

On Claude Code and Codex, the plugin's `SessionStart` hook injects the poteto-mode mandate on startup, resume, clear, and compact. Codex asks the user to trust plugin hooks through `/hooks` before running them. Ask whether to keep the hook. The default is on. The answer is the `session hook` line in the current runtime's sheet: `on` or `off`. With no sheet or no line, the hook injects. The line is inert on other runtimes.

### 5. Validate

Every real slug written must be in the detected set. `inherit-parent` and `auto` always pass. If a chosen real slug is not available, stop and ask again.

### 6. Write the override sheet

Write the current runtime's sheet with the shape below. Overwrite the whole file so re-runs stay idempotent.

```markdown
# pstack model configuration

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. `session hook: off` stops the Claude Code or Codex SessionStart hook from injecting the poteto-mode mandate; any other value, or no line, leaves it on.

feature, refactoring: opus
bug-fix: fable
perf-issue: fable
hillclimb: fable
judgment and prose: opus
strongest judgment: fable
how explorer: opus
how explainer: opus
why investigators: opus
why synthesizer: opus
reflect tooling: opus
reflect judgment, divergent, synthesizer: opus
arena runners: opus, fable, sonnet
arena cross-judge pool: opus, fable, sonnet
swarm workers: opus
architect runners: opus, fable, sonnet
interrogate reviewers: opus, fable, sonnet

session hook: on
```

### 7. Wire it in

On Claude Code, if `~/.claude/CLAUDE.md` does not already include `~/.claude/pstack-models.md`, append the `@~/.claude/pstack-models.md` line so the model rows load on every session. If the user prefers project scope, add the include to the project's `CLAUDE.md` instead.

On Codex, paste the model rows into `~/.codex/AGENTS.md`; Codex has no `@` include. Do not paste the `session hook` line there: the plugin hook reads it directly from `~/.codex/pstack-models.md`.

### 8. Confirm

Tell the user where the override was written, how its model rows load, and whether the plugin hook is on. Re-running this skill updates the override sheet.

## Other runtimes

The role lines are the same everywhere. What differs is the sheet path, how the runtime loads it, and how you list models. Detect models with the runtime's own tool and never write a slug you have not seen listed. A runtime whose subagent call has no model parameter still gets the sheet, as the record of the user's choice, and applies it where it can. The `session hook` line applies to the Claude Code and Codex plugins.

| Runtime | Sheet | Load | List models | Status |
| --- | --- | --- | --- | --- |
| Claude Code | `~/.claude/pstack-models.md` | `@~/.claude/pstack-models.md` in `~/.claude/CLAUDE.md` | the `Agent` tool's model parameter | verified live |
| Codex | `~/.codex/pstack-models.md` | model rows: paste into `~/.codex/AGENTS.md`; hook setting: read by the plugin | your configured Codex models, see [codex-tools.md](../poteto-mode/references/codex-tools.md#model-names) | hook contract tested; discovery verified |
| opencode | `~/.config/opencode/pstack-models.md` | add the path to the `instructions` array in `opencode.json` | the `models` slash command in the session | from published docs, no live session |
| Gemini CLI | `~/.gemini/pstack-models.md` | `@~/.gemini/pstack-models.md` in `~/.gemini/GEMINI.md` | the `model` slash command in the session | from published docs, no live session |
| Prime Agent | no documented sheet path; Prime's configuration chooses models | | | no live session |

## Models

Stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`).

- Available Claude models: `opus`, `fable`, `sonnet`, `haiku`
- Default panel: `opus`, `fable`, `sonnet`
- Single-role default: `opus`
