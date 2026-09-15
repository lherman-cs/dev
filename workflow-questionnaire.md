# Dev Workflow Questionnaire — Final Decisions

This document consolidates the workflow decisions made during the Superpowers alignment discussion.

**Default rule:** where a later answer explicitly overrides an earlier one, the later answer wins.

---

## Core architecture

### Q1 — Public skills
**Answer:** Keep exactly five public skills:

- `dev-spec`
- `dev-plan`
- `dev-build`
- `dev-review`
- `dev-project`

No additional public workflow-role skills.

### Q2 — Explorer availability
**Answer:** Every public role may use an `explorer` subagent.

Rules:

- always `fork_turns="none"`
- read-only
- narrow factual task only
- cannot modify code
- cannot make semantic/architecture decisions
- cannot review a whole candidate
- cannot accept work
- cannot spawn agents

### Q3 — Explorer contract
**Answer:** Strict factual helper.

Explorer may:

- inspect code/docs/history
- trace symbols/callers/dependencies
- locate patterns/tests
- answer one bounded factual question
- return concise evidence, paths, symbols, and conclusions

Parent role retains all judgment.

### Q4 — `dev-spec` rigor
**Answer:** Use Superpowers-style scaling:

- Spike
- Bounded
- Architectural

Every path keeps an explicit human approval boundary before implementation.

### Q5 — `spec.md`
**Answer:** Every `dev-spec` invocation writes:

```text
./plans/<project>/spec.md
```

Even bounded work gets a compact spec.

### Q6 — `dev-spec` role in workflow
**Answer:** `dev-spec` is normally a top-level, human-facing phase.

Normal flow:

```text
human ↔ dev-spec
→ APPROVED spec
→ dev-project
```

`dev-project` does not silently perform specification work.

### Q7 — Controller rulings
**Answer:** Superpowers-style controller rulings.

`dev-project` may make small, reversible implementation rulings from the accepted spec and continue.

- small implementation ambiguity → controller ruling
- material execution-plan defect → `dev-plan`
- semantic/product change → stop and require `dev-spec`

### Q8 — Task review gating
**Answer:** Superpowers-style gated tasks.

```text
Task N
→ build
→ review
→ repair/re-review if needed
→ accepted
→ Task N+1
```

No asynchronous trailing review.

### Q9 — Task repair limit
**Answer:** Maximum three reviewed repair rounds.

```text
initial candidate
→ review
→ repair 1 + scoped re-review
→ repair 2 + scoped re-review
→ repair 3 + scoped re-review
→ breaker/adjudication
```

No round 4.

### Q10 — Controller authority over review blockers
**Answer:** `dev-project` may not overrule blocking `dev-review` findings before the three-round breaker.

After the breaker it may adjudicate, park, replan, or escalate.

### Q11 — `dev-plan` detail level
**Answer:** Superpowers-heavy execution-grade planning.

Plans should include, where useful:

- exact files
- interfaces/signatures
- concrete implementation steps
- tests
- commands
- expected outcomes
- code snippets

A fresh Builder should need minimal rediscovery.

### Q12 — Human approval of plan
**Answer:** No separate human approval gate for `plan.md`.

Planner self-reviews it and marks it READY.

Semantic uncertainty goes back to `dev-spec`.

### Q13 — Builder TDD
**Answer:** Strict Superpowers-style TDD.

Normal implementation:

```text
RED
→ verify failure is meaningful
→ minimal GREEN
→ verify pass
→ refactor
→ verify again
```

Exceptions only for work where RED/GREEN is genuinely inapplicable.

### Q14 — Review severity
**Answer:**

- Spec compliance failure → blocking
- Critical → blocking
- Important → blocking
- Minor → non-blocking/deferred

Scoped re-review checks prior blocking findings plus breakage introduced by the fix.

### Q15 — Final whole-project review
**Answer:** Mandatory.

After all tasks are accepted:

```text
full-project validation
→ one strongest fresh final review
→ at most one final fix wave
→ scoped final re-review
→ adjudicate residuals
```

### Q16 — Worktree ownership
**Answer:** User owns worktrees and Git integration.

Workflow does **not**:

- create/remove worktrees
- merge
- push
- rebase
- squash
- switch branches
- clean up branches

### Q17 — Builder commits
**Answer:** Builders may make local commits inside the provided worktree.

Commits provide stable SHA review/recovery boundaries.

### Q18 — Project artifacts
**Answer:**

```text
./plans/<project>/
├── spec.md
├── plan.md
├── progress.md
└── work/
```

