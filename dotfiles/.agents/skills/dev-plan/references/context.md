## Main-thread boundary

Preserve the parent for requirements, consequential decisions, design, and plan writing. Keep bulk repository evidence out of its context.

The parent may directly consume only:

- the user's request and decisions;
- applicable repository instructions;
- compact explorer findings;
- exact plan sections it is actively writing or patching;
- narrow verification output for its own edits and targeted disposable feasibility probes;
- one cited source location when exact semantics are indispensable to a consequential decision.

Existing specs, plans, build/review evidence, implementation source, callers, tests, history, and cross-file state are repository evidence. Do not bulk-read them in the parent.

Do not begin repository discovery merely to understand what the user wants. First establish the intended outcome and resolve consequential product and design choices with the user.

Before repository discovery, identify independent evidence questions from the aligned direction and known anchors, then delegate them. Do not first read plan sets or implementation files merely for orientation.

## Explorers

Use `explorer` as the repository context owner.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Use the smallest useful fan-out:

- one explorer when the evidence is cohesive;
- two or three explorers in parallel when the task spans independent ownership boundaries or subsystems;
- never split by evidence type when the same subsystem knowledge is required.

Good partitions are independent subsystems or ownership boundaries. Bad partitions are "implementation", "callers", and "tests" for the same subsystem, because they duplicate orientation.

Each explorer gets one coherent question, the narrowest useful anchors, and the decision or plan boundary its evidence must inform. Scopes should overlap as little as practical.

Require each explorer to return one compact decision-grade packet:

- direct conclusions;
- relevant `path::symbol` evidence;
- important relationships and constraints;
- stale or conflicting assumptions;
- material uncertainty requiring a parent decision.

Explorers report directly to the parent. Do not add a synthesis agent.

The parent integrates evidence and decides. Do not repeat explorer discovery in the parent. If a packet is incomplete, continue that explorer only when the missing fact belongs to the same coherent scope; otherwise delegate the new concern separately.

Direct parent source inspection is a last resort and stays limited to the cited location necessary for a consequential decision.

If explorers are unavailable, use only narrow reads required to determine whether work can proceed. Broad parent-side discovery is not an allowed fallback.

Respect the available agent-thread budget. A retained builder/reviewer pair may leave only one explorer slot; reduce fan-out rather than discard useful workers. Release explorers after their scoped answer.
