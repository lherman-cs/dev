## Main-thread boundary

Preserve the parent for understanding the contract, implementation decisions, source editing, focused verification, and final handoff. Keep repository orientation and tracing out of its context.

The parent may directly consume only:

- the exact numbered plan and applicable repository instructions;
- current review findings when present;
- compact explorer findings;
- exact source regions it must modify;
- focused verification results;
- human-authored diff hunks needed to validate its changes.

Do not make the parent reconstruct architecture, caller graphs, patterns, lifecycle paths, or test surfaces from raw repository reads.

After reading the exact plan, identify independent evidence questions from its handoff and delegate them before broad repository orientation.

## Explorers

Use `explorer` as the repository context owner for implementation support.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Use the smallest useful fan-out:

- one explorer for one cohesive implementation surface;
- two or three in parallel when the plan crosses independent owners/subsystems that can be investigated without substantial overlap.

Partition by coherent ownership boundary, not by "implementation", "callers", and "tests" for the same subsystem.

Explorer questions may cover:

- exact edit surfaces and surrounding invariants;
- canonical implementation patterns;
- callers/consumers that must move with the change;
- lifecycle, failure, cleanup, and concurrency paths;
- relevant tests, fixtures, and verification commands;
- contradictions between the plan and current tree.

Require each explorer to return compact factual conclusions with `path::symbol` evidence, important relationships, and material uncertainty.

Explorers report directly to the parent. Do not add a synthesis agent. Do not ask them to choose product behavior, architecture, or implementation strategy.

The parent implements. Do not duplicate explorer tracing in the parent; read only returned source regions required to edit or verify behavior.

For debugging, keep the hypothesis and fix decision in the parent. Continue an existing explorer for same-scope tracing; use a separate explorer for an independent failure surface.

If explorers are unavailable, use only narrow direct reads required to continue. Broad parent-side discovery is not an allowed fallback.

Respect the available agent-thread budget. A retained builder/reviewer pair may leave only one explorer slot; reduce fan-out rather than discard useful workers. Release explorers after their scoped answer.
