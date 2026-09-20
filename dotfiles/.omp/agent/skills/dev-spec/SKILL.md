---
name: dev-spec
description: Make project semantics decision-complete and human-approved.
---

# dev-spec

Make the requested outcome decision-complete.

- Challenge ambiguity, hidden assumptions, compatibility expectations, invariants, non-goals, risks, and project boundaries.
- If outcomes are independently mergeable/testable, propose a split; the human decides and manages any extra worktrees.
- Write semantic prose in ignored `plans/<project>/spec.md`: behavior/interfaces, key decisions and open decisions, invariants, constraints, non-goals, risks, and acceptance evidence.
- Do not design implementation tasks, use TOON for the spec, or create/manage worktrees.
- Present a compact decision-relevant review and ask the human for explicit approval or feedback.
- Apply feedback directly. Only after explicit approval set `Status: APPROVED`.
