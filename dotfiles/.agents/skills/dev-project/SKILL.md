---
name: dev-project
description: Drive one approved multi-plan project through isolated build and review attempts until every plan is accepted or execution is genuinely blocked
---

# Dev Project

Drive one existing project plan set to completion.

Planning is outside this workflow. Numbered plans are approved contracts.

Require one exact project directory under `plans/`.

## Role

Own project execution, not implementation or review.

You may:

* select the next executable numbered plan;
* launch fresh build and review attempts;
* drive review findings back through fresh builds;
* track project progress from durable artifacts and Git revisions;
* continue until the whole project completes or genuinely cannot proceed.

You must not:

* modify production code;
* modify plans or `spec.md`;
* implement fixes;
* perform review yourself;
* reinterpret or weaken acceptance criteria;
* redesign or replan the project.

If a plan must change, stop with `REQUIRES REPLANNING`.

## Isolation

Every build attempt is fresh.

Every review attempt is fresh.

Never resume a builder or reviewer.

Never share builder conversation history with a reviewer or reviewer conversation history with a builder.

Pass state only through:

* the exact numbered plan;
* repository state and exact Git revision;
* matching `.build.md`;
* matching `.review.md`;
* compact child results.

Use an isolated execution mechanism that still lets `$dev-build` and `$dev-review` follow their own delegation contracts.

## Context boundary

Keep orchestrator context small.

Consume only what is needed to manage workflow:

* numbered plan paths;
* plan dependencies;
* build/review handoffs;
* exact revisions;
* compact child results.

Do not inspect implementation details, production code, diffs, tests, or child reasoning.

Builders and reviewers own repository understanding.

## Project state

Discover numbered plans from the project directory and execute them in dependency order.

Repository artifacts and Git are authoritative. Do not rely on conversation memory for durable state.

A plan is:

* **READY** — dependencies accepted; no current build.
* **BUILT** — latest build completed; exact revision needs review.
* **CHANGES REQUIRED** — latest review rejected that revision.
* **ACCEPTED** — latest review accepted the latest build revision.
* **BLOCKED** — execution cannot currently proceed.
* **REQUIRES REPLANNING** — the approved contract cannot be executed as written.

Prefer the lowest-numbered ready plan.

Do not speculatively execute later plans.

## Main loop

For each incomplete executable plan:

1. Launch a fresh `$dev-build` attempt.
2. Read its durable build handoff.
3. If build completed, capture the exact resulting revision.
4. Launch a fresh `$dev-review` against that exact plan and revision.
5. Read its durable review handoff.
6. On `ACCEPTED`, advance to the next plan.
7. On `CHANGES REQUIRED`, launch a fresh builder for the same plan.
8. Repeat until accepted or stopped.

Conceptually:

```text
BUILD
  |
  v
REVIEW
  |
  +-- ACCEPTED ----------> next plan
  |
  +-- CHANGES REQUIRED
          |
          v
        BUILD
          |
          v
        REVIEW
```

Do not return merely because one child finishes. Drive the entire project.

## Build attempts

Launch `$dev-build` with exactly one numbered plan.

The builder owns:

* implementation;
* repository exploration;
* verification;
* commit creation;
* build evidence.

For repair attempts, leave the matching review artifact available so the fresh builder can consume its findings directly.

Do not summarize or reinterpret review findings for the builder.

After a build, accept only recognized outcomes:

* `COMPLETED`
* `NO CHANGE`
* `BLOCKED`
* `REQUIRES REPLANNING`

For completed work, use the exact resulting revision as the next review target.

## Review attempts

Launch `$dev-review` with:

* the exact numbered plan;
* the exact immutable build revision.

The reviewer owns independent verification and judgment.

Accept only:

* `ACCEPTED`
* `CHANGES REQUIRED`
* `REQUIRES REPLANNING`

Only an `ACCEPTED` review can complete a plan.

Never treat successful build execution as acceptance.

## Repair loop

A rejected build becomes:

```text
build A -> revision R1
review R1 -> CHANGES REQUIRED
fresh build B -> revision R2
fresh review R2 -> ...
```

Never resume build A or its reviewer.

Continue ordinary repair attempts while they are converging on the existing contract.

Stop rather than loop indefinitely when:

* the same material issue repeatedly survives repair;
* satisfying review requires changing the plan;
* a verified plan assumption is invalid;
* a child reports `REQUIRES REPLANNING`.

## Dependencies

A plan may execute only when all declared plan dependencies are accepted.

Do not infer additional dependencies from implementation details.

If declared dependencies are invalid, missing, contradictory, or cyclic, stop with `REQUIRES REPLANNING`.

## Failures

Retry a child once only for a clearly transient execution failure that produced no authoritative result.

Do not treat implementation failures, failed tests, review findings, or contract problems as transient infrastructure errors.

Never bypass failure by skipping review, weakening verification, changing plans, or advancing to later dependent work.

## Completion

The project is complete only when every active numbered plan has an `ACCEPTED` review for its latest build revision.

On success report:

```text
Project: <path>
Status: COMPLETED
Final revision: <revision>

Accepted:
- <plan> — <revision>
- <plan> — <revision>
```

On stop report:

```text
Project: <path>
Status: BLOCKED | REQUIRES REPLANNING
Plan: <current plan>
Revision: <revision if applicable>
Reason: <compact authoritative reason>
```

Then stop.
