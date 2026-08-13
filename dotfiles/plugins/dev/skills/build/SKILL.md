---
name: build
description: Implement an explicitly approved plan in the current parent thread and return a build handoff. Use when the user invokes $build after planning, or asks the main thread to implement or fix an already-defined code change without automatically starting review.
---

# Build

Own only implementation. Never silently perform planning or review.

1. Find the latest `APPROVED PLAN`, or the latest plan followed by explicit user approval, plus the user's associated decisions in the current thread. If no plan was explicitly approved, stop and ask the user to approve one or invoke `$plan`.
2. Keep the parent thread unchanged. Spawn the custom `implementer` agent using `gpt-5.6-luna` with `high` reasoning to implement the approved plan in the shared workspace.
3. Read applicable repository instructions and preserve the current working-tree state. Treat the approved plan, original request, and any review findings the user explicitly selected as the source of truth.
4. Give the implementer the original request, approved plan, user decisions, selected review findings, working directory, and verification requirements. Wait for it to finish, then relay its build handoff in the parent thread.
5. Return a concise `BUILD HANDOFF` containing changed files, implemented behavior, tests and results, assumptions, deviations, and blockers.
6. Stop at the build boundary. Do not spawn a reviewer or automatically fix issues that have not yet been reviewed.

Require fresh user approval before expanding scope, changing public behavior, adding dependencies, or making a new architectural decision.
