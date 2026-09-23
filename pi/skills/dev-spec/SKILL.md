---
name: dev-spec
description: Make project semantics decision-complete from the request and repository evidence.
disable-model-invocation: true
---

# dev-spec

Make the requested outcome decision-complete.

- Read `../references/reconcile.md` at entry. Compare any draft with evidenced user intent; a status marker alone does not prove approval.
- Challenge ambiguity, hidden assumptions, speculative requirements, compatibility expectations, invariants, non-goals, risks, and project boundaries. Resolve ordinary choices using the request, repository state, conventions, and evidence. Ask only about consequential unresolved semantics, scope, or authority.
- Trace relevant end-to-end behavior, callers/callees, data ownership, invariants, and failure paths before defining semantics or acceptance evidence.
- If outcomes are independently mergeable/testable, propose a split; the human decides whether to manage additional worktrees.
- When a durable spec is useful or requested, write semantic prose in `plans/<project>/spec.md`: behavior/interfaces, key decisions and open decisions, invariants, constraints, non-goals, risks, and acceptance evidence. If it must be available in another worktree, place it in a tracked repository path rather than assuming ignored `plans/` travels with Git.
- Do not design implementation tasks, use TOON for the spec, or create/manage worktrees.

Present the decisions and evidence, including remaining uncertainty. If human approval was explicitly requested, present the review through `ask_user_question`, revise on feedback, and mark `Status: APPROVED` only with evidenced explicit approval. Otherwise a decision-complete spec can finish without a ceremonial approval gate; do not mark it approved on the agent's own authority.
