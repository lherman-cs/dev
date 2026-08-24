---
name: dev-build
description: Implement one approved plan from plans/<project>/<NN>-*.md in the current thread and verify it without reopening approved architecture. Use only when explicitly invoked with a project and plan number or plan path.
---

# Dev Build

Implement one approved plan in the current thread.

The plan owns intent, scope, architecture, and acceptance criteria.
This phase owns implementation mechanics and verification.

## Resolve

Accept:

- `project/NN`
- `plans/project/NN-name.md`

Resolve exactly one plan and read it first.

Reuse relevant session and repository context already established.
Do not repeat `dev-plan` investigation.

Read the sibling `spec.md` only when:

- the plan is materially ambiguous; or
- repository reality appears to contradict the plan.

## Implement

Work only within the approved plan.

1. Inspect affected code and nearby dependencies as needed.
2. Prefer plan facts over re-deriving architecture or implementation strategy.
3. Follow existing repository conventions for local mechanics.
4. Make the smallest coherent changes that satisfy the plan.
5. Resolve cheap implementation details directly.
6. Avoid unrelated cleanup or opportunistic refactors.

Do not:

- expand scope;
- reconsider approved architecture;
- weaken requirements;
- modify the plan or spec to justify the implementation;
- broadly reinvestigate the repository.

Minor mechanical deviations are allowed when repository reality requires them and the approved design remains unchanged.

## Verify

Run:

- verification required by the plan;
- cheap checks directly implied by the changes.

Fix implementation-caused failures and rerun relevant checks.

Verification should establish changed behavior, not merely compilation.

## Escalate

Stop rather than silently redesign when a material assumption is wrong.

Classify the problem:

- **build issue** — local implementation is wrong; fix it here;
- **plan issue** — implementation strategy or decomposition is materially wrong; return to `dev-plan`;
- **spec issue** — destination, architecture, invariant, or requirement is materially wrong; return to `dev-spec`.

Do not solve plan or spec problems inside build.

## Output

Optimize output for user review.

On success, report only:

- **Changed** — concise implementation outcome;
- **Verified** — commands/checks and results;
- **Notes** — only material deviations or remaining risks.

Omit:

- implementation narration;
- files touched unless useful;
- reasoning already captured by the plan;
- successful intermediate steps;
- generic summaries.

Do not claim success without fresh verification.

If creating a commit, include:

`Plan: plans/<project>/<NN>-<name>.md`
