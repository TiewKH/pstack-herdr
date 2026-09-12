### Hillclimb

**You own the metric and experiment integrity. Supervise and review; delegate attempts.** When `HERDR_ENV=1`, every delegated attempt uses [`../references/herdr-tools.md`](../references/herdr-tools.md) and `herdr-dispatch.ts`.

Core discipline is one change, one measurement, keep or revert.

1. Ground the workload with `how`. Fix one metric, direction, and checkable stop predicate.
2. Build and freeze a sensitive measurement harness. Record baseline and a green regression gate.
3. Open a decision log with one row per attempt.
4. Ground every hypothesis in a specific mechanism.
5. Loop one hypothesis per iteration. Delegate the change with tight scope. Under Herdr dispatch role `implementation` with `--wait`; use `difficult-implementation` for subtle algorithmic/concurrency attempts. If several independent hypotheses are live, create a separate worktree for each and launch all dispatcher processes before waiting. Outside Herdr use the configured hillclimb model through the native runtime. Measure before/after and run the regression gate. Keep only changes beyond noise with a green gate; otherwise revert fully. Commit each accepted fix separately and log every verdict.
6. On a plateau, pivot hypothesis category rather than weakening the metric.
7. Stop only when the predicate is met or remaining ideas are not worth their cost.
8. Run **Opening a PR** with accepted commits in order.

If unattended, borrow the wake mechanism from Autonomous run. Under Herdr that watcher is also dispatcher-created.

**Reply:** metric and target, baseline to final delta, attempts kept/reverted, accepted fixes, decision-log path, and best next idea.
