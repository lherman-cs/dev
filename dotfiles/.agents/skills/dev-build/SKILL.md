---
name: dev-build
description: Execute one approved plans/<project>/<NN>-*.md through a Luna-high builder under Terra-high supervision. Implement, verify, review the diff, and correct implementation defects without reopening approved architecture.
---

# Dev Build

Execute one approved plan. Terra owns the work; Luna performs implementation.

The plan is authoritative for intent, scope, architecture, and acceptance criteria.

## Resolve

Accept:

- `project/NN`
- `plans/project/NN-name.md`

Resolve exactly one plan and read it first.

Reuse established session and repository context. Do not repeat `dev-plan` investigation.

Read the sibling `spec.md` only when the plan is ambiguous or implementation evidence suggests a plan/spec conflict.

## Delegate

Spawn one `builder` subagent:

- model: `gpt-5.6-luna`
- reasoning effort: `high`
- repository write access

Give it only:

- repository root;
- exact plan path;
- material current-session decisions missing from the plan.

Do not copy the plan into the prompt or replay unnecessary conversation context.

The builder must:

1. Read the plan first.
2. Implement only its approved scope.
3. Inspect only affected code and nearby dependencies.
4. Use repository conventions for local mechanics.
5. Avoid rediscovering architecture or reconsidering approved decisions.
6. Run plan-required verification plus cheap checks directly implied by the change.
7. Fix implementation-caused failures and rerun relevant checks.
8. Report changes, verification, deviations, failures, and risks.

The builder may resolve cheap local implementation details independently.

It must not:

- expand scope;
- redesign;
- weaken requirements;
- perform unrelated cleanup;
- modify the spec or plan to justify the implementation.

If repository reality materially invalidates the plan, stop and report the conflict.

## Review

After Luna returns, Terra reviews the actual diff and fresh verification evidence.

Do not rely on Luna's summary and do not redo broad repository investigation.

Check:

- every plan requirement is implemented;
- acceptance criteria are established by verification;
- ownership, lifecycle, invariants, and data flow match the approved design;
- no required edge or failure path was omitted;
- no unnecessary scope or complexity was introduced;
- no architectural drift is hidden behind passing tests.

Inspect surrounding code only when needed to validate a concern.

## Correct

If the plan is sound but the implementation is wrong, send Luna one narrowly scoped correction containing:

- the concrete defect;
- violated requirement or behavior;
- relevant location when known;
- required outcome.

Do not ask Luna to broadly review or reinterpret the plan.

After correction, rerun relevant verification and inspect the resulting diff.

Avoid open-ended correction loops. If substantial new work keeps emerging, treat that as evidence the plan needs revision.

## Escalate

Classify blockers precisely:

- **build issue** — implementation is wrong; Luna may correct it;
- **plan issue** — implementation strategy or decomposition is materially wrong; return to `dev-plan`;
- **spec issue** — destination, architecture, invariant, or requirement is materially wrong; return to `dev-spec`.

Do not repair plan or spec problems inside `dev-build`.

## Finish

On success, report only:

- what changed;
- verification and results;
- material deviations or remaining risks.

Do not claim success without fresh verification.

If creating a commit, include:

`Plan: plans/<project>/<NN>-<name>.md`
