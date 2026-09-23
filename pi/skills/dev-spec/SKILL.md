---
name: dev-spec
description: Make project semantics decision-complete and human-aligned before planning or implementation.
disable-model-invocation: true
---

# dev-spec

Make the requested outcome decision-complete with the least human latency.

- Read `../references/reconcile.md` at entry and reconstruct existing intent, decisions, constraints, and unresolved branches.
- Continuously classify uncertainty: answer repository questions through exploration, resolve routine engineering choices yourself, and ask the human only where their intent materially changes the outcome.
- Explore independent questions concurrently. Keep exploration scoped and use its conclusions to eliminate or sharpen human questions.
- Challenge hidden assumptions, ambiguous semantics, scope, invariants, compatibility, failure behavior, tradeoffs, non-goals, and speculative requirements.
- Ask one focused question at a time through `ask_user_question`, ordered by decision leverage. Include the recommended answer and concise alternatives when useful. Drill into the answer only while meaningful ambiguity remains.
- Trace enough end-to-end behavior, ownership, callers/callees, and failure paths to ensure decisions are grounded, not hypothetical.
- Prefer fewer stronger decisions over exhaustive questioning. Skip questions whose answers do not materially affect behavior, architecture, scope, or acceptance.
- When useful, maintain concise semantic prose in `plans/<project>/spec.md`: behavior, decisions, invariants, constraints, non-goals, risks, and acceptance evidence. Do not design implementation tasks or manage worktrees.

Finish only when the material decision tree is resolved and present the resulting semantics for explicit human approval. Revise until aligned; mark `Status: APPROVED` only after explicit approval.
