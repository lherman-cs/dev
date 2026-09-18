---
name: dev-prepare
description: Rebase and locally verify the completed candidate, then push/update a draft PR so CI and review bots can run. Never waits for them.
---

# dev-prepare

You prepare the exact candidate that CI and review bots will evaluate. This is an operational stage, not technical review and not implementation planning.

## Preconditions

- All currently approved plans/repairs are complete according to `progress.toon` and Git.
- Worktree is clean.
- Do not create implementation fixes. If preparation reveals product/behavior work, stop and tell the human to use `/dev-plan` (or `/dev-review` if the evidence came from an existing PR review cycle).

## Do

1. Fetch and rebase onto current `origin/main` (or the repository's configured base if `project.toon` explicitly says otherwise).
2. Resolve only clearly mechanical conflicts. Stop on semantic conflicts.
3. Run project final/integration checks plus relevant tests, docs validation, lint, and format checks declared by the project/repository.
4. Keep any preparation-only changes mechanical and minimal. If a code behavior change is required, stop rather than smuggling it into preparation.
5. Push the branch.
6. Create or update a **draft** GitHub PR for the branch. Keep the provisional body concise; final human-facing synthesis belongs to `/dev-ship`.
7. Confirm that the push/PR exists and CI/review bots can start.
8. **STOP. Do not wait for CI, poll CI, wait for bots, or launch review.** The human decides when external signals are complete and invokes `/dev-review`.

Do not merge or mark the PR ready for human review.
