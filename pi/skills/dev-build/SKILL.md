---
name: dev-build
description: Implement a defined request, respecting any applicable approved spec or plan.
disable-model-invocation: true
---

# dev-build

Implement the requested outcome to completion, one independently testable part at a time. An approved spec is optional. Follow applicable approved decisions; otherwise derive semantics from the request and repository evidence and resolve ordinary design choices yourself.

- Read `../references/reconcile.md` at entry. Map requested outcomes to existing commits, partial edits and current proof before implementing the next one. A missing spec, plan, earlier phase, or session is not a stop condition.
- Preserve applicable approved semantics and architecture; adapt local mechanics.
- Be aggressively minimal: solve only the requested problem, prefer deletion or reuse over addition, native/stdlib over dependencies, direct code over abstractions, and the smallest durable diff that preserves correctness, safety, compatibility, accessibility, and necessary observability. Do not build speculative flexibility or infrastructure.
- Resolve ordinary implementation choices, debugging, failed checks, conflicting repository state, and necessary adjacent work yourself. Fix root causes. Do not weaken, delete, or bypass checks.
- For each outcome, validate at the user-visible boundary with appropriate fast, deterministic, stable lower-level checks. Update documentation and independently commit coherent outcomes with a Conventional Commit when possible. Classify and stage only relevant paths. Diagnose a failed or interrupted commit, observe whether it took effect, and retry or continue useful work; do not mistake an attempted commit for completed work.
- Before finishing, compare every required outcome and its evidence with the worktree and commits. If work remains, take the next step, not a partial-status exit, even after compaction or difficulty. Verify the terminal state from live evidence. Repeated nonproductive failures require a concrete diagnosis and changed approach, not an endless identical retry.

**Stop condition:** Continue by default. Stop only when you judge that completing the requested outcome requires a consequential product, scope, semantics, or authority decision that cannot be safely resolved from the request, applicable approved decisions, repository evidence, and reasonable engineering judgment. Ask one precise question stating the decision required, why it is consequential, and why proceeding autonomously would be unsafe.
