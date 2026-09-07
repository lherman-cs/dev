---
name: dev-plan
description: Define one bounded software project, resolve consequential decisions, gather necessary repository evidence, and write executable numbered plans. Never implement.
---

# Dev Plan

Define one bounded project. Never modify production code.

`plans/` is Git-ignored workflow state. Access exact paths directly.

## Main-thread boundary

Preserve the parent for requirements, consequential decisions, design, and plan writing. Keep bulk evidence out of its context.

The parent may directly consume only:
- the user's request and decisions;
- applicable repository instructions;
- compact explorer findings;
- the exact plan sections it is actively writing or patching;
- narrow verification output for its own edits;
- one cited source location when exact semantics are indispensable to a consequential decision.

Existing specs, plans, build/review evidence, implementation source, callers, tests, history, and cross-file state are repository evidence. Do not bulk-read them in the parent.

Before repository discovery, spawn `explorer`. Do not first inspect plan sets or implementation files "for orientation."

## Explorer

Use `explorer` as the primary repository context owner.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Prefer one primary explorer for related questions so repository context accumulates there rather than in the parent. Continue with it when a follow-up depends on evidence it already gathered. Spawn another only for genuinely independent work that will not duplicate context.

Ask the explorer to build a decision-grade evidence packet from the relevant workflow artifacts and repository state. Give it:
- the user's objective;
- known paths or symbols;
- the exact decisions or plan boundaries the evidence must inform.

Require a compact result containing:
- settled contract and prior decisions relevant to this task;
- current repository truth;
- stale or conflicting assumptions;
- canonical owners, callers/consumers, tests, and completeness checks;
- relevant `path::symbol` evidence;
- material uncertainty requiring a parent decision.

Do not request search history, raw command output, large excerpts, implementation proposals, or design decisions.

The explorer gathers facts. The parent decides.

Do not repeat explorer discovery in the parent. If evidence is incomplete or conflicting, ask the explorer to resolve it first. Direct parent source inspection is a last resort and stays limited to the cited location necessary for the decision.

If `explorer` is unavailable, use only narrow reads required to determine whether work can proceed. Broad parent-side discovery is not an allowed fallback.

## Workflow

1. **Align**
   * Resolve consequential ambiguity in outcome, behavior, ownership, lifecycle, compatibility, non-goals, acceptance, and risk.
   * Ask related unresolved questions together and recommend an answer when justified.
   * Do not investigate implementation details before direction is clear.

2. **Discover**
   * Identify only repository facts that can change the contract, design, acceptance, or plan boundaries.
   * Delegate evidence gathering to the primary explorer.
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
   * Read only the exact existing sections needed for a surgical edit; do not reload whole plan sets after discovery.
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
