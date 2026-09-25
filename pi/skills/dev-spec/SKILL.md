---
name: dev-spec
description: Derives human-approved, decision-complete semantics for the smallest coherent shippable outcome before implementation. Use when a request needs product, behavioral, compatibility, scope, or acceptance decisions resolved before build.
disable-model-invocation: true
---

# dev-spec

Produce the smallest decision-complete spec for what the human actually wants.

An approved spec MUST leave no material product behavior, invariant, scope boundary, compatibility contract, failure behavior, or acceptance condition for the builder to guess. Preserve builder freedom over routine implementation choices.

## Grounding

- Read `../../references/reconcile.md` at entry. Reconstruct existing intent, decisions, constraints, and unresolved branches. Current explicit human direction overrides older context when they conflict.
- Explore the repository to resolve factual questions about existing behavior, ownership, compatibility, and end-to-end consequences. Read `../../references/engineering.md` before recommending an engineering direction.
- Keep human decisions, repository facts, agent recommendations, and unresolved questions distinct. Never silently turn an assumption or recommendation into a requirement.

## Alignment loop

1. **Establish intent.** Understand the desired outcome and why it matters before formalizing a solution. Do not anchor on the first plausible interpretation.
2. **Find consequential uncertainty.** Identify only ambiguities whose answers could materially change observable behavior, invariants, compatibility, scope, failure behavior, or acceptance.
3. **Resolve by leverage.** Ask one highest-leverage question at a time. Recommend one answer with concise rationale; present alternatives only when they represent meaningfully different outcomes. Do not ask the human to decide routine engineering.
4. **Ground before asking.** Resolve repository facts through scoped exploration. Explore independent factual questions concurrently when useful.
5. **Narrow aggressively.** Separate required behavior from optional or follow-on work. Remove speculative generality. Prefer the smallest coherent shippable slice that preserves the important invariants.
6. **Validate alignment.** Before approval, compare the spec against the human's request, conversation decisions, reconciliation context, and relevant repository evidence. Look specifically for contradictions, unstated assumptions, undefined edge/failure behavior, accidental scope, and acceptance criteria that permit materially different interpretations. Resolve anything consequential.
7. **Approve explicitly.** Present the final semantics and deferred follow-ons to the human. Revise until explicitly approved. Only then set `Status: APPROVED`.

## Scope splitting

Prefer one spec per coherent shippable unit.

When independently valuable or testable outcomes are bundled, or splitting materially reduces implementation or review risk, propose concrete boundaries and sequencing. Let the human choose. Keep the active spec limited to the selected slice.

## Spec boundary

Specify **what must be true**, not how to implement it.

Include architectural or implementation constraints only when they are themselves approved semantics, compatibility requirements, or scope boundaries. Do not design implementation tasks, prescribe incidental internals, or manage worktrees.

An approved spec MUST NOT contain unresolved material questions, implicit behavioral assumptions, or language such as `TBD` for requirements the builder needs to satisfy. Resolve them or explicitly defer them outside the active scope.

## Artifact

Maintain `plans/<project>/spec.md` as the compact source of truth. Keep it semantic, not conversational.

Use only applicable sections:

```markdown
# <Outcome>

Status: DRAFT | APPROVED

## Motivation
Why this outcome matters.

## Outcome
The smallest coherent result being shipped.

## Behavior
Externally or system-observable behavior that defines the outcome.

## Decisions
Consequential choices explicitly settled during alignment.

## Invariants
Properties that must remain true across valid implementations.

## Constraints
Compatibility, architectural, operational, or scope constraints that materially restrict the solution.

## Non-goals
Plausible interpretations intentionally excluded from this spec.

## Acceptance evidence
Observable evidence sufficient to determine whether the outcome satisfies the spec.

## Risks
Only material risks that could invalidate the outcome or require a different decision.

## Deferred
Explicit follow-on work excluded from this slice.

## Open questions
Material unresolved decisions. DRAFT only; omit when APPROVED.
```

Do not preserve discussion history or rejected alternatives unless needed to prevent a likely future misinterpretation.

Finish only when the active scope is narrow, material decisions are resolved, exclusions are explicit, acceptance is falsifiable, and a competent builder can implement the outcome without inventing product semantics.