### Q19 — Task granularity
**Answer:** Meaningful test/review surfaces.

Do not maximize task count.

Batch trivial same-shape work when it naturally forms one review surface.

### Q20 — Preflight
**Answer:** `dev-project` performs one bounded whole-plan preflight before Task 1.

Checks:

- spec/plan consistency
- shared files/interfaces
- task dependency contradictions
- test/code correspondence
- obvious execution conflicts

Must not become a second giant planning/review phase.

### Q21 — Plan mutability during execution
**Answer:** `plan.md` is stable during normal execution.

Small rulings go into `progress.md`.

A material replan rewrites `plan.md` through `dev-plan`.

### Q22 — Builder blocker handling
**Answer:** Superpowers adaptive routing.

- missing context → provide context/resume
- reasoning blocker → configured capability escalation
- task too large → operational split
- plan materially wrong → `dev-plan`
- semantic change → `dev-spec`
- never retry a fresh agent with identical instructions

### Q23 — Task review structure
**Answer:** Two fresh task reviewers run in parallel:

1. Spec Reviewer
2. Quality Reviewer

Spec Reviewer checks:

- requirements
- interfaces
- invariants
- missing/extra behavior

Quality Reviewer checks:

- bugs
- edge cases
- architecture
- maintainability
- tests
- technical soundness

They inspect the same immutable candidate independently.

### Q24 — Deferred findings and rulings
**Answer:** Superpowers-style transparency.

- Minor findings go to `progress.md`
- controller rulings go to `progress.md`
- deferred Minors feed final review
- completion report summarizes rulings/deferred items

### Q25 — Git status of `plans/`
**Answer:** The entire `./plans/` tree is Git-ignored.

No evidence commits, plan commits, state commits, or workflow-artifact commits.

### Q26 — Completion cleanup
**Answer:** Keep:

```text
spec.md
plan.md
progress.md
```

Delete:

```text
work/
```

only after successful project completion.

### Q27 — Bounded vs architectural spec format
**Answer:** Same basic spec structure at every scale; bounded work is simply shorter.

### Q28 — Supporting prompt files
**Answer:** Use small `SKILL.md` files plus supporting prompt templates.

### Q29 — File-based packaging
**Answer:** Strongly adopt deterministic file packaging.

Use scripts/utilities for:

- task brief extraction
- exact Git review packages
- workflow-state mechanical validation

Spawn prompts pass paths + SHAs, not accumulated history.

### Q30 — `progress.md` ownership
**Answer:** `dev-project` exclusively owns `progress.md`.

Single writers:

```text
dev-spec     → spec.md
dev-plan     → plan.md
dev-project  → progress.md
dev-build    → repo changes/commits + build reports
dev-review   → review reports
```

### Q31 — Task verification scope
**Answer:** Scale verification to the task.

Builder runs:

- focused RED/GREEN validation
- plan-prescribed task/package/integration checks

Full-project validation runs once before final review.

### Q32 — Full-project validation ordering
**Answer:** Validate before final review.

```text
all tasks accepted
→ full-project validation
→ final review
```

If final-fix code changes:

```text
focused validation
→ full-project validation again
→ scoped final re-review
```

### Q33 — Model routing
**Answer:** Configured capability escalation.

Skills contain no model names.

Role config owns concrete model + reasoning effort.

`dev-project` may request an explicitly configured escalation role only after a concrete capability blocker.

### Q34 — Child questions
**Answer:** Follow Superpowers.

Builder may ask controller specific questions before or during implementation.

Controller supplies context/rulings and resumes the same Builder.

### Q35 — `progress.md` format
**Answer:** Small structured recovery ledger.

Example sections:

```text
Status
Tasks
Rulings
Deferred
Active findings
Validation
```

No narrative project diary.

### Q36 — Scoped re-review lifetime
**Answer:** Fresh Reviewer for every scoped re-review.

Builder remains warm through repair rounds.

### Q37 — Dispatch template location
**Answer:** Keep dispatch templates with `dev-project`.

Example:

```text
dev-project/
├── SKILL.md
└── prompts/
    ├── build-task.md
    ├── fix-task.md
    ├── task-spec-review.md
    ├── task-quality-review.md
    ├── scoped-spec-rereview.md
    ├── scoped-quality-rereview.md
    └── final-review.md
```

### Q38 — Resume behavior
**Answer:** Every `dev-project` invocation reconciles durable state.

No special conceptual resume workflow.

Never assume a previously active child still exists merely because the ledger says so.

