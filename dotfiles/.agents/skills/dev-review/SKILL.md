---
name: dev-review
description: Decide whether one numbered plan is satisfied at one exact revision; block only on concrete plan-mapped defects and converge repair reviews.
---

# Dev Review

Review one approved numbered plan at one exact revision. Never modify production code.
The plan is the contract. The goal is an acceptance decision, not a general repository audit. Nonbinding implementation guidance may adapt without changing approved commitments.

## Inputs

For a single-plan code review, require:

* exact plan path;
* exact revision;
* mode: `INITIAL` or `REPAIR`.
  Read the matching `.build.md`. In `REPAIR`, also read the previous `CHANGES REQUIRED` `.review.md`.
  Do not read `spec.md`, sibling plans, or unrelated history during a single-plan code review.
For an explicitly assigned planning review, take the supplied project path and draft contract/plans instead; inspect design, ownership, feasibility, dependency, and verification gaps. No build handoff is required.
For an explicitly assigned final integration review, inspect the project contract and accepted handoffs, run its required integrated checks at the supplied revision, and map failures to their owning plans. Do not invent requirements or reopen settled design without new material evidence.
Use `<project>/project.review.md` for these project-level reviews; identify the assigned scope in the handoff. Planning acceptance is not implementation acceptance.

## Blocking rule

A finding may block only when all are true:

1. it maps to an explicit plan requirement, constraint, or verified precondition;
2. it is a missing required obligation or a defect in/directly caused by the reviewed change;
3. it is reachable under the plan's stated assumptions;
4. leaving it unfixed prevents the plan's acceptance or leaves a demonstrated material regression.
   If any condition fails, it is non-blocking.
   Do not block on style, preference, optional hardening, hypothetical future behavior, unrelated pre-existing defects, or extra tests when existing evidence proves the contract.
Initial design review may also require a substantially better conforming approach: identify the concrete alternative, approved outcome it serves, material benefit, and replacement cost. Settle disputed design with the parent; reopening it requires new material evidence, not a different preference.

## Review scope

For `INITIAL`:

1. Read the plan and build evidence once.
2. Inspect the full plan change from its original baseline, not just its latest repair commit, and only necessary surrounding source.
3. Check each explicit acceptance obligation and direct regressions caused by the change.
4. Run only focused verification needed to resolve a concrete uncertainty.
5. Batch all substantiated blockers in this pass; accept immediately when obligations are verified and none remain.

Use at most one fresh `explorer` with `fork_turns="none"` only for one concrete repository fact required to decide acceptance.
Never ask it to broadly review, find bugs, or propose improvements.

For `REPAIR`:

1. Retain finding IDs and closure conditions; check fixes and counterevidence against the exact supplied revision, which may be unchanged for evidence-only repairs.
2. Inspect only the repair delta and source needed to validate those fixes.
3. Check for contract-blocking regressions directly introduced or made reachable by the repair.
4. Do not restart broad initial review.
5. Do not add unrelated pre-existing findings or reopen settled design without new material evidence.
Do not hide a demonstrated material defect merely because the initial review missed it; explain the new evidence and contract impact. Record resolved/refuted IDs with evidence, withdraw disproven findings, and explain why any claimed fix remains insufficient.

## Replanning

Use `REQUIRES REPLANNING` only when binding requirements conflict or acceptance requires a consequential unapproved decision; show why no conforming implementation resolves it. A false implementation assumption alone is not replanning.
Use `BLOCKED` for a concrete unavailable verification prerequisite, recording feasible remedies attempted; never substitute acceptance for missing required evidence.
Implementation difficulty is not replanning.

## Verdict

Use exactly:

* `ACCEPTED` — contract satisfied; advance.
* `CHANGES REQUIRED` — one or more blocking findings remain.
* `REQUIRES REPLANNING` — contract must change.
* `BLOCKED` — required verification is prevented by an unavailable prerequisite.
  Acceptance means this plan is complete, not that the subsystem is perfect.

## Handoff

Write the matching `.review.md`:

```markdown
# Review
Plan: <path>
Revision: <revision>
Mode: INITIAL | REPAIR
Verdict: ACCEPTED | CHANGES REQUIRED | REQUIRES REPLANNING | BLOCKED
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
Report the verdict, evidence path, and unresolved finding IDs. Finish this assigned turn; retain established evidence for same-plan follow-ups.
