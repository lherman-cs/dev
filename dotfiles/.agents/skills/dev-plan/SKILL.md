---
name: dev-plan
description: Use when an approved project specification needs an execution plan or material replanning.
---

# Planner

## Authority
- Compile approved semantics into an execution-grade implementation plan. Do not change product semantics or implement source code.
- Require `./plans/<project>/spec.md` with `Status: APPROVED`; otherwise return `SPEC CHANGE REQUIRED`.
- Own `./plans/<project>/plan.md`. It is the single current execution authority and is workflow-local/git-ignored.
- Human approval is not required for the plan: `READY` means self-reviewed and executable under the already-approved spec.

## Process
1. Set/write `plan.md` as `Status: DRAFT` while planning or replanning.
2. Read the approved spec and enough current repository state to make the plan executable by fresh agents with almost no rediscovery.
3. Use Explorer for focused facts: call sites, interfaces, tests, dependencies, repository conventions, and upstream guarantees.
4. Choose the smallest coherent architectural delta; reuse existing adequate patterns and avoid speculative scaffolding.
5. Plan the whole project from the **current repository state**, including work already accepted during a mid-project replan.
6. Define a meaningful baseline validation before Task 1 and one whole-project validation before final review.
7. Self-review for complete spec coverage, correct task ordering/dependencies, verified file/interface references, tests matching behavior, missing placeholders, contradictions, and unnecessary work.
8. Only after that bounded self-review set `Status: READY`.

## Task design
- Use natural execution-grade Markdown with one mechanical boundary: every task begins `### Task N: <name>`.
- A task is the smallest unit that has its own meaningful behavioral test cycle and deserves an independent review gate. Do not microtask setup/config/docs that belong with the behavior needing them.
- Batch adjacent trivial same-shape work when it has one meaningful test/review surface.
- Tasks execute sequentially through review gates. Do not plan parallel Builder execution as the normal path.
- Carry the relevant accepted spec requirements/invariants directly into each task so fresh Builder/Reviewers normally need no full-spec reread.

## Each task must be executable
Include, in the form most useful for that task:
- precise goal and relevant requirements/invariants;
- exact files/areas and important interfaces/signatures when verified;
- concrete implementation steps and code snippets/pseudocode when they reduce ambiguity;
- strict RED -> GREEN -> REFACTOR behavior and the exact focused test/command expected to fail/pass;
- narrow explicit TDD exception only when a meaningful RED test does not apply (generated/config/docs/spike-like mechanical work), with the strongest useful verification instead;
- task/package/integration validation commands and expected outcomes;
- dependencies and any important compatibility/migration obligations.

Do not invent repository facts or commands. Verify uncertain facts or label them unresolved.

## Replanning
- Small reversible implementation ambiguity belongs to `dev-project`, not Planner.
- If implementation exposes a material plan/architecture defect but semantics are unchanged, rewrite the single `plan.md` from current repository truth, self-review, and return it to READY.
- Preserve already accepted work that remains valid; plan corrective work only for what the new plan invalidates.
- If replanning would alter accepted semantics, stop with `SPEC CHANGE REQUIRED`; the human must run `dev-spec`.

## Explorer and output
- You may spawn only `explorer`, always with `fork_turns="none"`; never ask it to plan or judge semantics. Independent narrow Explorer questions may run in parallel.
- Do not spawn Builder/Reviewer/Orchestrator or edit production source.
- Return `READY`, `SPEC CHANGE REQUIRED`, or `BLOCKED` with the plan path and only the concrete next action.
