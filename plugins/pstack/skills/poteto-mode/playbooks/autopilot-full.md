### Autopilot-full

Resolve the driver skill through [poteto-mode's Non-negotiables](../SKILL.md#non-negotiables). When `HERDR_ENV=1`, read [`../references/herdr-tools.md`](../references/herdr-tools.md); every owner, replacement, verifier, and delegated audit worker uses `herdr-dispatch.ts`.

**You own verdicts, never the PRs. One owner runs each PR to merge-ready; the operator performs the merge.**

1. **Honor state-then-wait.** A request to state the plan is not permission to execute. On explicit go, persist the program objective and standing orders.
2. **Spawn one owner per PR.** Each owner gets its own worktree and owns build, push, ready PR, self-proof, review-bot triage, deslop/no-comments, rebase, and babysit to merge-ready. Under Herdr dispatch each owner as role `subcoordinator` when it must itself delegate lifecycle work, otherwise `implementation`; pass its exclusive worktree as `--cwd` and start owners without serial waits. The dispatcher propagates recursion depth for nested workers/verifiers. Outside Herdr use the host runtime's background-agent behavior.
3. **Run owners in true parallel.** Self-contained PRs use disjoint worktrees/branches. Serialize overlapping writes.
4. **Swarm-verify every merge-ready SHA.** The `swarm` skill owns the verifier fan-out and therefore uses the Herdr dispatcher automatically under Herdr. Include gates, live behavior on the real surface, receipts/diff audit, and a regression lane against trunk. A changed head invalidates the verdict.
5. **Hand clean PRs to the operator.** Owners never merge. After handoff they may take another queue item.
6. **Audit liveness.** Roughly every 30 minutes, re-read this playbook and standing objective. Under Herdr inspect owner agent state/output; do not resume an idle agent merely to check it. Count commits, pushes, PR/check deltas, and durable reports as progress. Replace a genuinely stuck owner through a fresh dispatcher call using the stored consolidated brief.
7. **Stand down on operator stop.** Stop writes immediately and preserve durable state.

Blocked Herdr agents are not failed or complete. Inspect the approval/question and resolve or park it. Unknown state is not completion.

**Reply:** queue with owner, state, head SHA, verifier verdict, merged/handoff state, countersigns, operator gates, and decision-trail locations.
