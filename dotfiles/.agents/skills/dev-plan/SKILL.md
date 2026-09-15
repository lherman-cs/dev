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
3. Resolve the semantic prerequisites before elaborating tasks: every required validation/default/boundary must have an approved definition or an exact established contract. An unresolved consequential choice returns `SPEC CHANGE REQUIRED` immediately, before writing a detailed plan around it. Use Explorer only for focused facts that would change the plan.
4. Choose the smallest coherent architectural delta; reuse existing adequate patterns and avoid speculative scaffolding.
5. Plan the whole project from the **current repository state**, including work already accepted during a mid-project replan.
6. Define a meaningful baseline validation before Task 1 and one whole-project validation before final review.
7. Self-review for complete spec coverage, correct ordering/dependencies, verified references, contradictions, and unnecessary work. For each task, mentally execute its brief alone: can a fresh Builder reach meaningful RED, implement, and demonstrate acceptance without an unassigned architectural or test-strategy decision? Check fixture construction, production entrypoint, observable assertions, and prerequisite availability, not just command syntax. Resolve gaps before READY; this is the existing self-review, not another artifact or review phase.
8. Only after that bounded self-review set `Status: READY`.

## Task design
- Use natural execution-grade Markdown with one mechanical boundary: every task begins `### Task N: <name>`.
- A task is one coherent behavior with its own meaningful test cycle and review gate, not a file-count or line-count quota. Prefer a thin complete path across layers; include its required setup/config/docs. Split only where the neighboring deliverables can be tested and judged independently.
- Batch adjacent trivial same-shape work when it has one meaningful test/review surface.
- Tasks execute sequentially through review gates. Do not plan parallel Builder execution as the normal path.
- Carry the relevant accepted spec requirements/invariants directly into each task so fresh Builder/Reviewers normally need no full-spec reread.
- Expose risky integration early: use the real entrypoint, transport, or toolchain in the first relevant slice. When the approved design defers activation, specify a narrow seam that exercises the same production path, who removes it, and the later activation dependency; do not plan duplicate implementations just to test an inactive path.
- Treat Builder as a capable engineer unfamiliar with this repository, not the owner of unresolved design decisions. Resolve integration and proof strategy; leave ordinary local coding mechanics to Builder. Keep detail where a wrong choice would invalidate the candidate, not exhaustive instructions for every edit.
- Supply compact verified discovery facts (owning package/manifest, relevant instruction paths, exact validation commands) so each fresh agent can start at the affected code. Keep task prose proportional to its behavior; do not duplicate code or full command output.
- Each extracted task must stand alone: include its relevant requirements, verified paths, commands, environment prerequisites, and observable outcomes. Put project-only baseline/final checks outside task headings; avoid hidden dependencies on a shared preamble or copying the whole spec into tasks.

## Each task must be executable
Include, in the form most useful for that task:
- precise goal, relevant requirements/invariants, and explicit non-goals/deferred behavior where confusion is plausible;
- a small starting map: exact owning files/symbols, directly relevant callers/tests, and verified interfaces; identify existing contracts versus new interfaces this task must introduce;
- ordered implementation steps naming the production entrypoint, integration point, state/data flow, and compatibility obligations where relevant; use a short concrete snippet when prose would leave a consequential choice unresolved;
- concrete proof cases: fixture/construction or existing test to extend, input/action sequence, controlled failure boundary where needed, actual production path exercised, and observable expected result (including state that must remain unchanged). Specify a feasible seam if normal construction is unavailable; do not leave Builder to invent the test architecture;
- strict RED -> GREEN -> REFACTOR behavior, exact focused test command, and the behavioral reason for expected RED and GREEN; a command or “test retries/edge cases” alone is not a test design;
- narrow explicit TDD exception only when a meaningful RED test does not apply (generated/config/docs/spike-like mechanical work), with the strongest useful verification instead;
- task/package/integration validation commands and expected outcomes;
- dependencies and any important compatibility/migration obligations.

Use natural prose or a compact case table, not mandatory subsection boilerplate. Do not copy source files or generic workflow instructions. Verify repository facts and commands; label new symbols as planned rather than existing. A consequential unresolved execution choice prevents READY; future implementation details may be prescribed explicitly without pretending they already exist.

## Replanning
- Small reversible implementation ambiguity and equivalent command/setup corrections belong to `dev-project`, not Planner. A replan requires a demonstrated dependency, shared-interface, or strategy defect; if the assignment contains only a routine correction, return it as a controller ruling without rewriting the plan.
- Task size alone belongs to the controller's operational split path. When a material replan is necessary, inspect the defect and affected dependency neighborhood; preserve unaffected task text instead of re-exploring and rewriting the whole project.
- If implementation exposes a material plan/architecture defect but semantics are unchanged, rewrite the single `plan.md` from current repository truth, self-review, and return it to READY.
- Preserve already accepted work that remains valid; plan corrective work only for what the new plan invalidates.
- If replanning would alter accepted semantics, stop with `SPEC CHANGE REQUIRED`; return the exact decision to the controller for inline human approval or focused spec alignment, rather than requiring a skill switch yourself. After a bounded approved amendment, resume the same planning assignment and update only affected content.

## Explorer and output
- Use Explorer for substantial supporting discovery, not for reading the approved requirements or supplied facts. Keep known-path lookups local; use the [bounded evidence handoff](../dev-project/prompts/explore-facts.md) and inspect decision-critical anchors yourself.
- You may spawn only `explorer`, always with `fork_turns="none"`; never ask it to plan or judge semantics. Independent narrow Explorer questions may run in parallel.
- Do not spawn Builder/Reviewer/Orchestrator or edit production source.
- Return `READY`, `SPEC CHANGE REQUIRED`, or `BLOCKED` with the plan path and only the concrete next action.
