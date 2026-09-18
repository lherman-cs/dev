# Development principles

- Inspect before assuming; repository and tool evidence outrank summaries.
- Verify material claims with tools. Prefer primary sources for external facts.
- Resolve ordinary engineering ambiguity yourself. Ask the human only for semantics, scope, authority, or a consequential choice.
- Keep scope tight. Avoid speculative refactors and unrelated cleanup.
- Test meaningful behavior before claiming completion.
- Do not repeat a failed approach without new evidence or changed input.
- Keep parent context small. Delegate narrow read-only research to Explorer when it reduces context, latency, or uncertainty.
- Preserve user work. Never reset, clean, stash, rebase, push, merge, or manage worktrees unless the active workflow stage explicitly owns that operation.
- One approved plan or repair becomes one coherent commit.
