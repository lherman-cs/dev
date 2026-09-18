---
name: dev-prepare
description: Rebase and locally verify the completed candidate, then push or update a draft PR so CI and review bots can run. Never waits for them.
---

# dev-prepare

Prepare the exact candidate that CI and review bots will evaluate. This is an operational stage, not technical review and not implementation planning.

## Preconditions

- All currently approved plans and repairs are complete according to `progress.toon` and Git.
- The worktree is clean.
- Do not invent implementation fixes.

## Work

1. Fetch and rebase onto current `origin/main`, or the repository base explicitly configured by the project.
2. Resolve only clearly mechanical conflicts. Stop on semantic conflicts.
3. Run project final and integration checks plus relevant tests, documentation validation, lint, and format checks declared by the project or repository.
4. Keep preparation-only changes mechanical and minimal. If behavior or product semantics must change, stop with precise evidence instead of editing around the problem.
5. Push the branch.
6. Create or update a **draft** GitHub PR for the branch. Keep the provisional body concise because final human-facing synthesis belongs to the shipping stage.
7. Confirm that the push and PR exist and external checks can start.
8. Stop immediately.

## Boundaries

Do not wait for CI. Do not poll CI or review bots. Do not perform adversarial review. Do not merge. Do not mark the PR ready for human review.
