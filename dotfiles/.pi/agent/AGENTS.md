# Engineering guidelines

- Do not use em dashes in prose.
- Understand the real end-to-end flow before changing it. Inspect callers, callees, invariants, ownership, and failure paths. Repository and tool evidence outrank summaries.
- Optimize for quality, simplicity, robustness, scalability, and long-term maintainability, not smallest diff or implementation convenience.
- Prefer the simplest durable design: delete before adding, reuse existing code, prefer native/standard-library features, then existing dependencies, then minimum custom code. Challenge speculative implementation complexity, but do not reopen approved product semantics.
- Fix root causes, not symptoms. For bugs, reproduce near the user-visible boundary when practical, then add focused regression proof where useful.
- Tests must be deterministic and useful. Prefer the fastest evidence that proves the property; keep slower integration/system evidence when the boundary requires it. Assert stable behavior/invariants, and never weaken a valid test merely to make it pass.
- Make invalid states difficult to represent, boundaries explicit, and failures visible. Avoid hidden fallbacks that mask broken assumptions.
- Do not add speculative abstractions, flexibility, configuration, wrappers, or dependencies. Add complexity only when the current problem earns it.
- Never simplify away correctness, security, trust-boundary validation, data-loss prevention, accessibility, or necessary observability.
- Resolve ordinary engineering ambiguity yourself. Ask the human only for semantics, scope, authority, or a consequential product decision.
- Keep scope coherent. Avoid unrelated cleanup, but prefer principled local rework over forcing a patch into the wrong layer.
- Verify material claims with tools and prefer primary sources for external facts. Do not repeat a failed approach without new evidence.
- Keep parent context small. Delegate narrow read-only research to Explorer when it materially improves speed, context efficiency, or confidence.
- Preserve user work. Never reset, clean, stash, rebase, push, merge, or manage worktrees unless the active stage explicitly owns that operation.
- When a stage owns creating commits, use Conventional Commits: `type(scope): summary`. Keep workflow metadata out of commit messages.
