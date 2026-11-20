// pstack-herdr: the fork's Herdr lines, kept here so upstream's generator files
// carry only the two hooks that read them.
//
// LEAD is stamped like a runtime preamble under the first heading of every skill
// that herdr-tools.md's Per-skill notes table names, after the runtimes' own
// preambles. PLATFORM_SENTENCE joins poteto-mode's Platform Adaptation sentence
// after the runtime pointers.
import { SKILLS } from "./plugin.mjs";

const TRIGGER = "When `HERDR_ENV=1` or `HC_TERMINAL_ID` is set";

export const HERDR = {
  name: "Herdr",
  tools: `${SKILLS}/poteto-mode/references/herdr-tools.md`,
  notesHeader: "| Skill | On Herdr |",
  preamble:
    `${TRIGGER}, read the [Herdr execution mapping](../poteto-mode/references/herdr-tools.md), ` +
    "including its per-skill notes, before the first delegation.",
};

export const HERDR_PLATFORM_SENTENCE = `${TRIGGER}, read [\`references/herdr-tools.md\`](references/herdr-tools.md) before the first delegation.`;
