```markdown
---
name: dev-review
description: Independently review a diff, branch, commit range, or completed plan for material correctness defects, architectural drift, and missing verification. Use explicitly when a fresh review is desired outside the normal dev-build supervision loop.
---

# Dev Review

Review completed implementation as a senior engineer.

Find material defects. Do not restate the implementation or turn review into planning.

## Resolve

Determine the narrowest concrete review target:

- working-tree or staged diff;
- commit or commit range;
- branch;
- named files;
- implementation for a named plan.

Read the relevant plan when one exists.

Read `spec.md` only when needed to resolve architectural intent, invariants, or requirements not clear from the plan.

Reuse established context. Do not broadly reinvestigate the repository merely to reconstruct it.

## Establish the contract

Judge the change against, in order:

1. explicit user decisions;
2. approved spec;
3. approved plan;
4. repository invariants and documented behavior;
5. existing tests and conventions.

Do not invent requirements.

Separate:

- correctness defects;
- material risks;
- optional improvements;
- style preferences.

Only the first two belong in findings.

## Inspect

Start from the diff.

Inspect surrounding code, call sites, and data flow only as needed to prove or disprove a concern.

Prioritize:

- correctness;
- ownership and lifecycle;
- state transitions and ordering;
- concurrency;
- error and cleanup paths;
- API/protocol compatibility;
- security boundaries;
- performance-sensitive behavior;
- changed-behavior test coverage;
- accidental scope expansion;
- architectural drift;
- unnecessary complexity that creates concrete risk.

When a plan exists, verify that the implementation:

- completes every required change;
- preserves its invariants;
- satisfies its acceptance criteria;
- follows required ownership and data flow;
- does not weaken requirements or substitute an unapproved design.

Passing tests are evidence, not proof of plan completion.

## Validate findings

Report a finding only when you can establish:

1. concrete behavior;
2. repository evidence;
3. a plausible triggering scenario;
4. the violated contract or resulting harm.

Do not report speculative concerns, subjective style, or hypothetical future problems without a concrete failure path.

Prefer a few high-confidence findings over exhaustive commentary.

## Severity

- **Critical** — catastrophic correctness, security, data-loss, or production failure.
- **High** — material requirement violation or realistic path to significant incorrect behavior.
- **Medium** — real defect or meaningful robustness issue with limited impact or likelihood.
- **Low** — concrete minor defect worth fixing.

Do not assign severity to cleanup or preferences.

## Classify

For architectural conflicts, identify the failing layer:

- **implementation issue** — code should change;
- **plan issue** — implementation strategy or decomposition should change;
- **spec issue** — destination, architecture, invariant, or requirement should change.

Do not redesign during review unless explicitly asked.

## Verify

Run targeted checks when they materially increase confidence:

- tests covering changed behavior;
- focused compile/type/lint checks;
- required simulations or benchmarks.

Avoid expensive unrelated verification.

State uncertainty when evidence is insufficient.

## Output

Lead with findings ordered by severity.

Each finding should contain:

- severity;
- concise defect;
- concrete location;
- why it is wrong;
- triggering scenario or violated contract;
- required outcome.

Then state briefly:

- verification performed;
- unresolved uncertainty.

If there are no material findings, say so directly and mention any meaningful verification gap.

Do not repeat the plan.
Do not provide generic praise.
Do not recommend unrelated cleanup.
```
