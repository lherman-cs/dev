---
name: dev-build
description: Implement an approved spec, with an approved plan when present.
disable-model-invocation: true
---

# dev-build

Implement the approved spec to completion, one independently testable outcome at a time. A plan is optional; follow its binding design when present, otherwise resolve implementation design yourself without changing approved product semantics.

- Read `../references/reconcile.md` at entry. Map spec outcomes to existing commits, partial edits and current proof before implementing the next one.
- Preserve approved semantics and any approved architecture; adapt local mechanics. Without a plan, own implementation design and proof.
- Resolve ordinary implementation choices, debugging, and failed checks yourself. Prefer the smallest durable design; fix root causes and preserve compatibility, data safety, accessibility, and necessary observability. Do not weaken, delete, or bypass checks.
- For each outcome, validate at the user-visible boundary with appropriate fast, deterministic, stable lower-level checks. Update documentation and independently commit completed outcomes with a Conventional Commit. Keep partial work uncommitted and continue; inability to commit is not a stop condition.
- Before finishing, compare every approved spec outcome and its evidence with the worktree and commits. If work remains, take the next step, not a partial-status exit, even after compaction or difficulty.
- Stop only when all outcomes are complete, a consequential product decision cannot be resolved from approved artifacts, or code reality invalidates an approved plan. For a decision, use `ask_user_question` with what is needed, why it matters, and why work cannot safely continue. For a plan conflict, report `NEEDS_REPLAN` with the conflicting evidence and required change.
