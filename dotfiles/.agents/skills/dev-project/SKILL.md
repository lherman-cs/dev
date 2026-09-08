---
name: dev-project
description: Drive one approved multi-plan project through fresh isolated build and review agents until every plan is accepted or execution is blocked.
---

# Dev Project

Drive one existing project plan set to completion.

Planning is outside this workflow. Numbered plans are approved contracts.

Require one exact project directory under `plans/`.

## Role

Own execution of the project-level build/review loop.

Do not:

* implement production code;
* review code;
* modify plans or `spec.md`;
* reinterpret acceptance criteria;
* redesign or replan.

If the approved plans cannot be executed as written, stop with `REQUIRES REPLANNING`.

## Required agents

Use only these execution agents:

* `builder` — implements one numbered plan using `$dev-build`;
* `reviewer` — independently reviews one numbered plan and exact revision using `$dev-review`.

Every build and review attempt must be a fresh agent with:

```text
fork_turns="none"
```

Never resume or continue a previous builder or reviewer.

## Context boundary

Keep the orchestrator focused on workflow state.

Consume only:

* numbered plan paths;
* declared dependencies;
* matching `.build.md` and `.review.md`;
* exact Git revisions;
* compact child results.

Do not inspect production code, diffs, tests, repository architecture, or child reasoning.

Builders and reviewers own repository understanding.

## Project discovery

Enumerate numbered plans in the supplied project directory.

Exclude:

* `spec.md`;
* `*.build.md`;
* `*.review.md`;
* unrelated workflow files.

Execute plans in dependency order, preferring the lowest-numbered ready plan.

A plan is ready only when all declared plan dependencies are accepted.

Do not speculatively execute later plans.

## Build

For a ready or rejected plan, spawn exactly one fresh builder:

```text
spawn_agent(
    agent_type="builder",
    fork_turns="none",
    message="""
Use $dev-build.

Plan:
<exact-plan-path>

Execute exactly this numbered plan and stop after writing its build evidence.
"""
)
```

Wait for the builder to finish.

Use its matching `.build.md` as the authoritative handoff.

Recognized build states:

* `COMPLETED`
* `NO CHANGE`
* `BLOCKED`
* `REQUIRES REPLANNING`

For `COMPLETED` or `NO CHANGE`, identify the exact resulting revision and review it.

For `BLOCKED` or `REQUIRES REPLANNING`, stop the project.

Do not implement, diagnose, or repair the build yourself.

## Review

After a completed build, spawn exactly one fresh reviewer:

```text
spawn_agent(
    agent_type="reviewer",
    fork_turns="none",
    message="""
Use $dev-review.

Plan:
<exact-plan-path>

Revision:
<exact-build-revision>

Independently review exactly this plan at exactly this revision and stop after
writing its review evidence.
"""
)
```

Wait for the reviewer to finish.

Use its matching `.review.md` as the authoritative handoff.

The review must target the exact revision supplied.

Recognized verdicts:

* `ACCEPTED`
* `CHANGES REQUIRED`
* `REQUIRES REPLANNING`

Only `ACCEPTED` completes a plan.

## Feedback loop

On `CHANGES REQUIRED`, do not resume the previous builder.

Spawn another fresh builder:

```text
spawn_agent(
    agent_type="builder",
    fork_turns="none",
    message="""
Use $dev-build.

Plan:
<exact-plan-path>

The current matching review artifact contains required changes.
Address the approved plan plus those review findings, then stop after writing
new build evidence.
"""
)
```

The builder consumes the durable `.review.md` directly.

Do not summarize, rewrite, prioritize, or reinterpret review findings.

Then spawn a fresh reviewer against the new exact revision.

The loop is:

```text
builder A
    |
    v
revision R1
    |
    v
reviewer A(R1)
    |
    +-- ACCEPTED ----------> next plan
    |
    +-- CHANGES REQUIRED
            |
            v
        builder B
            |
            v
        revision R2
            |
            v
        reviewer B(R2)
```

Every box is a separate isolated agent.

## Main loop

Repeat:

1. Reconstruct current state from plans, handoffs, and Git.
2. Find the lowest-numbered executable incomplete plan.
3. If it needs building, spawn `builder`.
4. If its latest build needs review, spawn `reviewer`.
5. On `CHANGES REQUIRED`, spawn a fresh `builder`.
6. On `ACCEPTED`, advance to the next plan.
7. Continue until the entire project completes or a stop condition occurs.

Do not return merely because one child agent completed.

Drive the project continuously.

## Convergence

Continue normal build/review repair while the existing plan remains executable.

Stop with `REQUIRES REPLANNING` when:

* satisfying review requires changing the plan;
* a verified plan assumption is invalid;
* dependencies are missing, contradictory, or cyclic;
* a builder or reviewer reports `REQUIRES REPLANNING`;
* repeated attempts show no substantive progress toward the contract.

Do not invent a new contract to force convergence.

## Failures

Retry once with a fresh agent only for an obvious transient execution failure that produced no authoritative handoff.

Do not treat:

* failed tests;
* implementation defects;
* review findings;
* repository contradictions;
* plan defects

as transient failures.

Never skip review or advance dependent plans around a failure.

## Completion

A plan is complete only when its latest build revision has an `ACCEPTED` review.

The project is complete only when every active numbered plan is complete.

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
Plan: <current-plan>
Revision: <revision-if-applicable>
Reason: <compact-authoritative-reason>
```

Then stop.
