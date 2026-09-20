---
name: dev-plan
description: Compile an approved spec into small immutable execution contracts.
---

# dev-plan

Require an explicitly approved spec. Convert it into the smallest coherent independently testable outcomes.

- Git reality outranks stale workflow pointers.
- Write compact `project.toon` with identity/base, dependencies, final checks, and status; write `plans/Pxxx.toon` with ID/title/goal, dependencies, scoped requirements, material constraints/non-goals, and deterministic checks. Each plan must fit one fresh Implementer session and be independently testable.
- Do not duplicate the spec/research transcripts or edit `progress.toon`.
- Dispatched plans are immutable. Replan only contradicted assumptions/interfaces/dependencies/proof strategy, not ordinary debugging. Preserve old contracts; replacements get new IDs with `supersedes`, and downstream dependencies move to them.

Before `status: ready`, present a Markdown review through `ask_user_question` with architecture/data flow, important interfaces/invariants, plan graph, outcome + proof for each plan, integration checks, risks, and intentionally untouched areas. Revise until explicit approval.

Stop after approved project metadata and plans.
