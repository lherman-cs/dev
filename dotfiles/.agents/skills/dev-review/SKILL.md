---
name: dev-review
description: Independently review a change for correctness, formatting, and testing with a fast human-oriented verdict and only high-impact findings.
---

# Dev Review

Review the requested change independently and optimize the result for human attention.

Tenets:

1. Robustness first.
2. Simple by design.
3. Performance without cleverness.

Default scope is the target diff against its numbered plan and `spec.md`. Expand only when necessary to establish correctness or when the user asks for broader review.

Do not modify code unless explicitly asked.

## Exploration

Use explorers when additional repository context is needed.

* `fork_turn = false` / no fork.
* Multiple explorers are allowed.
* Give each explorer one narrow review question.
* Prefer parallel explorers for independent concerns.
* Require compact conclusions, evidence, and exact paths/symbols.
* Do not dump broad repository context.
* Do not repeat already-established exploration.

## Review

Evaluate:

### Correctness

Check behavior, invariants, edge cases, failure handling, ownership, integration, regressions, and compliance with the plan/spec.

Matching a bad plan is not sufficient. If the plan or spec itself creates a material correctness or design problem, say so and recommend rework.

### Formatting

Check repository formatting, lint, naming, and established conventions.

Do not waste review attention on subjective style trivia already handled mechanically.

### Testing

Check both:

* whether appropriate verification was run;
* whether the tests meaningfully prove the changed behavior.

Run focused verification when cheap or when evidence is insufficient. Do not automatically rerun expensive broad suites.

## Simplicity

Flag unnecessary abstractions, duplication, speculative machinery, unnecessary dependencies, or clever performance work when they create material maintenance or correctness cost.

Do not manufacture nitpicks merely to produce findings.

## Output

Lead with exactly one clear verdict:

* `PASS`
* `FIX`
* `REWORK`

Follow with a concise summary of the change and overall quality.

Surface only findings that materially affect correctness, robustness, maintainability, testing confidence, or the requested scope.

For every finding, state:

* the concrete issue;
* its practical consequence;
* the recommended action;
* precise code location when available.

Order findings by impact.

Omit low-value observations unless the user requests exhaustive review.

End with exactly one recommendation:

* `MERGE`
* `FIX THEN MERGE`
* `REWORK`

A clean review should be brief. Say plainly when no material issues were found.

Adapt depth to the user's requested scope while keeping the result fast and delightful to scan.
