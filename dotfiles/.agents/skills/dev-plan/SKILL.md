---
name: dev-plan
description: Define one bounded software project, resolve consequential decisions, gather necessary repository evidence, and write executable plans. Never implement
---

# Dev Plan

Define one bounded project. Never implement production code.

`plans/` is Git-ignored workflow state. Access exact paths directly.

## Explorer

Delegate repository discovery to `explorer` whenever answering a concrete repository question requires more than one search or source read.

For `plan` and `replan`, presume repository discovery requires `explorer` unless the answer is already available from a single known file, symbol, caller, or test.

Always spawn with `agent_type="explorer"` and `fork_turns="none"`.

Give it:
- one self-contained repository question;
- the narrowest known scope;
- useful paths, symbols, callers, tests, or plan anchors;
- the specific fact or uncertainty that must be resolved.

Do not perform the same repository discovery in the parent thread.

The parent may directly:
- read one known file or symbol;
- inspect a specific caller or test already identified;
- verify a targeted explorer finding needed for a consequential design decision.

Reuse the explorer for related follow-ups; do not repeat its searches.

Explorer gathers repository facts. You resolve decisions and write the plan.

## Workflow

1. **Align**

   * Resolve consequential ambiguity in outcome, behavior, ownership, lifecycle, compatibility, non-goals, acceptance, and risk.
   * Ask related unresolved questions together.
   * Recommend an answer when justified.
   * Do not investigate implementation details before direction is clear.

2. **Investigate**

   * Verify only facts that can change the contract, design, acceptance, or plan boundaries.
   * Start from user-provided anchors, repository instructions, canonical owners, callers, and tests.
   * Delegate repository discovery to `explorer` unless the required fact is available from one known file, symbol, caller, or test.
   * Keep parent reads surgical and limited to targeted verification or evidence needed for a consequential decision.
   * Do not duplicate explorer searches or broadly rediscover the repository in the parent.
   * Stop when the concrete question is answered.

3. **Design**

   * Prefer the canonical owner and existing mechanisms.
   * Add only what the approved outcome requires.
   * Avoid speculative abstractions, state, configuration, compatibility, dependencies, and future-proofing.
   * Return to the user if evidence exposes a consequential undecided choice.

4. **Confirm**

   * Present the proposed contract concisely.
   * Do not write plans until consequential decisions are resolved.

5. **Write**

   * Create `plans/<project>/spec.md`.
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

The numbered plan is the complete build/review contract. Do not require later agents to reread `spec.md` or rediscover settled repository facts.

Finish by reporting the approved outcome, consequential decisions, files written, and first plan path. Then stop.
