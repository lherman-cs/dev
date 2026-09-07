---
name: dev-plan
description: Define one bounded software project, resolve consequential decisions, gather necessary repository evidence, and write executable numbered plans. Never implement.
---

# Dev Plan

Define one bounded project. Never modify production code.

`plans/` is Git-ignored workflow state. Access exact paths directly.

## Main-thread boundary

Preserve the parent for requirements, consequential decisions, design, and plan writing. Keep bulk repository evidence out of its context.

The parent may directly consume only:
- the user's request and decisions;
- applicable repository instructions;
- compact explorer findings;
- exact plan sections it is actively writing or patching;
- narrow verification output for its own edits;
- one cited source location when exact semantics are indispensable to a consequential decision.

Existing specs, plans, build/review evidence, implementation source, callers, tests, history, and cross-file state are repository evidence. Do not bulk-read them in the parent.

Before repository discovery, identify independent evidence questions from the request and known anchors, then delegate them. Do not first read plan sets or implementation files merely for orientation.

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

## Workflow

1. **Align**
   * Resolve consequential ambiguity in outcome, behavior, ownership, lifecycle, compatibility, non-goals, acceptance, and risk.
   * Ask related unresolved questions together and recommend an answer when justified.
   * Do not investigate implementation details before direction is clear.

2. **Discover**
   * Identify only repository facts that can change the contract, design, acceptance, or plan boundaries.
   * Partition independent repository questions and run useful explorers concurrently.
   * Ask follow-ups only when the answer can materially change the plan.
   * Stop when decision-relevant evidence is sufficient.

3. **Design**
   * Resolve the design from approved requirements and distilled evidence.
   * Prefer canonical owners and existing mechanisms.
   * Add only what the outcome requires.
   * Avoid speculative abstraction, state, configuration, compatibility, dependencies, and future-proofing.
   * Return to the user if evidence exposes a consequential undecided choice.

4. **Confirm**
   * Present the proposed contract concisely.
   * Do not write plans until consequential decisions are resolved.

5. **Write**
   * Create or update `plans/<project>/spec.md`.
   * Create ordered `plans/<project>/<NN>-<outcome>.md`.
   * Read only exact existing sections needed for a surgical edit; do not reload whole plan sets after discovery.
   * Verify structure and changed sections without rereading unchanged artifacts.

Each numbered plan must contain:

```markdown
# <Milestone>

## Outcome
<one coherent result>

## Scope
<complete milestone-specific behavior>

## Constraints
<only consequential constraints>

## Verified preconditions
- <repository fact required for this plan to remain valid>

## Repository handoff
- Canonical owner: `<path>::<symbol>`
- Starting points: `<paths/symbols>`
- Direct callers / consumers: `<paths/symbols or None>`
- Relevant tests: `<tests or None>`
- Completeness checks: `<scoped checks or None>`

## Acceptance
<exact milestone-specific evidence>

## Dependencies
<exact plan paths or None>
```

The numbered plan is the complete build/review contract. Later agents must not need `spec.md`, sibling plans, or broad repository discovery to recover settled facts.

Report the approved outcome, consequential decisions, files written, and first plan path. Then stop.
