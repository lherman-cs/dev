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
- Break the work into the smallest coherent independently testable outcomes, explicit enough to serve directly as implementation TODOs, with dependencies only where they materially matter.
- Resolve every consequential implementation decision the Builder should not need to make: architecture, code touchpoints, existing abstractions to reuse/change/remove, interfaces, ownership, data/control flow, invariants, constraints, risks, and proof.
- Make each outcome explicit about the required changes and deterministic done criteria so implementation is primarily execution rather than design.
- Write compact `plans/<project>/plan.md` with the implementation strategy, outcome breakdown, dependencies, material constraints/non-goals, and deterministic proof. Do not duplicate the spec/research or track progress/status.
- The resolved design and required outcomes are binding. The Builder may adapt sequencing and local mechanics when code reality demands it, but must not silently change approved semantics, architecture, ownership, invariants, or scope; surface any material contradiction instead.

Before approval, present the architecture/data flow, important interfaces/invariants, outcome breakdown/dependencies, proof, risks, and intentionally untouched areas through `ask_user_question`. Revise until explicitly approved.

Stop after the approved plan.
