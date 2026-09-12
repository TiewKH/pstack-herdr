### Perf issue

**You own the measurement story. Plan, review, verify the numbers.** When `HERDR_ENV=1`, delegated implementation uses [`../references/herdr-tools.md`](../references/herdr-tools.md) and `herdr-dispatch.ts`.

1. Capture a baseline trace on the matching surface.
2. Run `how` to ground hypotheses. Use elimination, divide-and-conquer, caching, indirection, batching, redundancy, lazy evaluation, and scheduling only when the trace shows the corresponding signal.
3. Plan the fix from the trace. If it crosses a function boundary, run `architect`. Delegate implementation and review the diff. Under Herdr dispatch role `implementation`, or `difficult-implementation` for concurrency/cross-cutting work, with an isolated writer `--cwd` where necessary and `--wait`. Outside Herdr use the configured perf-issue model through the native runtime. Capture the post-fix trace.
4. Parse and compare artifacts. Inconclusive or wrong-surface evidence is not a pass.
5. Cite the measurement in the PR.
6. Run **Opening a PR**.

For sustained iterative improvement use Hillclimb.

**Reply:** baseline, post-fix number, delta, artifact path.
