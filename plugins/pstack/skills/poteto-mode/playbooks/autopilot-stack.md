### Autopilot-stack

When `HERDR_ENV=1`, read [`../references/herdr-tools.md`](../references/herdr-tools.md); every owner, replacement, verifier, and delegated audit worker uses `herdr-dispatch.ts`.

**You own the stack, never the landing. Build and verify the queue autonomously, then hand the operator one linear base-branch stack.**

1. **Run one owner per PR.** Each owner works in an exclusive worktree and owns build, push, ready PR, self-proof, bot triage, cleanup, and babysit to green. Under Herdr dispatch role `subcoordinator` when the owner must delegate lifecycle work, otherwise `implementation`; pass its worktree as `--cwd`. Launch independent owners before waiting. Outside Herdr use the native background-agent primitive.
2. **Audit on the wake chain.** Roughly every 30 minutes re-read this playbook and objective. Under Herdr use agent state/output for liveness; never resume just to probe. Replace stuck owners with fresh dispatcher calls and consolidated stored briefs.
3. **Hold operator gates.** State-then-wait. Explicit stop means immediate zero-writes hold.
4. **Verify STACK-READY heads.** `swarm` owns parallel verifier fan-out and automatically uses the Herdr dispatcher when active. Verdicts pin exact head SHAs.
5. **Append only clean verdicts.** Owners never merge, auto-merge, or close. The root is the only topology writer.
6. **Serialize topology.** Owners push only their branches. The root rebases/retargets the linear stack. Concurrent writer isolation remains mandatory.
7. **Absorb drift then re-verify changed patches.** New SHAs void old verdicts unless stable patch-id proves the patch unchanged; CI and mergeability still rerun.
8. **Deliver the chain.** Every PR carries its verifier verdict; the operator reviews and lands it.

Blocked Herdr agents require deliberate approval/question handling. Unknown state is not completion.

**Reply:** stack root/tip links, one-line verdict per link, and parked/excluded work with reason.
