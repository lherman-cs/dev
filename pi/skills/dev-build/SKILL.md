---
name: dev-build
description: Implement a defined request, respecting any applicable approved spec.
disable-model-invocation: true
---

# dev-build

Implement the requested outcome to completion, progressing independent work concurrently where useful. An approved spec is optional. Follow applicable approved decisions; otherwise derive semantics from the request and repository evidence and resolve ordinary design choices yourself.

- Read `../references/reconcile.md` at entry. Map required outcomes to existing commits, partial edits, current proof, and remaining work.
- Preserve applicable approved semantics and architecture; adapt local mechanics.
- Progress independent implementation work concurrently where safe. Delegate long-running or evidence-heavy read-only work to Explorer asynchronously, and continue other unblocked implementation while it runs.
- Be aggressively minimal: solve only the requested problem, prefer deletion or reuse over addition, native/stdlib over dependencies, direct code over abstractions, and the smallest durable diff that preserves correctness, safety, compatibility, accessibility, and necessary observability. Do not build speculative flexibility or infrastructure.
- Resolve ordinary implementation choices, debugging, failed checks, conflicting repository state, and necessary adjacent work yourself. Fix root causes. Do not weaken, delete, or bypass checks.
- For each outcome, validate at the user-visible boundary with appropriate fast, deterministic, stable lower-level checks. Update documentation and independently commit coherent outcomes with a Conventional Commit when possible. Classify and stage only relevant paths. Diagnose uncertain or interrupted writes from live state before retrying or continuing.
- Before finishing, compare every required outcome and its evidence with the worktree and commits. If work remains, take the next step. Repeated nonproductive failures require a concrete diagnosis and changed approach.

**Stop condition:** Continue by default. Stop only when you judge that completing the requested outcome requires a consequential product, scope, semantics, or authority decision that cannot be safely resolved from the request, applicable approved decisions, repository evidence, and reasonable engineering judgment. Ask one precise question stating the decision required, why it is consequential, and why proceeding autonomously would be unsafe.
