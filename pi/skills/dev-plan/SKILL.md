---
name: dev-plan
description: Make a decision-complete implementation plan from the request, repository and any applicable spec.
disable-model-invocation: true
---

# dev-plan

Plan the requested outcome. An approved spec is useful when available, not a prerequisite.

- Read `../references/reconcile.md` at entry. Reconstruct required semantics from the request, repository state, conventions, and evidence; follow an applicable approved spec if one exists. Ask only when consequential product semantics, scope, or authority remain unresolved. A status marker alone does not prove approval.
- Code and Git reality outrank assumptions.
- Choose the simplest durable design that satisfies the required semantics and preserves correctness, robustness, scalability, and maintainability. Avoid unrelated cleanup and speculative abstraction.
- Delete before adding; otherwise reuse existing code, prefer standard/native facilities, then existing dependencies, and add custom code last.
- Break the work into the smallest coherent independently testable outcomes, with dependencies only where they materially matter.
- Resolve consequential implementation decisions: architecture, code touchpoints, abstractions to reuse/change/remove, interfaces, ownership, data/control flow, invariants, constraints, risks, and proof.
- Make each outcome explicit about required changes and deterministic done criteria. When a durable plan is useful or requested, write compact `plans/<project>/plan.md` with strategy, outcomes, dependencies, constraints/non-goals, and proof. Put cross-worktree artifacts in a tracked path rather than assuming ignored `plans/` is shared. Do not use the plan to track progress/status.
- An applicable approved plan binds the owning agent's architecture and outcomes. Without one, the owning agent resolves implementation design itself and does not invent new product semantics.

Present the architecture, important decisions, outcomes, proof, risks, and untouched areas. If the human requested approval of the plan, present it through `ask_user_question`, revise on feedback, and mark `Status: APPROVED` only with evidenced explicit approval. Otherwise finish a decision-complete plan without requiring an approval turn.
