---
name: dev-spec
description: Make project semantics decision-complete and human-approved before planning.
disable-model-invocation: true
---

# dev-spec

Make the requested outcome decision-complete.

- Read `../references/reconcile.md` at entry. Compare any draft with evidenced user intent; a status marker alone does not prove approval.
- Challenge ambiguity, hidden assumptions, speculative requirements, compatibility expectations, invariants, non-goals, risks, and project boundaries until human and agent are explicitly aligned. Do not merely formalize the initial request.
- Trace the relevant end-to-end behavior, callers/callees, data ownership, invariants, and failure paths before defining semantics or acceptance evidence.
- If outcomes are independently mergeable/testable, propose a split; the human decides and manages any extra worktrees.
- Write semantic prose in ignored `plans/<project>/spec.md`: behavior/interfaces, key decisions and open decisions, invariants, constraints, non-goals, risks, and acceptance evidence.
- Do not design implementation tasks, use TOON for the spec, or create/manage worktrees.

Before approval, present a Markdown review through `ask_user_question` with goal, user-visible behavior, decisions/open decisions, non-goals, risks, acceptance evidence, and any split. Challenge unresolved or weak decisions rather than seeking ceremonial approval. Revise on feedback.

Only explicit human approval may mark `Status: APPROVED`. Stop after the approved spec.
