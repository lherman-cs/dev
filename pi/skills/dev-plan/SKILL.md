---
name: dev-plan
description: Compile an approved spec into a clear implementation strategy.
disable-model-invocation: true
---

# dev-plan

Require an explicitly approved spec. Convert it into the smallest coherent independently testable outcomes.

- Git and code reality outrank the plan.
- Choose the simplest durable design that satisfies approved semantics and preserves correctness, robustness, scalability, and long-term maintainability. Do not optimize for implementation cost or diff size at their expense. Avoid unrelated cleanup, but scope principled local rework when patching the current layer would be worse.
- Delete before adding; otherwise reuse existing code, prefer standard/native facilities over existing dependencies, and add the minimum custom code last. Avoid speculative abstractions, flexibility, configuration, wrappers, dependencies, and future-proofing.
- Write compact `project.toon` with identity/base, dependencies, final checks, and status; write `plans/Pxxx.toon` with ID/title/goal, dependencies, scoped requirements, material constraints/non-goals, and deterministic checks.
- Plans define outcomes and an implementation strategy, not mandatory execution steps. The Implementer may adapt sequencing or approach as code reality is discovered while preserving approved semantics, dependencies, and proof.
- Do not duplicate the spec/research transcripts or edit `progress.toon`.
- Replan when discovered reality materially invalidates an outcome, dependency, interface, or proof strategy. Preserve completed plans; replacements get new IDs with `supersedes` when needed.

Before `status: ready`, present a Markdown review through `ask_user_question` with architecture/data flow, important interfaces/invariants, plan graph, outcome + proof for each plan, integration checks, risks, and intentionally untouched areas. Revise until explicit approval.

Stop after approved project metadata and plans.
