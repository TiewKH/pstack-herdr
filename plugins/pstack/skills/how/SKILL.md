---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
---

# How

On Codex, read the [platform mapping](../poteto-mode/references/codex-tools.md), including its per-skill notes, before following this skill. When `HERDR_ENV=1`, Herdr takes precedence for delegation: read [the Herdr execution mapping](../poteto-mode/references/herdr-tools.md) and launch every explorer/explainer through `scripts/herdr-dispatch.ts` with role `explorer`, rather than using the native Agent/Task/spawn_agent primitive.

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

## Step 1. Assess Complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. One explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers first, then hand off to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Spawn all explorers concurrently.

On Herdr, write each filled explorer prompt to a temporary file and launch concurrent `herdr-dispatch.ts --role explorer --name <unique-name> --prompt-file <file> --cwd "$PWD" --readonly --wait` processes. Start all dispatcher processes before waiting for any one result.

Outside Herdr use the native subagent configuration:

- `subagent_type`: `general-purpose`
- `model`: your configured how-explorer model (default in [Models](#models))
- `readonly`: `true`

Each explorer gets the prompt in `references/explorer-prompt.md` with its angle filled in. Then go to Step 3.

## Step 2b. Direct Explain (simple questions)

On Herdr, dispatch one read-only worker with role `explorer` and the filled explainer prompt. Outside Herdr spawn one Task subagent:

- `subagent_type`: `general-purpose`
- `model`: your configured how-explainer model (default in [Models](#models))
- `readonly`: `true`

Build its prompt from `references/explainer-prompt.md` without the explorer-findings section. Go to Step 4.

## Step 3. Synthesize (complex questions only)

Once all explorers have returned, build `references/explainer-prompt.md` with every explorer's findings filled in.

On Herdr, dispatch one read-only worker with role `judgment` and that prompt. Outside Herdr spawn one Task subagent:

- `subagent_type`: `general-purpose`
- `model`: your configured how-explainer model (default in [Models](#models))
- `readonly`: `true`

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output Format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.

## Models

Role defaults, stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`). A matching role line in `~/.claude/pstack-models.md` overrides each at runtime; see `/setup-pstack`.

- how explorer: `claude-opus-5`
- how explainer: `claude-opus-5`
