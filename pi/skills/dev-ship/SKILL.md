---
name: dev-ship
description: Mechanically package an already-reviewed candidate into a clean local shipping branch without changing its content.
disable-model-invocation: true
---

# dev-ship

Read `../../references/reconcile.md` at entry. Reconstruct the reviewed candidate, its merged integration baseline, exact final tree, local history, and relevant uncommitted content. Dev-review owns semantics, repairs, conflict resolution, validation, and human convergence; do not reopen them here.

Transform representation only.

- Treat the reviewed candidate tree as immutable source-of-truth input. Do not repair code, resolve new semantic conflicts, change behavior, or reinterpret review decisions.
- Create an isolated local shipping branch named `ship/<name>` from the reviewed integration baseline and perform cleanup there. Never rewrite or otherwise mutate the source development branch.
- Rebuild the reviewed change as the smallest useful linear set of coherent Conventional Commits. Prefer fewer commits, but every commit must represent one understandable shippable step and must not depend on accidental intermediate development history. Development merge commits are input history only and must not appear in the shipping history.
- Use the LLM only for the narrow semantic task of grouping the already-reviewed diff into coherent commits and writing concise commit messages. Git operations, candidate identity, changed-path accounting, and equivalence checks are mechanical.
- After every history construction, mechanically compare the shipping branch with the reviewed candidate. The final tree and base-to-candidate content must be identical. No candidate change may be omitted, altered, or added; no unrelated change may enter.
- If exact equivalence cannot be established, stop and preserve both branches. If current `main` has moved beyond the baseline reviewed by dev-review, do not integrate it here; return the candidate to dev-review.
- Leave the source branch untouched and the `ship/<name>` worktree clean. Do not fetch, push, deploy, open or mutate remote review state, or merge into another branch.

**Endpoint:** A clean local `ship/<name>` branch, based on the exact integration baseline reviewed by dev-review, with a minimal linear commit history, mechanically verified tree equivalence to the reviewed candidate, and a branch that is fast-forwardable from the exact reviewed integration baseline.
