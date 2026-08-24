---
name: dev-review
description: Independently review a completed diff, commit, branch, or implementation plan result for material defects and deviations from intended behavior. Use explicitly after implementation when a focused fresh review is desired.
---

# Dev Review

Review completed implementation with a fresh, adversarial objective.

Find material defects. Do not restate the implementation or resume building unless explicitly asked.

## Resolve

Determine the narrowest concrete review target:

- working-tree or staged diff;
- commit or commit range;
- branch;
- named files;
- implementation of a named plan.

Read the relevant plan when one exists.

Read `spec.md` only when needed to resolve architectural intent, invariants, or requirements not clear from the plan.

Reuse established context.
Do not repeat broad repository investigation.

## Contract

Judge the implementation against, in order:

1. explicit user decisions;
2. approved spec;
3. approved plan;
4. repository invariants and documented behavior;
5. relevant existing tests and conventions.

Do not invent requirements.

## Inspect

Start from the diff.

Inspect surrounding code, call sites, and data flow only when needed to validate a concern.

Prioritize:

- incorrect or incomplete behavior;
- violated invariants;
- ownership or lifecycle mistakes;
- state-transition and ordering bugs;
- concurrency hazards;
- missing error or cleanup paths;
- API/protocol incompatibility;
- security or performance regressions when relevant;
- missing verification for changed behavior;
- architectural drift;
- accidental scope expansion.

Passing tests are evidence, not proof of correctness.

## Findings bar

Report a finding only when you can establish:

- concrete problematic behavior;
- repository evidence;
- a plausible triggering path;
- the violated contract or resulting harm.

Do not report:

- subjective style;
- optional cleanup;
- speculative future concerns;
- harmless deviations;
- preferences without correctness impact.

Prefer a few high-confidence findings over exhaustive commentary.

## Severity

- **Critical** — catastrophic correctness, security, data-loss, or production failure.
- **High** — material requirement violation or realistic significant failure.
- **Medium** — real defect or robustness issue with bounded impact or likelihood.
- **Low** — concrete minor defect worth fixing.

## Classify

For each material design conflict identify whether it is:

- **implementation issue** — code should change;
- **plan issue** — implementation strategy or decomposition should change;
- **spec issue** — destination or architectural requirement should change.

Do not redesign during review.

## Verify

Run targeted checks only when they materially increase confidence.

Prefer tests or checks directly related to suspected findings.
Avoid unrelated expensive verification.

## Output

Optimize output for actionability.

Lead with findings ordered by severity.

Each finding contains only:

`[Severity] location — defect`

Then briefly explain:

- why it is wrong;
- triggering scenario or violated contract;
- required outcome.

After findings, include only:

- **Verification** — relevant checks performed;
- **Uncertainty** — only meaningful unresolved uncertainty.

If there are no material findings, say:

`No material findings.`

Then mention only meaningful verification gaps, if any.

Do not:

- summarize the implementation;
- repeat the plan;
- praise the code;
- list harmless observations;
- recommend unrelated cleanup.
