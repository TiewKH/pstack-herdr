---
name: setup-pstack
description: Configure which models and worker profiles pstack uses. In Herdr sessions, writes role/profile routing to ~/.config/pstack-herdr/routes.yaml; outside Herdr, writes the native Claude model override sheet. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Choose the setup path from the runtime first:

- If `HERDR_ENV=1`, follow **Herdr setup** below. Herdr-backed delegation does not read `~/.claude/pstack-models.md`; worker kind, account/config home, and model come from `~/.config/pstack-herdr/routes.yaml`.
- Otherwise follow **Native setup**. On Codex, read the [platform mapping](../poteto-mode/references/codex-tools.md), including its per-skill notes, before following the native steps.

Do not configure both layers unless the user explicitly wants native fallback behavior configured too.

## Herdr setup

Write `~/.config/pstack-herdr/routes.yaml`. This is the effective model-routing layer for delegated pstack work when `HERDR_ENV=1`.

A Herdr profile represents a worker runtime plus optional model and runtime-specific config home:

- Claude Code: `kind: claude`, with an optional `CLAUDE_CONFIG_DIR`.
- Codex: `kind: codex`, with an optional `CODEX_HOME`.
- `model: inherit` or `model: auto` means do not force a model flag.
- An explicit model slug is passed to that worker CLI with `--model`.

Multiple profiles may share the same config home. This is how one Claude or Codex subscription can run multiple workers or multiple model choices without inventing separate accounts.

### 1. Detect worker runtimes and models

Determine which worker CLIs are available for Herdr to launch: Claude Code, Codex, or both. Enumerate only model slugs that are confirmed usable by the corresponding CLI/session. Never write an explicit model slug that has not been confirmed.

If the user has additional authenticated CLI homes, ask for their paths. Do not copy, move, or inspect credential material. Treat each user-provided config home as an opaque authenticated profile.

If only one authenticated config home exists, that is sufficient for multiple concurrent workers; they share that provider account's concurrency, rate, and usage limits.

### 2. Load current Herdr state

If `~/.config/pstack-herdr/routes.yaml` exists, read it and treat its profiles, orchestration settings, and role pools as the current choices.

Otherwise start from the repository's `config/routes.example.yaml` shape:

```yaml
orchestration:
  max_depth: 3
  default_timeout_ms: 180000

profiles: {}
roles: {}
```

Preserve existing `orchestration` values unless the user asks to change them. Preserve profile `env` entries you do not own.

### 3. Define profiles

Create or reuse named profiles for each runtime/config-home/model combination the user wants available.

For example, one Claude subscription may expose two model-routing profiles that share the same config home:

```yaml
profiles:
  claude-strong:
    kind: claude
    model: <confirmed-strong-model>
    env:
      CLAUDE_CONFIG_DIR: ~/.claude

  claude-fast:
    kind: claude
    model: <confirmed-fast-model>
    env:
      CLAUDE_CONFIG_DIR: ~/.claude
```

Do not imply that separate profile names mean separate subscriptions. Separate subscriptions/accounts require independently authenticated config homes.

### 4. Map semantic Herdr roles

Configure all Herdr roles used by pstack:

- `explorer` — read-only investigation and reconnaissance.
- `implementation` — normal implementation work.
- `difficult-implementation` — harder algorithms, concurrency, or cross-cutting implementation.
- `judgment` — synthesis, trade-offs, and decision support.
- `reviewer` — independent review.
- `arena-candidate` — competing implementation/solution candidates.
- `arena-judge` — evaluation of Arena candidates.
- `verifier` — testing and validation.
- `subcoordinator` — delegated coordination that may spawn its own children.

Each role has a profile pool and a strategy:

- `first` — always choose the first profile.
- `spread` — deterministically distribute worker names across the pool.

Prefer capable/cheap profiles for `explorer` and `verifier`, stronger profiles for `difficult-implementation`, `judgment`, `arena-judge`, and `subcoordinator`, and diverse pools for `reviewer` and `arena-candidate` when more than one runtime/model is available. These are recommendations, not hard-coded model names.

A valid one-account shape is:

```yaml
roles:
  explorer:
    profiles: [claude-fast]
    strategy: first

  implementation:
    profiles: [claude-fast]
    strategy: first

  difficult-implementation:
    profiles: [claude-strong]
    strategy: first

  judgment:
    profiles: [claude-strong]
    strategy: first

  reviewer:
    profiles: [claude-strong, claude-fast]
    strategy: spread

  arena-candidate:
    profiles: [claude-strong, claude-fast]
    strategy: spread

  arena-judge:
    profiles: [claude-strong]
    strategy: first

  verifier:
    profiles: [claude-fast]
    strategy: first

  subcoordinator:
    profiles: [claude-strong]
    strategy: first
```

