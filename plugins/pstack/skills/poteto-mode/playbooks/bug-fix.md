### Bug fix

**You own this task. Plan, review, verify.** Delegate investigation and the fix, stay in the lead. When `HERDR_ENV=1`, every delegated child uses [`../references/herdr-tools.md`](../references/herdr-tools.md) and `herdr-dispatch.ts`; do not use native agent spawning for the same work.

Be scientific. Every shipped line traces to runtime evidence. The smallest change the evidence justifies ships.

1. Reproduce it yourself on the matching surface via the driver skill. Do not hand the repro to the user unless the available control surface genuinely cannot reach the target.
2. Binary-search the cause. Seed hypotheses with `how` and `why`, get runtime evidence, and eliminate until one mechanism survives. Under Herdr, those skills already route their explorers through the dispatcher.
3. Plan the fix. If it crosses a function boundary, run `architect` first. Delegate implementation with a tight scope and review the diff. Under Herdr, write the implementation brief to a file and dispatch role `implementation` (or `difficult-implementation` for concurrency, algorithms, or cross-cutting work), with the writer's isolated `--cwd` when another writer can overlap, and `--wait`. Outside Herdr use the configured bug-fix model through the host runtime's normal agent primitive.
4. Verify on the same surface. The original repro must pass. Inconclusive or wrong-surface evidence is not a pass.
5. Stage commits so the failing repro lands before the fix. Use the **tdd** skill when a cheap local failing test exists.
6. Run **Opening a PR**.

Investigation fans out `how` and `why`; under Herdr all of their descendants remain dispatcher-created.

**Reply:** what was broken, root cause, fix, and verification. Quote only the decisive failing and passing output.
