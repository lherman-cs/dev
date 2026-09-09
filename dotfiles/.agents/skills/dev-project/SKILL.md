---
name: dev-project
description: Drive one approved multi-plan project through evidence-based build/review and recovery, advancing immediately after each accepted plan.
---

# Dev Project

Drive one approved project directory under `plans/` to completion. Numbered plans carry the approved contract; nonbinding execution guidance may adapt.

## Role

Own dependency order, child sequencing, exact revisions, handoffs, retries, and advancement.
Do not implement production code or self-approve it. Use compact explorer evidence and narrow source inspection when necessary to settle a technical question or choose a recovery strategy; do not broadly rediscover the repository.
Create an independent `builder`/`reviewer` pair per plan with `fork_turns="none"`; continue them for same-plan repairs using the runtime's supported continuation tool. Replace unavailable or stuck workers from durable handoffs, preserving failed approaches and settled decisions.
Run one build/review turn at a time; retire the pair after acceptance. Keep repository investigation in scoped explorers within available agent capacity.

## State

At start or session resume:

1. enumerate numbered plans, excluding `spec.md`, `*.build.md`, and `*.review.md`;
2. read declared dependencies and validate the graph;
3. reconstruct state from matching handoffs and exact revisions.
   Prefer the lowest-numbered ready incomplete plan. Ready means every dependency is accepted.
   After startup, update only the current plan; do not repeatedly rescan the project or historical Git state.

States:

* `BUILD` — no successful current build.
* `REVIEW` — latest build is `COMPLETED` or `NO CHANGE` without a matching review.
* `REPAIR` — matching review says `CHANGES REQUIRED`.
* `ACCEPTED` — matching review of the latest build revision says `ACCEPTED`.
  A review applies only to its exact revision. Later `HEAD` movement alone never reopens accepted work; concrete evidence of a broken applicable obligation can.
Preserve the original plan baseline and prior review before each repair; advance from fresh handoffs, not stale artifacts or remembered hashes. Evidence-only repairs at the same revision still need review.

## Build

For `BUILD`, create the plan's builder using the initial-spawn example below; for `REPAIR`, continue that same builder with the current review path instead of spawning again:

```text
spawn_agent(task_name="<plan>-build-<n>", agent_type="builder", fork_turns="none",
message="Use $dev-build. Plan: <exact-plan-path>. Execute exactly this plan.
If its current review says CHANGES REQUIRED, address its blocking findings without expanding scope.
Write the authoritative build handoff and stop.")
```

Wait for completion and read `.build.md`.

* `COMPLETED` / `NO CHANGE` -> use `Commit`, or `Base revision` when no commit exists, then `REVIEW`.
* `BLOCKED` / `REQUIRES REPLANNING` -> validate the reason and choose recovery under Convergence; do not automatically terminate.

## Review

Create the plan's independent reviewer against the exact build revision; continue it for subsequent reviews, supplying the original baseline and current findings:

```text
spawn_agent(task_name="<plan>-review-<n>", agent_type="reviewer", fork_turns="none",
message="Use $dev-review. Plan: <exact-plan-path>. Revision: <exact-revision>.
Mode: <INITIAL for first review; REPAIR for follow-ups, including evidence-only repairs>.
Write the authoritative review handoff and stop.")
```

Wait for completion and read `.review.md`. Require exact plan, revision, mode, and recognized verdict.

* `ACCEPTED` -> record revision and immediately advance to the next ready plan.
* `CHANGES REQUIRED` -> `REPAIR`.
* `BLOCKED` / `REQUIRES REPLANNING` -> validate the boundary claim under Convergence.
Do not rewrite findings into new requirements; resolve disputed facts or design directions with evidence and independent review.

## Convergence

There is no repair-round cutoff. Continue actionable in-contract repairs without lowering acceptance or repeating an unchanged failed approach.
If a claimed repair leaves the same failure, require reproduction, a discriminating check, and a changed evidence-backed approach before another patch. Progress is a verified obligation, resolved finding, or causal uncertainty removed, not another commit.
For disputed findings or stalled diagnosis, commission a focused independent review; replace a stuck worker with failed approaches preserved. Do not make every normal review an adjudication.
Resolve implementation choices within the contract. Preserve settled design unless new material evidence justifies reopening it.
Maintain nonbinding guidance, plan boundaries, or dependency order only with independent readiness review and preservation of every obligation and accepted result; never silently change binding commitments.
Validate a proposed technical stop independently: fixable defects return to the builder; unavailable prerequisites need attempted feasible remedies; binding conflicts need the smallest necessary user decision.
Retry an obvious transient launch/runtime failure once; preserve evidence if service remains unavailable. Runtime failure is not a plan defect.
Do not spawn a duplicate while a child is live; a wait timeout alone is not a failed attempt.

## Integrity

Never guess revisions. Use exact revisions from authoritative handoffs or Git.
A `CHANGES REQUIRED` review is valid only with at least one blocking finding containing Requirement, Evidence, Impact, and Required outcome.
Have the same child correct a malformed handoff without repeating completed work; do not route invalid findings to a builder.
Resolve missing or cyclic execution dependencies with independently checked contract-preserving maintenance; escalate only if binding commitments must change.

## Completion

Continue until terminal; never return merely because one child finished.
After all plans pass, request a fresh reviewer for final integration against the approved project contract at exact current HEAD. Require the documented project checks and `<project>/project.review.md`; this is not a fresh architecture audit.
Route concrete final failures to their owning plans at current HEAD; supply the final-review path and owning finding IDs for their repair/review, then repeat affected integration checks with the same final reviewer. Report completion only after final acceptance at the resulting revision.
Success:

```text
Project: <path>
Status: COMPLETED
Final revision: <revision>
Accepted: <plan/revision list>
```

Stop:

```text
Project: <path>
Status: BLOCKED | REQUIRES REPLANNING
Plan: <current-plan>
Revision: <revision-if-applicable>
Reason: <compact-authoritative-reason>
```

Then stop.
