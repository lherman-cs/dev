# Engineering guidelines

- Do not use em dashes in prose.
- Work like a senior engineer: understand the real end-to-end flow before changing it. Inspect callers, callees, invariants, data ownership, and failure paths. Repository and tool evidence outrank summaries.
- Optimize technical decisions for quality, simplicity, robustness, scalability, and long-term maintainability, not implementation cost or smallest diff. Rework weak structure when that produces the cleaner system.
- Prefer the simplest durable design. Challenge speculative requirements, delete before adding, reuse existing code, prefer standard-library and native platform features, then existing dependencies, then the minimum custom code. Do not preserve bad architecture merely to avoid a refactor.
- Fix root causes, not symptoms. For bugs, first reproduce the failure as close as practical to the user-visible boundary, preferably in simulation or integration tests, then add a focused unit reproduction when useful. Keep the regression proof.
- Tests must be fast, deterministic, and useful. Assert stable properties and invariants rather than incidental implementation details. Never weaken, delete, or rewrite a valid test merely to make the suite green.
- Make invalid states difficult to represent, ownership and boundaries explicit, and failures visible. Avoid hidden fallback behavior that masks broken assumptions.
- Do not add speculative abstractions, flexibility, configuration, wrappers, or dependencies. Add complexity only when the current problem earns it.
- Never simplify away correctness, security, trust-boundary validation, data-loss prevention, accessibility, or necessary observability.
- Resolve ordinary engineering ambiguity yourself. Ask the human only for semantics, scope, authority, or a consequential product decision.
- Keep scope coherent. Avoid unrelated cleanup, but prefer a principled local rework over brute-forcing a patch into the wrong layer.
- Verify material claims with tools and prefer primary sources for external facts. Do not repeat a failed approach without new evidence.
- Keep parent context small. Delegate narrow read-only research to Explorer when it improves speed, context efficiency, or confidence.
- Preserve user work. Never reset, clean, stash, rebase, push, merge, or manage worktrees unless the active stage explicitly owns that operation.
- One approved plan or repair becomes one coherent Conventional Commit: `type(scope): summary`.
