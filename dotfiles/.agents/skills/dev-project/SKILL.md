---
name: dev-project
description: Drive one approved multi-plan project through bounded build/review loops, advancing immediately after each accepted plan.
---

# Dev Project

Drive one approved project directory under `plans/` to completion. Numbered plans are contracts; planning is outside this workflow.

## Role

Own dependency order, child sequencing, exact revisions, handoffs, retries, and advancement.
Do not implement, review code, inspect diffs/tests, modify plans or `spec.md`, diagnose child work, redesign, or replan.
Use only fresh `builder` and `reviewer` agents with `fork_turns="none"`. Never resume or follow up an old child.

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
  A review applies only to its exact revision. Once accepted, a plan stays accepted; later `HEAD` movement never reopens it.

## Build

For `BUILD` or `REPAIR`, spawn one fresh builder:

```text
spawn_agent(task_name="<plan>-build-<n>", agent_type="builder", fork_turns="none",
message="Use $dev-build. Plan: <exact-plan-path>. Execute exactly this plan.
If its current review says CHANGES REQUIRED, address its blocking findings without expanding scope.
Write the authoritative build handoff and stop.")
```

Wait for completion and read `.build.md`.

* `COMPLETED` / `NO CHANGE` -> require exact revision, then `REVIEW`.
* `BLOCKED` -> stop `BLOCKED`.
* `REQUIRES REPLANNING` -> stop `REQUIRES REPLANNING`.
  Do not diagnose or repair the build yourself.

## Review

Spawn one fresh reviewer against the exact build revision:

```text
spawn_agent(task_name="<plan>-review-<n>", agent_type="reviewer", fork_turns="none",
message="Use $dev-review. Plan: <exact-plan-path>. Revision: <exact-revision>.
Mode: INITIAL if this plan has no prior CHANGES REQUIRED review; otherwise REPAIR.
Write the authoritative review handoff and stop.")
```

Wait for completion and read `.review.md`. Require exact plan, revision, mode, and recognized verdict.

* `ACCEPTED` -> record revision and immediately advance to the next ready plan.
* `CHANGES REQUIRED` -> `REPAIR`.
* `REQUIRES REPLANNING` -> stop.
  Do not reinterpret, expand, or prioritize findings.

## Convergence

Allow at most two repair rounds per plan. `$dev-review` must use bounded repair review rather than reopening broad review.
If the second repair review still says `CHANGES REQUIRED`, stop `BLOCKED`: `review loop did not converge within two repair rounds`.
Retry once with a fresh same-role agent only when launch/runtime fails before a valid handoff, or the handoff is malformed.
Do not retry tests, defects, review findings, repository contradictions, `BLOCKED`, or `REQUIRES REPLANNING`.
Do not spawn a duplicate while a child is live; runtime failure without a handoff is an execution failure.

## Integrity

Never guess revisions. Use exact revisions from authoritative handoffs or Git.
A `CHANGES REQUIRED` review is valid only with at least one blocking finding containing Requirement, Evidence, Impact, and Required outcome.
Retry an invalid review once; if invalid again, stop `BLOCKED`.
Missing, contradictory, or cyclic declared dependencies -> `REQUIRES REPLANNING`.

## Completion

Continue until terminal; never return merely because one child finished.
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
