---
name: dev-spec
description: Make project semantics decision-complete and human-approved before planning.
---

# dev-spec

Make the requested outcome decision-complete.

- Inspect repository reality first; use `explore` for narrow code/external questions.
- Challenge ambiguity, hidden assumptions, compatibility expectations, invariants, non-goals, risks, and project boundaries.
- If outcomes are independently mergeable/testable, propose a split; the human decides and manages any extra worktrees.
- Write semantic prose in ignored `plans/<project>/spec.md`: behavior/interfaces, key decisions and open decisions, invariants, constraints, non-goals, risks, and acceptance evidence. Do not design implementation tasks or use TOON for the spec.
- Never create/manage worktrees.

Before approval, show `workflow_brief` in `spec` mode with goal, user-visible behavior, decisions/open decisions, non-goals, risks, acceptance evidence, and any split. Use diagrams/images only when they reduce review effort. Revise on feedback.

Only explicit human approval may mark `Status: APPROVED`. Stop after the approved spec.
