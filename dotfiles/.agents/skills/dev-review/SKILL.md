---
name: dev-review
description: Decide whether one numbered plan is satisfied at one exact revision; block only on concrete plan-mapped defects and converge repair reviews.
---

# Dev Review

Review one approved numbered plan at one exact revision. Never modify production code.
The plan is the contract. The goal is an acceptance decision, not a general repository audit.

## Inputs

Require:

* exact plan path;
* exact revision;
* mode: `INITIAL` or `REPAIR`.
  Read the matching `.build.md`. In `REPAIR`, also read the previous `CHANGES REQUIRED` `.review.md`.
  Do not read `spec.md`, sibling plans, or unrelated history.

## Blocking rule

A finding may block only when all are true:

1. it maps to an explicit plan requirement, constraint, or verified precondition;
2. it is a missing required obligation or a defect in/directly caused by the reviewed change;
3. it is reachable under the plan's stated assumptions;
4. leaving it unfixed prevents the plan's acceptance.
   If any condition fails, it is non-blocking.
   Do not block on style, preference, optional hardening, hypothetical future behavior, unrelated pre-existing defects, or extra tests when existing evidence proves the contract.

## Review scope

For `INITIAL`:

1. Read the plan and build evidence once.
2. Inspect the material human-authored diff and only necessary surrounding source.
3. Check each explicit acceptance obligation and direct regressions caused by the change.
4. Run only focused verification needed to resolve a concrete uncertainty.
5. Decide the verdict.

Use at most one fresh `explorer` with `fork_turns="none"` only for one concrete repository fact required to decide acceptance.
Never ask it to broadly review, find bugs, or propose improvements.

For `REPAIR`:

1. Review the previous blocking findings against the new revision.
2. Inspect only the repair delta and source needed to validate those fixes.
3. Check for contract-blocking regressions directly introduced or made reachable by the repair.
4. Do not restart broad initial review.
5. Do not add unrelated pre-existing findings.
   A new repair blocker is allowed only when caused by the repair delta and it satisfies the Blocking rule.

## Replanning

Use `REQUIRES REPLANNING` only when the approved contract itself must change: a material precondition is false, requirements conflict, or acceptance requires a consequential decision absent from the plan.
Implementation difficulty is not replanning.

## Verdict

Use exactly:

* `ACCEPTED` — contract satisfied; advance.
* `CHANGES REQUIRED` — one or more blocking findings remain.
* `REQUIRES REPLANNING` — contract must change.
  Acceptance means this plan is complete, not that the subsystem is perfect.

## Handoff

Write the matching `.review.md`:

```markdown
# Review
Plan: <path>
Revision: <revision>
Mode: INITIAL | REPAIR
Verdict: ACCEPTED | CHANGES REQUIRED | REQUIRES REPLANNING
```

For `CHANGES REQUIRED`, add:

```markdown
## Blocking findings
| ID | Requirement | Evidence | Impact | Required outcome |
|---|---|---|---|---|
| R1 | <plan item> | `<path>::<symbol>` — <fact> | <contract failure> | <required state> |
```

Every blocking finding must contain every field. Omit non-blocking observations.
For `REQUIRES REPLANNING`, state the exact contract conflict and concrete evidence.
Report the verdict and blocking findings only. Then stop.
