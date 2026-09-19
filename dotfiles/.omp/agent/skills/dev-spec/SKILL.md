---
name: dev-spec
description: Make project semantics decision-complete before parent-session approval.
---

# dev-spec

Make the requested outcome decision-complete.

- Challenge ambiguity, hidden assumptions, compatibility expectations, invariants, non-goals, risks, and project boundaries.
- If outcomes are independently mergeable/testable, propose a split; the human decides and manages any extra worktrees.
- Write semantic prose in ignored `plans/<project>/spec.md`: behavior/interfaces, key decisions and open decisions, invariants, constraints, non-goals, risks, and acceptance evidence.
- Do not design implementation tasks, use TOON for the spec, or create/manage worktrees.
- Leave the spec ready for parent review. Do not mark `Status: APPROVED`; only the parent session may do that after explicit human approval.

Return a compact summary of the goal, material decisions, open decisions, risks, and acceptance evidence.
