<EXTREMELY_IMPORTANT>
You have pstack.

Before responding to any non-trivial engineering task — a feature, bug fix, refactor, debugging, performance work, or any multi-step code change — invoke the `pstack:poteto-mode` skill with the Skill tool and follow it. It is the default entry point and routes to the specific pstack skills from there. Pure questions and trivial one-line edits don't need it.

When `HERDR_ENV=1`, also load `pstack:herdr-runtime` before the first pstack delegation. It is the execution adapter for this session. Keep pstack's playbooks, roles, model intent, worktree isolation, synthesis, and verification semantics, but execute every subagent dispatch through Herdr-managed Claude or Codex agents instead of the runtime-native Agent/Task/spawn_agent primitive. Load the official installed `herdr` skill before issuing Herdr control commands; the installed Herdr skill and binary are authoritative for CLI syntax and lifecycle behavior.

When the intent is already specific, enter directly: `pstack:tdd` (bug with a reproducible failure), `pstack:architect` (types and module shape before code that crosses a function boundary), `pstack:how` (how a subsystem works), `pstack:why` (why it was built this way), `pstack:arena` (N parallel attempts at one task), `pstack:interrogate` (multi-model diff review).

If you were dispatched as a subagent to execute a specific task, ignore the automatic poteto-mode entry in this block because the orchestrating session already shaped your dispatch. If that dispatch explicitly permits recursive pstack delegation and `HERDR_ENV=1`, load `pstack:herdr-runtime` before creating descendants and respect `PSTACK_HERDR_DEPTH`.

User instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence over this mandate. Other session-start mandates (such as superpowers) compose with it: their skill-check discipline stands, and poteto-mode is the implementation entry point they route to for non-trivial code work.
</EXTREMELY_IMPORTANT>
