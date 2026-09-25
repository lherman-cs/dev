---
name: dev-build
description: Implement a human-approved outcome locally, with validation and coherent commits.
disable-model-invocation: true
---

# dev-build

Implement the approved outcome to completion, progressing independent work concurrently where useful. An approved spec file is optional, but approval of the outcome must be established, including from an applicable explicit conversational approval. A status marker alone does not suffice. If approval cannot be established, obtain it before implementation. Follow applicable approved decisions and resolve ordinary design choices yourself.

- Read `../../references/reconcile.md` at entry. Map required outcomes to existing commits, partial edits, current proof, and remaining work.
- Read `../../references/engineering.md` at entry.
- Preserve applicable approved semantics and architecture; adapt local mechanics.
- Progress independent implementation work concurrently where safe. Delegate long-running or evidence-heavy investigation to Explorer asynchronously, and continue other unblocked implementation while it runs.
- Resolve ordinary implementation choices, debugging, failed checks, conflicting repository state, and necessary adjacent work yourself. Fix root causes. Do not weaken, delete, or bypass checks.
- For each outcome, validate at the user-visible boundary with appropriate fast, deterministic, stable lower-level checks. Update documentation and independently commit coherent outcomes with a Conventional Commit when possible. Classify and stage only relevant paths. Diagnose uncertain or interrupted writes from live state before retrying or continuing.
- Before finishing, compare every required outcome and its evidence with the worktree and commits. If work remains, take the next step. Repeated nonproductive failures require a concrete diagnosis and changed approach.

**Endpoint:** The local implementation and relevant passing validation are complete; review owns focused candidate review, consequential approvals, and repairs; the human prepares integration and commits before ship packages history. Do not publish or claim review convergence. Pause only for a consequential product, scope, semantics, or authority decision that cannot safely be resolved from the request, approved decisions, repository evidence, and reasonable engineering judgment. Identify the exact missing decision and why autonomous progress is unsafe.
