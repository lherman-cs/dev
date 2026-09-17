# Dev workflow runtime

`dev workflow` is the deterministic control plane for the five-agent development workflow.
The approved `spec.md` is the only durable workflow document intended for agents or humans to edit directly. Operational state lives in a versioned SQLite database under the worktree's Git metadata and is mutated only by the Rust CLI.

```text
human + Specifier -> approved spec.md
                         |
                         v
                     Planner
                         |
                  dev workflow plan
                         |
                         v
Controller: dev workflow next -> Builder -> middleware checks -> Reviewer
                         ^                        |
                         |-------- one repair ----|
                         |
                         v
                 integrated final review
```

## Boundary

Agents propose work through narrow CLI operations. They never edit workflow state, serialize reports, maintain a ledger, or inspect SQLite. The runtime validates the current phase, Git SHAs, ancestry, clean worktree, task dependencies, verification commands, finding continuity, repair/replan ceilings and final reviewed HEAD before committing a transition.

The controller's normal loop is deliberately small:

```text
dev workflow next
-> dispatch the named configured role with the returned context command
-> wait for that role
-> dev workflow next
```

The controller does not read diffs, reports, plans or the database. Technical judgment remains with Planner, Builder and Reviewer. Product semantics remain with the human-approved spec.

## Storage

The database is stored at `<absolute-git-dir>/dev-workflow/workflow.sqlite3`. This keeps operational state out of the source tree and gives each linked worktree independent state. `PRAGMA user_version` owns schema versioning; the runtime migrates supported older schemas before use and refuses databases newer than the binary.

The database contains only control-plane facts: phase, spec identity, expected HEAD, tasks/dependencies/checks, candidate SHAs, verification evidence, findings/resolutions, bounded counters, human requests and an event trail. Reasoning transcripts are not durable workflow state.

## SQLite design guardrails

SQLite is an implementation detail behind the semantic CLI, not an API for agents and not a second project model. Keep it deliberately boring:

- **Three authorities only.** Git owns code/candidate reality; approved `spec.md` owns product semantics; SQLite owns workflow bookkeeping. Do not duplicate a fact in SQLite when it can be cheaply and safely re-derived from Git or the spec.
- **No raw database access in prompts or skills.** Agents call semantic operations such as `next`, `plan add`, `candidate submit`, and `review finish`. Table names, SQL, migrations, and serialization never enter agent context.
- **Current state first.** Primary rows represent current durable state. The `events` table is a compact diagnostic audit trail, not event sourcing and not required to reconstruct normal state.
- **No context landfill.** Never persist transcripts, chain-of-thought, copied source, complete diffs, exploration dumps, or unbounded test logs. Store only facts needed to validate, resume, route, or explain a transition.
- **Small schema, explicit justification.** Normalization tables that support tasks/checks/findings are fine, but new tables/columns must serve a concrete invariant or recovery need. Do not grow SQLite into a project tracker, agent memory store, or generic workflow engine.
- **One writer per worktree.** `BEGIN IMMEDIATE` makes transitions atomic. Concurrent controllers for the same worktree are unsupported; contention should fail/stop rather than create distributed coordination machinery.
- **Forward migrations only.** Migrations are transactional, keyed by `PRAGMA user_version`, preserve accepted work, and refuse a database newer than the running binary. No automatic destructive downgrade.
- **Fail closed.** A malformed/hallucinated/stale tool call returns an error and leaves state unchanged. Idempotent repeats may return the already-committed result; they must never double-advance state.
- **Storage backend stays encapsulated.** The current implementation invokes the local `sqlite3` CLI; bootstrap/Nix install it. That is a Rust-runtime implementation detail, not an agent dependency. A future embedded SQLite binding may replace it without changing the agent-facing CLI contract. Installing, inspecting, repairing, or migrating SQLite must never become an agent responsibility.

The litmus test is `dev workflow next`: on the normal path it must determine the single next role/action without requiring the controller to read the database, source, plan history, or prior conversations. If maintaining the runtime starts requiring a generic orchestration framework, a large ontology, or durable agent reasoning, simplify it.

## Planning

Initialize only from an explicitly approved spec:

```sh
dev workflow init --spec plans/example/spec.md
```

Planner reads the spec and repository, then compiles execution directly into the runtime:

```sh
dev workflow plan add \
  --title '...' --goal '...' \
  --requirement '...' --path 'src/...' \
  --check 'cargo test -p example'

dev workflow plan final-check --check 'cargo test'
dev workflow plan ready
```

There is no `plan.md`. A task is one coherent independently reviewable outcome. Planner owns consequential interfaces, dependencies, invariants and proof strategy; ordinary implementation mechanics stay with Builder.

## Build and review

`dev workflow next` activates exactly one runnable task. Builder retrieves only its task:

```sh
dev workflow task --task 3
```

After committing, Builder submits the candidate:

```sh
dev workflow candidate submit --task 3 --sha HEAD
```

The runtime resolves the full SHA, requires it to equal clean HEAD and descend the expected predecessor, then executes Planner-declared checks itself without a shell. A failed check does not advance to review. One corrected candidate is allowed; a second verification failure pauses for human intervention.

Reviewer gets only task contract + exact candidate evidence:

```sh
dev workflow task --task 3 --review
```

Findings are recorded through the runtime and the review closes atomically:

```sh
dev workflow review finding --task 3 --severity important \
  --summary '...' --evidence '...'
dev workflow review finish --task 3 --verdict fixes-required
```

An initial PASS accepts the task. Otherwise there is one repair candidate and one fresh rereview. Every initial blocker must receive an explicit resolution; new rereview blockers must be identified as repair regressions or serious late discoveries. Residual blocking work after that single repair pauses instead of looping.

## Final review

After every task is accepted, the runtime executes final checks and routes one fresh integrated review. `dev workflow final context` supplies the approved spec identity, accepted task summary, candidate-bound validation and bounded diff. One integrated final repair wave is allowed. A residual blocker pauses rather than starting another automatic loop.

## Human intervention

Human intervention is a supported transition, not workflow corruption:

```sh
dev workflow human ask --question '...'
dev workflow human answer --request 1 --answer '...'
dev workflow human pause --reason '...'
dev workflow human resume
dev workflow human adopt-head --reason '...'
```

A semantic answer is appended verbatim to the approved spec and invalidates only non-accepted compiled work, returning control to Planner. A legitimate clean human-created HEAD can be explicitly adopted. Unexpected HEAD movement otherwise fails closed.

## Failure policy

The runtime is strict about safety but flexible about path:

- invalid calls never advance work;
- two consecutive semantically invalid middleware calls pause to prevent tool-call thrashing;
- one task repair, then human if still blocked;
- one automatic material replan, then human;
- one corrected candidate after verification failure, then human;
- one final repair wave, then human;
- stale/non-HEAD candidate acceptance is rejected;
- oversized review contexts fail toward split/replan instead of silently filling a model context;
- shell composition is not used for Planner verification commands.

A hard stop is preferable to an unbounded agent loop.

## Models and Git lifecycle

Concrete model/effort choices remain solely in `dotfiles/.codex/agents/*.toml`; the workflow runtime does not dynamically retune them. The workflow never pushes, merges, rebases, squashes or manages worktrees. Those remain human-owned repository lifecycle actions.

## Local validation

```sh
just test-fast
just test-slow
just test
```

No CI or automatic paid-model runs are required by this repository.
