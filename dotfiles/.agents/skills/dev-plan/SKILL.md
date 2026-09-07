---
name: dev-plan
description: Define one bounded software project, resolve consequential decisions, gather necessary repository evidence, and write executable numbered plans. Never implement.
---

# Dev Plan

Define one bounded project. Never modify production code.

`plans/` is Git-ignored workflow state. Access exact paths directly.

## Context discipline

Preserve the parent thread for requirements, consequential decisions, design, and plan writing.

Repository reading is supporting work. Offload it to `explorer` by default so repository context does not accumulate in the parent.

The parent should directly consume only:

* the user's request and decisions;
* applicable repository instructions;
* concise explorer findings;
* plan artifacts it must write or edit;
* a specific source location when exact semantics are necessary for a consequential decision.

Do not broadly search or read implementation source in the parent.

## Explorer

Use `explorer` for repository discovery, including:

* existing architecture and ownership;
* implementation state;
* callers and consumers;
* tests and fixtures;
* lifecycle and failure paths;
* related plan/build/review evidence;
* cross-file consistency;
* exact repository facts needed to make a decision.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Prefer one primary explorer for related repository questions. Let repository context accumulate there rather than in the parent. Continue with that explorer when a follow-up depends on evidence it already gathered.

Spawn additional explorers only for independent questions that can be investigated without duplicating the same repository context.

Give the explorer:

* a self-contained repository question;
* the narrowest useful paths, symbols, or other anchors already known;
* the decision or plan boundary the evidence will inform.

Require a compact result containing:

* the direct answer;
* relevant `path::symbol` evidence;
* important relationships or constraints;
* material uncertainty or conflicting evidence.

Do not request search history, raw command output, large source excerpts, implementation proposals, or design decisions.

The explorer gathers facts. The parent decides.

Do not repeat explorer discovery in the parent. If its answer is incomplete, ask it to resolve the missing repository fact first. Direct parent source inspection is a last resort and must stay limited to the exact cited location needed for a consequential decision.

If `explorer` is unavailable, use only narrowly targeted direct reads needed to continue. Broad parent-side repository discovery is not an allowed fallback.

## Workflow

1. **Align**

   * Resolve consequential ambiguity in outcome, behavior, ownership, lifecycle, compatibility, non-goals, acceptance, and risk.
   * Ask related unresolved questions together.
   * Recommend an answer when justified.
   * Do not investigate implementation details before direction is clear.

2. **Discover**

   * Identify the repository facts that can change the contract, design, acceptance, or plan boundaries.
   * Delegate repository evidence gathering to `explorer`.
   * Start from user-provided anchors, repository instructions, canonical owners, callers, tests, and existing workflow evidence when known.
   * Ask follow-up repository questions only when the answer can materially change the plan.
   * Stop when the decision-relevant evidence is sufficient.

3. **Design**

   * Resolve the design from the approved requirements and distilled repository evidence.
   * Prefer the canonical owner and existing mechanisms.
   * Add only what the approved outcome requires.
   * Avoid speculative abstractions, state, configuration, compatibility, dependencies, and future-proofing.
   * Return to the user if evidence exposes a consequential undecided choice.

4. **Confirm**

   * Present the proposed contract concisely.
   * Do not write plans until consequential decisions are resolved.

5. **Write**

   * Create or update `plans/<project>/spec.md`.
   * Create ordered `plans/<project>/<NN>-<outcome>.md`.

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

Finish by reporting the approved outcome, consequential decisions, files written, and first plan path. Then stop.
