---
name: dev-review
description: Independently review the current implementation against its approved plan and project spec. Use only when explicitly invoked, normally with no arguments after dev-build.
---

# Dev Review

Independently review the implementation against repository evidence, its plan, and its spec.

## Resolve scope

Determine the relevant plan in this order:

1. explicit plan supplied by the user;
2. `Plan:` trailer on the relevant implementation commit;
3. changed files and repository context, but only when they identify exactly one plan.

If multiple plans remain plausible, stop and report the ambiguity rather than guessing.

## Gather context

Start with only:

- the resolved plan;
- its sibling `spec.md`;
- the implementation diff;
- directly affected repository code.

Expand repository investigation only when a potential finding or unresolved question requires it.

Do not rely on the builder's summary or explanation as evidence.

## Review

Check for material:

- correctness defects and regressions;
- unmet spec requirements;
- unmet plan requirements;
- violated invariants;
- missing or inadequate verification;
- unintended scope;
- unnecessary complexity that harms the design.

Run targeted verification when it materially increases confidence.

Ignore cosmetic preferences unless they violate repository conventions or materially affect maintainability.

If the implementation correctly follows a flawed plan, identify the plan gap.
If the plan faithfully implements a flawed destination, identify the spec gap.

## Output

Return exactly one of:

`PASS`

or findings ordered by severity.

Each finding must include:

- concrete evidence or location;
- impact;
- required correction.

Return `PASS` only when no material findings remain and available verification provides sufficient evidence for the plan's `Done when` criteria.

Do not edit code unless explicitly asked.
Do not accept builder explanations as evidence.
