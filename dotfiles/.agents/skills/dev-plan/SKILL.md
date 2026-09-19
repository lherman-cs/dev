---
name: dev-plan
description: Compile an approved spec into small immutable execution contracts.
---

# dev-plan

Convert the approved spec into the smallest coherent independently testable outcomes.

- Git reality outranks stale workflow pointers.
- Write compact `project.toon` with identity/base, dependencies, final checks, and status; write `plans/Pxxx.toon` with ID/title/goal, dependencies, scoped requirements, material constraints/non-goals, and deterministic checks. One plan = one fresh Implementer + one coherent commit.
- Do not duplicate the spec/research transcripts or edit `progress.toon`.
- Dispatched plans are immutable. Replan only contradicted assumptions/interfaces/dependencies/proof strategy, not ordinary debugging. Preserve old contracts; replacements get new IDs with `supersedes`, and downstream dependencies move to them.

Before `status: ready`, show `workflow_brief` in `plan` mode with architecture/data flow, important interfaces/invariants, plan graph, outcome + proof for each plan, integration checks, risks, and intentionally untouched areas. Revise until explicit approval.

Stop after approved project metadata and plans.
