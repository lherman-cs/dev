---
name: dev-build
description: Implement approved plan outcomes incrementally.
disable-model-invocation: true
---

# dev-build

Implement the approved plan to completion, one independently testable outcome at a time.

- Read the approved spec, plan, repository state, and evidence. Preserve approved semantics and architecture; adapt only local mechanics.
- Resolve ordinary implementation choices, debugging, and failed checks yourself. Prefer the smallest durable design; fix root causes and preserve compatibility, data safety, accessibility, and necessary observability. Do not weaken, delete, or bypass checks.
- For each outcome, validate at the user-visible boundary with appropriate fast, deterministic, stable lower-level checks. Update documentation and independently commit completed outcomes with a Conventional Commit. Keep partial work uncommitted and continue; inability to commit is not a stop condition.
- Before finishing, compare every approved outcome and its evidence with the worktree and commits. If work remains, take the next step, not a partial-status exit, even after compaction or difficulty.
- Stop only when all outcomes are complete, a consequential decision cannot be resolved from the approved spec and plan, or code reality invalidates the plan. For a decision, use `ask_user_question` with what is needed, why it matters, and why work cannot safely continue. For a plan conflict, report `NEEDS_REPLAN` with the conflicting evidence and required change.
