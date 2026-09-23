---
name: dev-build
description: Implement a defined request, respecting any applicable approved spec or plan.
disable-model-invocation: true
---

# dev-build

Implement the requested outcome to completion, one independently testable part at a time. An approved spec or plan is optional. Follow applicable approved decisions; otherwise derive semantics from the request and repository evidence and resolve ordinary design choices yourself.

- Read `../references/reconcile.md` at entry. Map requested outcomes to existing commits, partial edits and current proof before implementing the next one. A missing spec, plan, earlier phase, or session is not a stop condition.
- Preserve applicable approved semantics and architecture; adapt local mechanics. Ask about consequential missing product decisions, not routine implementation design.
- Resolve ordinary implementation choices, debugging, and failed checks yourself. Prefer the smallest durable design; fix root causes and preserve compatibility, data safety, accessibility, and necessary observability. Do not weaken, delete, or bypass checks.
- For each outcome, validate at the user-visible boundary with appropriate fast, deterministic, stable lower-level checks. Update documentation and independently commit coherent outcomes with a Conventional Commit when possible. Classify and stage only relevant paths. Diagnose a failed or interrupted commit, observe whether it took effect, and retry or continue useful work; do not mistake an attempted commit for completed work.
- Before finishing, compare every required outcome and its evidence with the worktree and commits. If work remains, take the next step, not a partial-status exit, even after compaction or difficulty. Verify the terminal state from live evidence.
- Pause only for an unresolved consequential product/scope/authority decision, unavailable required evidence after feasible retries, or an applicable approved plan contradicted by code reality. Ask a precise question for a decision; report `NEEDS_REPLAN` with evidence only when an actually binding plan must change. Repeated nonproductive failures require a concrete diagnosis and changed approach, not an endless identical retry.
