---
name: dev-plan
description: Compile an approved spec into small immutable execution contracts.
---

# dev-plan

Convert the approved spec into the smallest coherent independently testable outcomes.

- Git reality outranks stale workflow pointers.
- Write compact `project.toon` with identity/base, dependencies, final checks, and draft status; write `plans/Pxxx.toon` with ID/title/goal, dependencies, scoped requirements, material constraints/non-goals, and deterministic checks.
- Each plan must fit one fresh Implementer session and be independently testable.
- Do not duplicate the spec/research transcripts or edit `progress.toon`.
- Dispatched plans are immutable. Replan only contradicted assumptions/interfaces/dependencies/proof strategy, not ordinary debugging. Preserve old contracts; replacements get new IDs with `supersedes`, and downstream dependencies move to them.
- Leave project status unready for parent review; only the parent session may mark it ready after explicit human approval.

Return a compact architecture/plan summary, dependency graph, proof strategy, risks, and intentionally untouched areas.
