---
name: dev-build-supervised
description: Execute one approved plans/<project>/<NN>-*.md through a Luna-high builder under Terra-high supervision. Terra owns scope and acceptance; Luna implements and verifies; Terra reviews the resulting diff and controls corrections.
---

# Dev Build Supervised

Execute one approved plan through a constrained Luna-high builder.

Terra owns the work.
Luna performs implementation.
The approved plan owns intent, scope, architecture, and acceptance criteria.

## Resolve

Accept:

- `project/NN`
- `plans/project/NN-name.md`

Resolve exactly one plan and read it first.

Reuse established session and repository context.
Do not repeat `dev-plan` investigation.

Read the sibling `spec.md` only when:

- the plan is materially ambiguous; or
- implementation evidence suggests a plan/spec conflict.

## Delegate

Spawn exactly one `builder` subagent with:

- model: `gpt-5.6-luna`
- reasoning effort: `high`
- repository write access

Give it only:

- repository root;
- exact plan path;
- material current-session decisions absent from the plan.

Do not copy the plan into the prompt.
Do not replay unnecessary conversation history.

The builder must read the plan first.

Its contract is:

1. Implement only the approved scope.
2. Inspect only affected code and nearby dependencies.
3. Treat plan decisions as authoritative.
4. Resolve cheap local implementation mechanics independently.
5. Follow repository conventions where compatible with the plan.
6. Run plan-required verification plus cheap checks implied by the changes.
7. Fix implementation-caused failures and rerun relevant checks.
8. Report only:
   - implementation outcome;
   - verification and results;
   - material deviations;
   - blockers or remaining risks.

The builder must not:

- expand scope;
- redesign approved architecture;
- weaken requirements;
- perform unrelated cleanup;
- modify the spec or plan to justify its implementation;
- silently work around a material plan conflict.

If repository reality materially invalidates the approved approach, stop and report it.

## Supervise

Do not shadow Luna's implementation or duplicate its repository investigation.

After Luna returns, inspect:

- the actual diff;
- fresh verification evidence;
- affected surrounding code only as needed;
- the approved plan.

Review for:

- missing plan requirements;
- incorrect behavior;
- ownership or lifecycle mistakes;
- violated invariants;
- architectural drift;
- omitted failure or cleanup paths;
- unnecessary scope or complexity;
- verification that passes without establishing required behavior.

Do not rely on Luna's summary as evidence.

Do not redo `dev-plan` unless the implementation exposes evidence that the plan itself is wrong.

## Correct

If the plan remains sound but the implementation has a concrete defect, send Luna one narrowly scoped correction.

Include only:

- the defect;
- violated requirement or behavior;
- relevant location when known;
- required outcome.

Do not ask Luna to broadly reconsider or review the implementation.

After correction:

1. rerun relevant verification;
2. inspect the corrected diff;
3. decide whether the plan is complete.

Prefer one correction round.

If substantial new work or repeated corrections are required, stop and treat that as evidence of a plan problem rather than entering an open-ended supervision loop.

## Escalate

Classify material problems:

- **build issue** — implementation is wrong; Luna may correct it;
- **plan issue** — implementation strategy or decomposition is materially wrong; return to `dev-plan`;
- **spec issue** — destination, architecture, invariant, or requirement is materially wrong; return to `dev-spec`.

Do not repair plan or spec problems inside this skill.

## Output

Optimize conversation output for user review.

On success, report only:

- **Changed** — concise implementation outcome;
- **Verified** — checks and results;
- **Review** — only material findings corrected or remaining risks.

On failure, report only:

- blocker;
- whether it is a build, plan, or spec issue;
- evidence requiring escalation.

Do not narrate implementation progress.
Do not repeat the plan.
Do not list harmless observations.
Do not claim success without fresh verification.

If creating a commit, include:

`Plan: plans/<project>/<NN>-<name>.md`
