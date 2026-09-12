### Multi-phase or multi-PR plan

Resolve the driver skill through [poteto-mode's Non-negotiables](../SKILL.md#non-negotiables). The complete upstream plan skeleton is preserved in [`../references/multi-phase-plan-upstream.md`](../references/multi-phase-plan-upstream.md); copy the fenced `# <Program> plan` template from that reference rather than inventing a smaller plan.

**You own the plan, not the code. Do not implement.**

1. Skip the plan for a one- or two-file change with an obvious approach.
2. Settle empirical open questions with Prototype before writing the plan. Preserve branch, SHA, and evidence for Appendix A.
3. Explore the codebase in parallel and return only file pointers, conventions, test commands, and entry points. When `HERDR_ENV=1`, read [`../references/herdr-tools.md`](../references/herdr-tools.md), create one read-only brief per exploration seam, and dispatch each with role `explorer`, `--readonly`, and `--wait`; launch all dispatcher processes before waiting. Do not use native Agent/Task/spawn_agent under Herdr. Outside Herdr use `pstack:poteto-agent`/the host runtime's normal agent primitive with explicit model selection.
4. Copy the full plan skeleton from `../references/multi-phase-plan-upstream.md` into the plan file and fill every placeholder. Unless the operator names a path, write under `~/.claude/orchestrate/<slug>/docs/`. Keep headings and sub-blocks in the same order. One section per PR and one independently verifiable change per PR.
5. Name the execution playbook in **How to read this**. Choose Autopilot-full, Autopilot-stack, or Orchestrate according to their routing rules. Those execution playbooks structurally dispatch their owners/workers through Herdr when active.
6. Preserve the upstream verification rule: tests alone are insufficient; unit, live, and perf evidence are all required. Live verification uses Swarm, which routes its lanes through the Herdr dispatcher when active. Preserve the regression-against-trunk lane, perf baseline/rule, and interaction review gate from the template.
7. Write with `/technical-writing`, then `/unslop`. Run `node skills/poteto-mode/scripts/check-plan.mjs <plan.md>` and fix every reported line.
8. Hand back the plan path and checker output, then stop. Execution starts only on explicit operator go.

**Reply:** plan path, PR ids/dependencies, review-gated set, prototype evidence and unresolved questions, and check-plan output.
