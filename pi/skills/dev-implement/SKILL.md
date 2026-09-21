---
name: dev-implement
description: Implement one approved execution contract as one verified commit.
disable-model-invocation: true
---

# dev-implement

Implement exactly the assigned `Pxxx`/`Rxxx` contract. The approved spec and contract define semantics and scope.

- Follow repository/local instructions and the contract's acceptance checks.
- Leave exactly one coherent **Conventional Commit** (`type(scope): summary`) descended from the supplied base and a clean worktree. Keep workflow IDs/metadata out of the commit message. On retry, amend that commit rather than adding another.
- Never edit workflow artifacts or perform controller-owned Git operations: rebase, push, reset, clean, stash, merge, or worktree management.
- If the contract is materially wrong or requires a semantic/architecture decision outside it, stop with `NEEDS_REPLAN` and precise evidence.