### Q39 — Task concurrency
**Answer:** Superpowers-style sequential task gates.

No parallel meaningful Builders.

Batch trivial same-shape work instead.

### Q40 — Material plan defect
**Answer:** Return to `dev-plan`.

`dev-project` never rewrites a material plan itself.

### Q41 — Reviewer test execution
**Answer:** Reviewers do not routinely rerun Builder validation.

They may run a narrow targeted check when they have a concrete reason to doubt something.

### Q42 — Unrelated defects
**Answer:** Candidate-bounded review.

Pre-existing/unrelated defects:

- do not block
- do not enter repair loop
- may be recorded as out-of-scope/Minor

Scoped re-review is narrower still.

### Q43 — Task/fix commits
**Answer:** Every task and repair candidate gets its own commit.

No amend-based moving candidate boundary.

### Q44 — Builder reports
**Answer:** Short structured reports only.

Include:

- status
- commit
- implemented behavior
- verification commands/results
- relevant files
- important residual concern

No investigation diary.

### Q45 — Reviewer reports
**Answer:** Findings-first compact reports.

Include:

- verdict
- blocking findings
- Minor findings
- evidence checked

No essay, praise, or speculative improvement hunt.

### Q46 — Full-project validation failure
**Answer:** Fix before final review.

Classify the smallest responsible scope.

Do not turn unrelated pre-existing failures into project work.

### Q47 — Human stop conditions
**Answer:** Superpowers-style continuous execution.

Stop only for meaningful authority boundaries such as:

- destructive/irreversible action
- security-sensitive authorization
- outside-worktree side effect needing permission
- accepted semantics truly need human revision
- every reasonable path forward would be guessing

Do **not** stop for normal task transitions, repair rounds, ordinary implementation ambiguity, or normal validation.

### Q48 — Plan review
**Answer:** Planner self-reviews.

No mandatory independent plan Reviewer.

### Q49 — Builder context
**Answer:** Fresh Builder gets a self-contained task brief, not the accumulated project history.

### Q50 — Task Reviewer context
**Answer:** Bounded task package only.

Do not routinely preload full spec/plan/progress/history.

### Q51 — Final Reviewer context
**Answer:** Final Reviewer deliberately gets whole-project context:

- `spec.md`
- `plan.md`
- `progress.md`
- full project diff/range
- final validation results

Not every historical work report.

### Q52 — Final fix owner
**Answer:** One fresh Builder handles the integrated final fix wave.

Do not resurrect historical task Builders.

### Q53 — Residual final blocker
**Answer:** No second automatic final-fix loop.

After one fix wave + scoped final re-review:

- resolved/mistaken/out-of-scope/Minor → adjudicate and complete
- genuine blocking implementation issue → project remains incomplete
- material plan defect → `dev-plan`
- semantic change → `dev-spec`

### Q54 — Mechanical workflow rules
**Answer:** Automate mechanical invariants with scripts/validators.

Do not encode semantic judgments in scripts.

### Q55 — Dual-review repair wave
**Answer:** If both task reviewers block, combine all current blocking findings into one repair assignment to the same warm Builder.

One combined repair candidate = one repair round.

Affected scoped re-reviews run fresh and in parallel.

### Q56 — Pressure testing
**Answer:** Use behavioral pressure tests plus mechanical validators.

Pressure tests should cover known failure modes from real transcripts.

### Q57 — Mid-project replan file behavior
**Answer:** Rewrite `plan.md` as the single current execution authority.

Record why in `progress.md`.

Do not accumulate `plan-v2.md`, `plan-final-2.md`, etc.

### Q58 — Human approval of replan
**Answer:** No new human approval if semantics remain unchanged.

### Q59 — Mid-project spec revision
**Answer:** Revised approved spec becomes the new authority.

`dev-plan` replans from current repository state and only revisits work actually affected.

### Q60 — Spike behavior
**Answer:** Spike is exploratory only.

Prototype code is throwaway until it goes through normal planning/build/review.

### Q61 — Choosing Spike/Bounded/Architectural
**Answer:** `dev-spec` automatically chooses the lightest sufficient path.

May escalate rigor as uncertainty appears.

### Q62 — Controller code edits
**Answer:** `dev-project` never edits production/test code.

All repository implementation goes through `dev-build`.

### Q63 — Successful completion behavior
**Answer:** Adapted Superpowers finish:

```text
all tasks accepted
→ final validation
→ final review
→ completion state
→ delete work/
→ retain spec.md + plan.md + progress.md
→ concise completion report
→ stop
```

