---
description: Compile an approved spec into human-approved execution contracts.
---

Run the plan phase for: $ARGUMENTS

Require an approved spec. Delegate planning with native `task` to `dev-planner`. After it returns, read the draft project/plans and present the architecture, important interfaces/invariants, dependency graph, proof strategy, risks, and untouched areas. Use fenced `mermaid` only when it makes architecture or dependencies faster to review.

Use native `ask` for feedback/final approval. Feed feedback into another `dev-planner` task. Only explicit human approval may set `project.toon` status to `ready`. Stop after approved plans.
