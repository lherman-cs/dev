# Workflow requirements

These are invariants for the production workflow, not another worker prompt.

- Exactly five public skills: `dev-spec`, `dev-plan`, `dev-build`, `dev-review`, `dev-project`; Explorer remains a narrow read-only leaf.
- `spec.md` is the only durable workflow document edited by agents/human. Operational truth belongs to the native `dev workflow` middleware.
- Middleware state is a versioned SQLite database outside the worktree, under worktree-specific Git metadata. Only the Rust CLI mutates it; agents never inspect SQL or state files.
- Authority is intentionally split three ways: Git owns code/candidate reality; approved `spec.md` owns semantics; SQLite owns workflow bookkeeping. Do not make SQLite a second semantic source of truth.
- SQLite is private implementation detail, not an agent interface. The current Rust runtime may invoke the installed `sqlite3` CLI, but agents never receive SQL/table/schema instructions and never inspect or repair the database; they use semantic `dev workflow` commands only. The storage access implementation may change without changing agent contracts.
- Durable state stays minimal: no transcripts, chain-of-thought, copied source, full diffs, exploration dumps or unbounded logs. The event trail is diagnostic only, not event-sourced workflow state.
- One writer/controller per worktree. Transitions are atomic; concurrent-controller contention fails closed rather than growing coordination machinery.
- Schema growth requires a concrete invariant/recovery justification. Do not turn `dev workflow` into a generic workflow engine, project tracker, or agent memory system.
- Human approves semantics. Planner does the heavy execution design once: consequential interfaces, invariants, dependencies, task boundaries and proof strategy. There is no `plan.md`.
- Controller owns dispatch, not engineering judgment. Normal hot path is `dev workflow next` -> dispatch named role -> wait -> repeat. It should not read diffs/reports/state.
- Builder gets one bounded task and resolves ordinary implementation mechanics independently. It commits a stable candidate; middleware verifies exact SHA/HEAD/ancestry/cleanliness and runs Planner-declared checks itself.
- One fresh Reviewer covers requirements and engineering quality. Review input is candidate-scoped and bounded; Minor findings do not trigger repair.
- Initial task review has at most one repair + one fresh rereview. Every original blocker must be explicitly resolved; repair regressions/serious late discoveries remain blockers. Residual blockers stop for human.
- At most one automatic material replan. A second request stops for human instead of cycling.
- Candidate verification gets one correction after failure. A second failure stops for human.
- Whole-project validation precedes one strongest fresh final review. One integrated final repair wave is allowed; residual blockers stop.
- Invalid middleware calls fail closed. No invalid proposal mutates execution state. Two consecutive invalid semantic calls pause to avoid tool-call thrashing.
- Human intervention is first-class: semantic question/answer, operational pause/resume and explicit clean-HEAD adoption. Human semantic answers become durable approved spec amendments and invalidate only nonaccepted compiled work.
- State schema is migratable and forward-version protected. Interrupted runs recover from DB + Git truth; accepted work is not redispatched merely because a session restarted.
- Context is bounded. Fresh children receive only their current contract/evidence; oversized diffs fail toward a smaller boundary instead of silently consuming the model window.
- Verification commands are executed directly without a shell. The runtime rejects shell interpreters/composition rather than treating planner text as trusted code.
- Model/effort selection belongs only to role TOMLs and is unchanged by workflow logic.
- Preserve user changes and Git lifecycle authority. No automatic push/merge/rebase/squash/worktree management, stash/reset/clean, or permission bypass.
- Local Justfile tests are the automation boundary. No CI or automatic paid-model evaluations.

Current role baseline remains:

```text
Specifier      -> Sol / medium
Planner        -> Sol / high
Builder        -> Sol / low
Builder strong -> Sol / medium
Reviewer       -> Sol / medium
Final reviewer -> Astra / low
Orchestrator   -> Luna / medium
Explorer       -> Luna / medium
```

Success is measured by accepted-task correctness, straight-through rate, human questions, repair/replan frequency, controller token share, peak context and escaped defects—not by fewer findings alone.
