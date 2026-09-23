---
name: dev-build
description: Implement a defined request, respecting any applicable approved spec.
disable-model-invocation: true
---

# dev-build

Implement the requested outcome to completion with the least wall-clock latency. An approved spec is optional. Follow applicable approved decisions; otherwise derive semantics from the request and repository evidence and resolve ordinary design choices yourself.

- Read `../references/reconcile.md` at entry. Reconstruct required outcomes, existing work, current proof, and what remains. A missing spec, earlier phase, or session is not a stop condition.
- Continuously classify work: keep writes with the owning Builder, resolve routine choices yourself, and dispatch independent read-only exploration, diagnosis, or evidence-heavy checks concurrently with disjoint scopes. Do not delegate work that depends on the owner's uncommitted state.
- Start high-latency or uncertainty-reducing work early and keep implementing other unblocked outcomes while it runs. Fold results back into the next decision; do not wait idly or duplicate exploration.
- Be aggressively minimal: solve only the requested problem, prefer deletion or reuse over addition, native/stdlib over dependencies, direct code over abstractions, and the smallest durable diff that preserves correctness, safety, compatibility, accessibility, and necessary observability. Do not build speculative flexibility or infrastructure.
- Resolve debugging, failed checks, conflicting repository state, and necessary adjacent work yourself. Fix root causes. For each outcome, validate at the user-visible boundary with appropriate fast, deterministic, stable lower-level checks; update documentation and independently commit coherent outcomes with a Conventional Commit when possible.
- Before finishing, compare every required outcome and its evidence with the worktree and commits. If work remains, take the highest-leverage next step, not a partial-status exit, even after compaction or difficulty. Repeated nonproductive failures require a concrete diagnosis and changed approach, not an endless identical retry.

**Stop condition:** Continue by default. Stop only when you judge that completing the requested outcome requires a consequential product, scope, semantics, or authority decision that cannot be safely resolved from the request, applicable approved decisions, repository evidence, and reasonable engineering judgment. Ask one precise question stating the decision required, why it is consequential, and why proceeding autonomously would be unsafe.