### 5. Validate the route file

Before writing, verify:

1. Every role pool references an existing profile.
2. Every profile kind is exactly `claude` or `codex`.
3. Every explicit model slug was confirmed available for that profile's runtime.
4. Every configured env name is a valid environment-variable name and every env value is a string.
5. `max_depth` and `default_timeout_ms`, if present, are non-negative integers.
6. Strategies are only `first` or `spread`.
7. All nine semantic roles above are present.

Overwrite the whole managed route file after validation so re-runs are idempotent, while carrying forward preserved orchestration values and unrelated profile env entries.

### 6. Confirm effective behavior

Tell the user:

- the route file path,
- which profiles share the same subscription/config home,
- which role maps to which profile pool,
- which profiles force a model and which inherit,
- and that these routes take effect for pstack delegation only while running inside Herdr.

If the user also wants native non-Herdr sessions configured, continue with **Native setup** after the Herdr route file is complete.

## Native setup

Write `~/.claude/pstack-models.md`, a per-role model override sheet you include from your global `CLAUDE.md`. Each pstack skill names a default model inline; the override sheet is the layer that adapts those defaults to the models you actually have access to.

Claude Code has no auto-applied "rules" mechanism like Cursor's `.mdc`. Inclusion is explicit: the user adds a line to `~/.claude/CLAUDE.md` (or their project `CLAUDE.md`) such as:

```text
@~/.claude/pstack-models.md
```

so the file is loaded as context for every session.

### 1. Detect available models

Enumerate the model slugs you can pass to an `Agent` subagent in this session — that is the dependable source. The currently available Claude models and the default panel are listed in [Models](#models) below; the panel is chosen for cross-family, cross-tier diversity, and the single-role default stays out of the panels because it already covers the single-model roles. Ask the user to confirm or paste any additional slugs they want available. Never write a real slug you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs; both mean the role runs on the parent session's model, which the `Agent` call expresses by omitting `model`.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If `~/.claude/pstack-models.md` already exists, read it and treat its values as the current choices. Otherwise start from those defaults.

### 3. Map and confirm

Show every role with its current model, marking any real slug not in the detected set as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` as the options. Prefer `AskUserQuestion` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real slug written must be in the detected set; `inherit-parent` and `auto` always pass. If a chosen real slug is not available, stop and ask again.

### 5. Write the override sheet

Write `~/.claude/pstack-models.md` with the shape below. Overwrite the whole file so re-runs stay idempotent.

```markdown
# pstack model configuration

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out.

feature, refactoring: claude-opus-5
bug-fix: claude-fable-5
perf-issue: claude-fable-5
hillclimb: claude-fable-5
judgment and prose: claude-opus-5
strongest judgment: claude-fable-5
how explorer: claude-opus-5
how explainer: claude-opus-5
why investigators: claude-opus-5
why synthesizer: claude-opus-5
reflect tooling: claude-opus-5
reflect judgment, divergent, synthesizer: claude-opus-5
arena runners: claude-opus-5, claude-fable-5, claude-sonnet-5
arena cross-judge pool: claude-opus-5, claude-fable-5, claude-sonnet-5
swarm workers: claude-opus-5
architect runners: claude-opus-5, claude-fable-5, claude-sonnet-5
interrogate reviewers: claude-opus-5, claude-fable-5, claude-sonnet-5
```

### 6. Wire it in

If `~/.claude/CLAUDE.md` does not already include `~/.claude/pstack-models.md`, append the `@~/.claude/pstack-models.md` line so it loads on every session. If the user prefers project scope, add the include to the project's `CLAUDE.md` instead.

### 7. Confirm

Tell the user where the override was written and how it loads (via the `@` include in CLAUDE.md). Re-running this skill updates the override sheet.

## Models

Stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`).

- Available Claude models: Opus 5 (`claude-opus-5`), Opus 4.8 (`claude-opus-4-8`), Opus 4.6 (`claude-opus-4-6`), Fable 5 (`claude-fable-5`), Sonnet 5 (`claude-sonnet-5`), Sonnet 4.6 (`claude-sonnet-4-6`), Haiku 4.5 (`claude-haiku-4-5`)
- Default panel: `claude-opus-5`, `claude-fable-5`, `claude-sonnet-5`
- Single-role default: `claude-opus-5`