No merge/push/rebase/worktree actions.

### Q64 — Spec approval marker
**Answer:** Minimal durable marker inside `spec.md`:

```text
Status: DRAFT
Status: APPROVED
```

Any semantic revision returns it to DRAFT until human approval.

### Q65 — Standalone `dev-review`
**Answer:** Supported.

Direct human invocation does not require project artifacts.

Project-specific review mode comes from `dev-project` dispatch contracts.

### Q66 — Immutable task briefs
**Answer:** Once dispatched, a task brief is immutable.

Later fixes/rulings get incremental repair artifacts.

### Q67 — Standalone `dev-build`
**Answer:** Supported.

Direct human invocation uses Builder discipline without requiring a project folder.

### Q68 — Fresh subagent context
**Answer:** Every fresh workflow child uses:

```text
fork_turns="none"
```

Only the same Builder is resumed during its task repair loop.

### Q69 — Spawn authority
**Answer:** Centralized orchestration.

General rule:

- `dev-project` orchestrates workflow roles
- every public role may spawn Explorer only
- Explorer cannot spawn anything

### Q70 — Planner/Specifier recovery routing
**Answer:** `dev-project` may invoke Planner, but not Specifier.

For semantic/spec work:

```text
dev-project stops
→ human runs dev-spec
```

### Q71 — Resume after spec revision
**Answer:** Human runs `dev-spec`, approves the revised spec, then invokes normal `dev-project` again.

`dev-project` reconciles state, invokes Planner if necessary, and continues.

### Q72 — Planner context
**Answer:** Fresh isolated Planner receives bounded durable planning context.

No inherited controller conversation.

### Q73 — Planning without spec
**Answer:** `dev-plan` requires an `APPROVED` `spec.md`.

It never invents product semantics.

### Q74 — Plan readiness marker
**Answer:** Minimal state inside `plan.md`:

```text
Status: DRAFT
Status: READY
```

READY means Planner self-reviewed and execution-ready under the approved spec.

### Q75 — Plan format
**Answer:** Superpowers-style natural execution-grade Markdown.

Only one lightweight mechanical convention is required:

```text
### Task N: ...
```

for deterministic task extraction.

No rigid universal subsection schema.

### Q76 — Fresh project planning from `dev-project`
**Answer:** If spec is APPROVED but plan is missing/DRAFT:

```text
dev-project
→ spawn fresh dev-plan
→ READY plan
→ preflight
→ execute
```

### Q77 — After spec approval
**Answer:** `dev-spec` stops after approval and tells the human to run `dev-project`.

It does not automatically start implementation.

### Q78 — Extra manifest/state file
**Answer:** None.

Use only:

```text
spec.md
plan.md
progress.md
work/
```

plus Git truth.

### Q79 — Baseline validation
**Answer:** Establish one meaningful baseline before Task 1.

Use plan-defined project-level baseline validation.

Do not blindly run every possible expensive test.

### Q80 — Clean starting worktree
**Answer:** Required.

If tracked/index state is dirty, `dev-project` stops and reports it.

It does not stash/reset/commit user changes.

### Q81 — Oversized task
**Answer:** `dev-project` may split it operationally when the split is semantics-preserving.

No full replan merely because one execution unit is too large.

Material strategy/interface redesign still goes to `dev-plan`.

### Q82 — Waiting for agents
**Answer:** Follow Superpowers runtime behavior.

- use actual wait/resume/follow-up mechanisms
- no fake “pausing briefly”
- no conversational short polling loops
- no redispatch merely because a child is still running
- resume same Builder for clarification/fix

### Q83 — Controller code inspection
**Answer:** Bounded inspection only.

Controller may inspect enough to orchestrate or make a ruling, but must not become another Builder/Planner/Reviewer.

### Q84 — Task brief rewriting
**Answer:** Preserve Planner task text.

Task packaging is mostly mechanical and adds only execution metadata/rulings.

Controller does not silently create a second plan.

### Q85 — Requirements inside tasks
**Answer:** Planner carries the relevant spec requirements/invariants into each task.

Fresh Builder/Reviewer should normally not need to reopen the entire spec.

### Q86 — Necessary unplanned work
**Answer:** Builder does not silently expand scope.

Route to controller:

- tiny implied consequence → ruling
- bounded follow-up unit → controller schedules it
- material plan gap → Planner
- semantic change → Spec

### Q87 — No approved spec
**Answer:** `dev-project` does not proceed.

It tells the human to run `dev-spec`.

### Q88 — Explorer handoff
**Answer:** Compact factual response to parent.

