---
name: dev-plan
description: Compile an approved spec into small, independently testable implementation outcomes.
disable-model-invocation: true
---

# dev-plan

Require an explicitly approved spec.

- Code and Git reality outrank assumptions.
- Choose the simplest durable design that satisfies the spec and preserves correctness, robustness, scalability, and maintainability. Avoid unrelated cleanup and speculative abstraction.
- Delete before adding; otherwise reuse existing code, prefer standard/native facilities, then existing dependencies, and add custom code last.
- Break the work into the smallest coherent independently testable outcomes, with dependencies only where they materially matter.
- Resolve the architecture, interfaces, ownership, invariants, constraints, risks, and proof needed to make each outcome straightforward to implement.
- Write compact `plans/<project>/plan.md` with the implementation strategy, outcome breakdown, dependencies, material constraints/non-goals, and deterministic proof. Do not duplicate the spec/research or track progress/status.
- The plan guides implementation rather than controlling it. The Builder may adapt sequencing or approach when code reality demands it without changing approved semantics or required outcomes.

Before approval, present the architecture/data flow, important interfaces/invariants, outcome breakdown/dependencies, proof, risks, and intentionally untouched areas through `ask_user_question`. Revise until explicitly approved.

Stop after the approved plan.
