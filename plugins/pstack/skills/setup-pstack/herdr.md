# Herdr setup

This file replaces the steps of [setup-pstack](SKILL.md) inside Herdr (`HERDR_ENV=1` or `HC_TERMINAL_ID`).

Herdr-backed delegation reads `~/.config/pstack-herdr/routes.yaml`. Do not hand-author that file. The deterministic writer is:

```bash
bun ../poteto-mode/scripts/herdr/configure.ts --input <setup.json>
```

The setup skill owns discovery and user choices. The script owns validation, canonical serialization, preservation rules, atomic writes, and idempotency.

## 1. Detect worker runtimes and models

Determine which worker CLIs are available for Herdr to launch: Claude Code, Codex, or both. Offer the Herdr worker IDs in [Models](SKILL.md#models) as the menu for each CLI, and keep only the ones that CLI accepts: `claude -p --model <id> "Reply with exactly OK"` and `codex exec -m <id> "Reply with exactly OK"` each answer `OK` for a usable ID. The menu is a starting point, not a limit: also offer any newer ID the CLI knows. For Codex, `codex debug models` lists every model with `visibility: list`. For Claude, try the next version up from each family's newest menu ID; an ID the installed Claude Code does not know fails with `isn't described by this version's model catalog`. Run the same `OK` check on each before writing it. Write full IDs into profiles. The worker CLI runs a full ID as that exact version, while a family name runs whichever model is current in that family, so a family name moves when a new model ships.

If the user has additional authenticated CLI homes, ask for their paths. Do not copy, move, or inspect credentials. Treat each config home as an opaque authenticated profile.

Multiple profiles may share the same config home. This is how one Claude or Codex subscription can provide multiple worker/model profiles; those workers share that account's concurrency, rate, and usage limits.

## 2. Load current state

If `~/.config/pstack-herdr/routes.yaml` already exists, read it and treat its profiles, roles, strategies, models, config homes, extra env, and orchestration as the current choices. Do not rewrite it by hand; reading is the load step. If the file is missing or empty, start from the detected runtimes and the example shape in step 4. If the file exists but does not parse, stop and show the error instead of guessing.

When reconstructing setup JSON from an existing file, set each profile's `config_home` from `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, and keep any other `env` entries. Leave `config_home` out for the CLI's default home (`~/.claude`, `~/.codex`). Claude Code keeps its onboarding state under `$CLAUDE_CONFIG_DIR`, so a worker given the default home boots into first-run onboarding; the dispatcher ignores such a value at run time. Omit `orchestration` from the JSON unless the user is changing it, so the writer preserves the current values.

## 3. Map and confirm

Show every profile (name, kind, model, effort, config home, extra env) and every role with its current profile pool and strategy. Call out which profiles share a subscription/config home. Mark any model not in the detected set as needing a choice.

Ask whether to accept as-is or change specific profiles or roles. Prefer `AskUserQuestion` over free text.

Collect profiles with:

- a stable profile `name`,
- `kind`: `claude` or `codex`,
- optional `model` (use `inherit` when no model should be forced),
- optional `effort`, a reasoning-effort override passed straight to the worker CLI: `claude --effort <level>` (`low`, `medium`, `high`, `xhigh`, `max`) or `codex -c model_reasoning_effort="<level>"` (`low`, `medium`, `high`, `xhigh`, `max`, `ultra`; which ones a model takes is in `codex debug models`). Leave unset to run the CLI's own default. Effort is a separate axis from model — offer it as its own question rather than folding it into the model choice,
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

A worker that delegates reaches Herdr over a local socket, and Codex's `workspace-write` sandbox blocks that socket while its network is off. A Codex profile routed to `subcoordinator` therefore needs `network_access = true` under `[sandbox_workspace_write]` in that profile's `$CODEX_HOME/config.toml`. The setting loosens every session that uses that Codex home, not only subcoordinators. When the user routes `subcoordinator` to a Codex profile, say so and ask whether that home has the setting. Do not edit Codex's config yourself. Offer a Claude profile for the role as the alternative. Claude Code does not sandbox its shell by default.

## 4. Write the setup input JSON

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

## 5. Preview, then apply

Preview the exact canonical YAML first:

```bash
bun ../poteto-mode/scripts/herdr/configure.ts \
  --input <setup.json> \
  --dry-run
```

Then apply it:

```bash
bun ../poteto-mode/scripts/herdr/configure.ts \
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

## 6. Confirm effective behavior

Tell the user:

- the route file path,
- which profiles share the same subscription/config home,
- which role maps to which profile pool,
- which profiles force a model and which inherit,
- which profiles set an effort override and which run the CLI's own default,
- and that the routes take effect for pstack delegation while running inside Herdr.

If the user also wants native non-Herdr sessions configured, continue with the steps in [setup-pstack](SKILL.md).
