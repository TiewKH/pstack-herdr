### Refactoring

Resolve the driver skill through [poteto-mode's Non-negotiables](../SKILL.md#non-negotiables). When `HERDR_ENV=1`, delegated edits use [`../references/herdr-tools.md`](../references/herdr-tools.md) and `herdr-dispatch.ts`.

**You own the contract. The structure changes; behavior does not.**

1. Pin behavior first. Run `how`, then write a characterization test, snapshot, or equivalence harness before structure moves.
2. Name the missing structure per **principle-model-the-domain**.
3. State the target module, type, and call shape. If it crosses a function boundary, run `architect` first.
4. Subtract before adding. Delete dead code and redundant layers before introducing the target shape.
5. Move in small behavior-preserving steps. Migrate callers and delete legacy APIs in the same wave. Delegate mechanical edits with exact paths, names, and the behavior pin. Under Herdr, dispatch role `implementation` with the writer's `--cwd` and `--wait`; use `difficult-implementation` only when the reshape is genuinely cross-cutting or subtle. Concurrent writers require separate worktrees. Outside Herdr use the configured refactoring model through the native runtime.
6. Prove behavior is unchanged on the real artifact. Own the equivalence check yourself.
7. Keep the change only if it reduces reader load.
8. Shape small ordered commits, keeping the behavior pin green, then run **Opening a PR**.

**Reply:** structure changed, behavior pin, equivalence proof, reader-load delta, shipped and reverted work. No new behavior.
