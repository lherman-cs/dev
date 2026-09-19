---
description: Execute every approved plan/repair as one independently verified commit.
---

Run the build phase for project: $ARGUMENTS

Read the approved spec, `project.toon`, `progress.toon` if present, and all active plan/repair contracts. Git reality outranks stale progress. Initialize native `todo` with dependency-ready unfinished contracts and keep it current.

Execute contracts sequentially. Before each worker, persist the current contract and accepted predecessor in `progress.toon`. Spawn a fresh `dev-builder` task for the exact contract/base. Independently verify its declared checks, a clean worktree, exactly one coherent Conventional Commit from the accepted predecessor, and no workflow ID in the commit subject. On success advance `progress.toon` and `todo`.

If verification fails, give the exact evidence to one fresh `dev-builder-retry` task, then verify again. Stop on `NEEDS_REPLAN` or a second failure. Do not rebase or push.
