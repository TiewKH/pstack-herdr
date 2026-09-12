### Orchestrate

Resolve the driver skill through [poteto-mode's Non-negotiables](../SKILL.md#non-negotiables). When `HERDR_ENV=1`, read [`../references/herdr-tools.md`](../references/herdr-tools.md) before the first spawn. Every coordinator, worker, verifier, watcher, stacker, or other delegated coding agent is then created through `herdr-dispatch.ts`; do not mix native `Agent`, `Task`, or Codex `spawn_agent` children into the same Herdr program.

**You own the program, never the code. Author briefs, drain the queue, keep the frontier green, decide.** Use this for a standing coordinator program that outlives a single worker session. One task driven to a predicate is Autonomous run. One ambitious bespoke run is figure-it-out.

Three rules carry the rest.

- Completions are queue events, not interrupts.
- Every spawn carries the standing orders.
- The brief is the product.

#### Roles and placement

- **Coordinator.** Frames, authors briefs, drains the inbox, owns the human report, and makes judgment calls. It does not author program code. Under Herdr it dispatches children with semantic roles and reads their structured results; outside Herdr it uses the host runtime's normal agent primitive.
- **Sub-coordinator.** Durable and one per track only when the root coordinator cannot drain that track directly. Under Herdr dispatch with role `subcoordinator`. A sub-coordinator may recursively dispatch workers and verifiers because the dispatcher propagates `PSTACK_HERDR_DEPTH`; the configured depth limit is authoritative. It rolls up descendants rather than forwarding raw reports.
- **Worker.** A background implementation child. Give every concurrent writer an exclusive worktree or branch and dispatch with role `implementation` or `difficult-implementation` as appropriate.
- **Verifier.** Independent and read-only by default. Dispatch with role `verifier`, preferably to a different profile/model family from the writer.
- **Reviewer or judge.** Read-only judgment work uses role `reviewer`, `judgment`, or `arena-judge` according to the workflow that requested it.

Depth normally stays coordinator, track, worker. Do not add nesting without a coordination reason. The dispatcher rejects recursion beyond configured `max_depth`.

#### Store layout

Create `~/.claude/orchestrate/<project-slug>/` outside the repository. The store must survive session restarts. Use `bun skills/poteto-mode/scripts/orch/orch.ts`, written below as `orch`, for bookkeeping.

- `preferences.md` contains standing orders.
- `overview.md` is the durable PR and issue database.
- `units.tsv` records unit id, track, state, branch, PR, head SHA, and brief path.
- `frontier.json` is the computed merge frontier.
- `ledger.tsv` is the verification ledger.
- `inbox/` contains completion pointers.
- `gates.md` parks human gates.
- `decisions.tsv` is the show-me-your-work trail.
- `status.md` is generated from the tables at each drain.

Every file has exactly one writer. Owners publish facts and readers aggregate them.

#### The brief

Every child receives enough information to work without this chat:

```text
GOAL         one sentence outcome
ROLE         semantic pstack role used for routing
SCOPE        writable and forbidden paths; exclusive worktree/branch for writers
CONTEXT      file, PR, issue, and upstream-result pointers
ACCEPTANCE   checkable criteria
VERIFY       exact commands or resolved driver skill
TIMEBOX      cap; return partial findings on expiry
FORBIDDEN    no rebase, no force-push, no out-of-scope fixes
REPORT       status, branch, SHA, PR, verdict, tests, deviations, follow-ups
STANDING     preferences.md contents or durable path
```

Under Herdr, materialize the brief to a file and invoke the dispatcher with `--prompt-file`, the selected semantic `--role`, a unique agent `--name`, and the unit's `--cwd`. Add `--readonly` for investigators, reviewers, judges, and verifiers. Use `--wait` only when the caller actually needs the result before proceeding; rolling-window workers should normally start without it and be drained through Herdr agent state/output plus the durable inbox.

A sub-coordinator brief also contains track boundaries, unit list, spawn budget, drain protocol, and rollup format. Missing required fields are a refuse-to-spawn condition.

#### Steps

1. **Frame.** State a countable done predicate, scope, expected stacks, and wall-clock budget. If one worker can finish within the budget, use Autonomous run instead. Contested decomposition goes through arena.
2. **Install the runtime.** Run `orch init`, open the decision trail, write standing orders, and seed the frontier. If `HERDR_ENV=1`, confirm the dispatcher can infer the parent kind or that routes provide profiles before spawning the pilot.
3. **Pilot.** Push one representative unit through brief, worker, verification, stack entry, ledger, and merge. Under Herdr this pilot must use the dispatcher so profile routing, worktree cwd, lifecycle, and result collection are tested before fan-out.
4. **Scale.** Maintain a rolling window of workers. Under Herdr start each worker through the dispatcher without serially waiting between starts. Spawn sub-coordinators only past the one-drain threshold. Every concurrent writer gets an isolated worktree/branch.
5. **Drain.** At drain points inspect durable inbox state and Herdr agent state. A Herdr `blocked` status is a gate or approval to inspect, never success. `unknown` is not completion. Read settled worker output with Herdr rather than restarting/resuming it.
6. **Land.** Integrate continuously. Landing, restacking, or conflict repair that requires delegated code work is another dispatcher unit under Herdr. Keep one stacker per stack and the frontier green.
7. **Close.** Reconcile every dispatched agent to done, abandoned, blocked, or zombie-reconciled; verify the predicate against the real artifact and current head SHAs; audit the trail; leave the store intact.

#### Queue and drain

- Completion creates an inbox pointer and returns control to the coordinator. Never deep-review a diff inside a drain.
- Drain after critical sections, track rollups, watcher wakes, and before human reports.
- Under Herdr, use the agent identity returned by the dispatcher as the durable runtime handle. Query state before reading output. Do not resend prompts merely because a wait timed out.
- Classify each pointer as landed, needs-verify, failed, blocked, zombie, or noise. Update `units.tsv`, `ledger.tsv`, and status before refilling the rolling window.
- Account for every child. Missing output is an explicit coverage gap, not permission to silently redo it.

#### Stack safety

- Recompute `frontier.json` after every merge or stack mutation.
- Exactly one stacker per stack may mutate it.
- Workers never rebase and never run stack-management commands unless their brief explicitly makes them the stacker.
- PR closes, retargets, merges, and stack surgery are serialized stack operations.
- A retro watcher follows merged PRs for reverts, post-merge CI failures, and orphaned follow-ups. Under Herdr it is a dispatcher-created read-only worker/reviewer, not a native background agent.

#### Verification

Scale verification to the unit. Cheap deterministic checks may be worker-run with receipts. Expensive, judgment-laden, or high-blast-radius verification gets an independent verifier dispatched with role `verifier` and `--readonly` under Herdr.

Ledger rows are keyed by PR plus head SHA. A changed SHA voids the verdict. CI green is evidence, not the verdict. `blocked` and `inconclusive` are not passes.

#### Liveness and failure

- Never resume an agent just to check liveness. Under Herdr use agent state and recent output; durable branches, PRs, store rows, and ledger entries remain the source of truth.
- On `blocked`, inspect the question/approval and either satisfy it or park a gate. Do not blindly resend the task.
- On timeout or `unknown`, inspect state/output before retrying. Retry cap/OOM with smaller scope, network failures as-is, tool failures on another routed profile, and unknown once. Two retries then abandon and replan.
- A late zombie reconciles against current frontier and ledger before acceptance.
- After a coordinator session restart, do not assume old child processes survived. Re-read standing orders and durable state, query Herdr for still-existing agents where possible, then respawn only missing work from stored briefs.

#### Escalation

Batch irreversible actions and genuine product/preference decisions into `gates.md`. Routine retries, CI triage, restack mechanics, review-thread triage, and reversible scope decisions stay with the coordinator.

**Reply:** at checkpoints and close report the predicate count from `units.tsv`/`ledger.tsv`, tracks landed, frontier with SHAs, verdict summary, abandoned work, open gates, store path, trail path, and PR links.
