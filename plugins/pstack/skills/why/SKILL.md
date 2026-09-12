---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior."
---

# Why

On Codex, read the [platform mapping](../poteto-mode/references/codex-tools.md), including its per-skill notes, before following this skill. When `HERDR_ENV=1`, read [`../poteto-mode/references/herdr-tools.md`](../poteto-mode/references/herdr-tools.md) before the first delegation and use the native dispatcher for every investigator and synthesizer.

Investigate the motivation and intent behind code. `how` answers what the code does. `why` answers what forces led to its shape.

## Operating posture

Operate as a careful and precise investigator. Be explicit about observation versus inference. Read `references/epistemics.md`; the synthesizer must follow it.

## Step 1. Understand the target

Parse the target and question. If the target is vague, infer it from the current work, state the interpretation briefly, and proceed.

## Step 2. Establish the code anchor

Before delegation, collect relevant paths and line ranges, symbols, recent commits, merge PRs, and linked ticket IDs. Use `git blame`, `git log --follow`, and `gh pr view` where appropriate. Pass this anchor to every investigator.

## Step 3. Spawn parallel investigators

Default to the full parallel investigation. Discover available MCPs and map each to one evidence category:

1. Source control history.
2. Issue or ticket tracker.
3. Long-form documents.
4. Real-time team chat.
5. Infrastructure observability.
6. Error or exception tracking.
7. Product analytics warehouse.

Source control is always available through git and `gh`. Aim for a complete coverage map. Document null results rather than silently skipping a category.

Each investigator gets the base prompt from `references/investigator-prompt.md`, the matching source playbook under `references/sources/`, the incident-postmortem playbook when the target looks defensive, the code anchor, and the user's original question. Investigators are read-only in intent but need full tool/MCP access.

When `HERDR_ENV=1`, launch one dispatcher process per available category before waiting so the searches remain parallel. Use semantic role `explorer`, a unique name such as `why-source-control`, `--readonly`, and `--wait`. The prompt must identify the exact evidence category and available MCP/tool it owns. Do not use native `Agent`, `Task`, or Codex `spawn_agent` for these children while Herdr is active. Outside Herdr, retain the runtime's normal general-purpose subagent behavior and the configured why-investigators model.

Only skip a category when no matching MCP exists or it is provably irrelevant. Record the reason in Sources Consulted.

## Step 4. Synthesize

After all investigator results settle, create one synthesizer. It receives all findings including nulls and skips, the code anchor, original question, `references/epistemics.md`, and `references/synthesizer-prompt.md`.

When `HERDR_ENV=1`, dispatch it through `herdr-dispatch.ts` with role `judgment`, a unique name such as `why-synthesizer`, `--readonly`, and `--wait`. The parent remains responsible for checking its citations and confidence language. Outside Herdr, use the runtime's normal general-purpose subagent with the configured why-synthesizer model.

## Step 5. Present

Present the synthesizer output, lightly editing only for clarity. Do not rewrite its confidence language. Preserve the structure from `references/synthesizer-prompt.md`: The Question, The Code in Question, What We Found, What We Can Reasonably Infer, Competing Hypotheses, What We Don't Know, Sources Consulted, Confidence Summary.

If the investigation precedes a change, turn the lineage findings into Preserve / Change / Avoid / Risk constraints for planning.

## Common failure modes

- Recency bias. The latest commit is not automatically the original rationale.
- Missing-source optimism. No result from one category is evidence about coverage, not proof no rationale exists.
- Native-agent leakage under Herdr. Every investigator and synthesizer must use the dispatcher when `HERDR_ENV=1`.

## Reference files

- `references/epistemics.md` for confidence tiers.
- `references/investigator-prompt.md` for investigator briefs.
- `references/source-playbook.md` and `references/sources/*.md` for category-specific searches.
- `references/synthesizer-prompt.md` for synthesis and output shape.

## Models

Role defaults, stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`). A matching role line in `~/.claude/pstack-models.md` overrides each at runtime; see `/setup-pstack`.

- why investigators: `claude-opus-5`
- why synthesizer: `claude-opus-5`