No Explorer-specific durable artifact by default.

Parent role incorporates any durable fact into its own artifact.

---

# Batch decisions 88–104

The following were accepted together with the default **A / Superpowers-adopted** answer.

## Q88 — Builder self-review
**Answer:** Builder performs one bounded self-review before handoff/commit.

## Q89 — What consumes a repair round?
**Answer:** A repair round is consumed only when a new repair candidate is submitted to scoped re-review.

Local debugging/editing before that does not consume extra rounds.

## Q90 — Repeated debugging failure
**Answer:** Use systematic-debugging behavior.

Stop guessing, determine root cause, and then:

- provide context
- capability-escalate
- split
- rule
- replan

as appropriate.

## Q91 — Finding IDs
**Answer:** Stable IDs across repair rounds (`S1`, `Q1`, etc.).

## Q92 — Explorer concurrency
**Answer:** Parent may run multiple independent narrow Explorers in parallel.

## Q93 — Trivial batching
**Answer:** Planner normally batches appropriately; controller may coalesce clearly same-shape trivial work during preflight when there is one meaningful test/review surface.

## Q94 — Standalone Builder commit behavior
**Answer:** Standalone `dev-build` normally commits verified work unless explicitly told not to.

Never push/merge/rebase.

## Q95 — Crash/restart with uncommitted Builder work
**Answer:** Preserve and reconcile.

If clearly attributable to the active workflow task, recover it.

If provenance is ambiguous, stop and report paths.

Never automatically discard it.

## Q96 — Explicit cancellation
**Answer:** Stop promptly and preserve state.

No automatic reset/revert/cleanup.

## Q97 — Cleanup when incomplete
**Answer:** Delete `work/` only after successful completion.

Blocked/cancelled/semantic-stop projects preserve it for recovery.

## Q98 — Project-folder selection
**Answer:** Human/project-name first with deterministic reuse.

Do not guess when multiple plausible active projects exist.

No random/date directory proliferation.

## Q99 — Validator behavior
**Answer:** Validators detect mechanical errors but do not silently rewrite authoritative artifacts.

Derived package generation is allowed.

## Q100 — TDD exceptions
**Answer:** Narrow explicit exceptions only.

Examples:

- generated artifacts
- documentation
- mechanical/config work
- throwaway spike code

Use the strongest meaningful verification instead of fake RED tests.

## Q101 — Outside-world side effects
**Answer:** Repository-local normal commands proceed automatically.

Meaningful destructive, security-sensitive, or outside-worktree side effects requiring permission stop for the human.

## Q102 — Capability escalation config
**Answer:** Capability aliases belong in role configuration, never skill policy.

Skills know only normal vs configured escalation role, not model rankings/names.

## Q103 — Minor findings at completion
**Answer:** Minors do not block completion.

Final review may reconsider them in integrated context; remaining Minors are reported.

## Q104 — Additional mandatory quality gates
**Answer:** None.

Do not add mandatory:

- architecture reviewer
- test reviewer
- security reviewer
- evidence reviewer
- plan reviewer

unless a specific project/spec actually requires that specialty.

---

# Model / role tuning decision

The workflow-level rule is:

> Skills do not contain concrete model names. Agent configuration owns model and reasoning settings. `dev-project` selects role/capability aliases, never ranks models dynamically.

The role tuning discussed was:

```text
Specifier      → Astra / medium
Planner        → Sol / high
Builder        → Terra / medium
Builder strong → Sol / high
Reviewer       → Sol / high
Final reviewer → Astra / low
Orchestrator   → Terra / medium
Explorer       → Luna / medium
```

`Astra / low` replaced the earlier `Astra / high` final-review suggestion.

This is a configuration choice, not workflow semantics, and may be retuned later without changing the skills.

---

# Important Superpowers default

For behavior not explicitly overridden above:

> **Adopt Superpowers behavior rather than inventing a custom workflow rule.**

The explicit deviations from stock Superpowers are primarily:

1. Exactly five public skills.
2. Universal narrow Explorer helper.
3. Two parallel task reviewers: Spec + Quality.
4. Three reviewed task repair rounds.
5. `./plans/<project>/spec.md`, `plan.md`, `progress.md`, `work/`.
6. The entire `./plans/` directory is Git-ignored.
7. User owns branch/worktree/merge/push/rebase lifecycle.
8. Mandatory strongest fresh final review with one final fix wave.
9. Model selection is owned by named role configuration.
10. `dev-project` may invoke Planner automatically, but not Specifier.
