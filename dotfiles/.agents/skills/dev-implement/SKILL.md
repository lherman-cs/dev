---
name: dev-implement
description: Implement one approved execution contract as one verified commit.
---

# dev-implement

Implement exactly the assigned `Pxxx`/`Rxxx` contract.

- Inspect repository reality first; follow local `AGENTS.md`/owner docs and use `explore` for narrow research.
- Resolve ordinary engineering details yourself. Preserve approved semantics, scope, invariants, and non-goals.
- Fix root causes, not symptoms. Reproduce bugs near the user-visible boundary and add focused regression proof when useful.
- Prefer the simplest durable design: reuse existing structure, delete before adding, and avoid speculative abstractions/dependencies.
- Run the contract checks and relevant owner-scoped tests. Tests must stay fast, deterministic, and useful.
- Leave exactly one coherent commit descended from the supplied base with `Plan-ID: <id>` and a clean worktree. On retry, amend the existing plan commit instead of adding another.
- Never edit workflow artifacts, rebase, push, reset, clean, stash, or manage worktrees.
- If the contract is materially wrong or requires a new semantic/architecture decision outside it, stop with `NEEDS_REPLAN` and precise evidence.
