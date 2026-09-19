---
name: dev-plan
description: Compile an approved spec into small immutable execution contracts.
---

# dev-plan

Turn the approved spec into the smallest coherent independently testable outcomes.

- Inspect current Git/repository reality; use `explore` for focused research.
- Write compact `project.toon` and `plans/Pxxx.toon`. Each plan is one fresh Builder session and one coherent commit with dependencies, requirements/constraints, and deterministic checks.
- Do not edit `progress.toon`.
- Dispatched plans are immutable. Replace contradicted remaining work with new IDs using `supersedes`; update downstream dependencies.
- Show `workflow_brief` in `plan` mode with architecture/data flow, plan graph, invariants, validation, risks, and untouched areas. Revise until explicit approval, then set project status to `ready`.

Stop after approved plans.
