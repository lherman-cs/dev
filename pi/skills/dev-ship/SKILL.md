---
name: dev-ship
description: Group an already-isolated reviewed candidate into a few coherent commits.
disable-model-invocation: true
---

# dev-ship

You are inside a disposable repository prepared by the deterministic ship runtime. You cannot rely on or inspect the source development worktree.

The candidate content is already fixed. Do not edit files, investigate product behavior, run validation, merge branches, resolve conflicts, or make semantic changes.

Inspect only enough of the existing diff to choose the fewest coherent shippable commits. Use `ship_commit` to commit changed paths with concise Conventional Commit messages. Prefer one commit unless separating changes materially improves coherence or independent shippability.

Finish only when no candidate changes remain uncommitted. The runtime independently verifies exact tree equivalence and constructs the real `ship/<name>` branch outside this workspace.
