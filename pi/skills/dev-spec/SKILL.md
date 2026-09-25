---
name: dev-spec
description: Derive full human alignment on the smallest coherent shippable outcome before implementation.
disable-model-invocation: true
---

# dev-spec

Turn the request into the smallest decision-complete outcome the human actually wants. Optimize for alignment quality, not speed to a draft.

- Read `../../references/reconcile.md` at entry and reconstruct existing intent, decisions, constraints, and unresolved branches. Read `../../references/engineering.md` before recommending an approach.
- Start from the desired product or user outcome and its motivation. Do not merely formalize the first plausible interpretation of the request.
- Drive a thorough conversation over consequential semantics: observable behavior, important invariants, compatibility, failure behavior, tradeoffs, scope boundaries, non-goals, risks, and acceptance evidence.
- Work through the local Spec webpage from initial clarification through approval. Publish the evolving durable Markdown with `spec_publish` and phase-specific sections, open decisions, and a recommendation; use stable subject IDs. For consequential decisions, write a plain-language issue, consequence, recommendation with its main tradeoff, and only useful item-specific mental model, evidence/code references or semantic visual data. When useful, publish a short decision title/summary, why the recommendation wins, and two or three clearly distinguished options with a recommended option ID. Prefer a structured visual only when spatial, sequential, state, comparison, or dependency structure materially helps the human decide; do not duplicate prose with decorative diagrams. The page renders one decision at a time; do not embed layout markup. Reply to each in-page request using its exact requestId via `spec_reply`, or `spec_publish` with a contextual reply when material content changes. Keep material answers in the Markdown and current published view. Ask one focused consequential question at a time with a recommended answer and alternatives. Do not ask for phase-internal input in the terminal.
- Continuously classify uncertainty: answer repository questions through scoped exploration, resolve routine engineering choices yourself, and ask the human only where their intent materially changes the outcome. Explore independent factual questions concurrently.
- Actively narrow scope. Separate required behavior from nice-to-have or follow-on work, remove speculative or generalized requirements, and prefer the smallest coherent shippable slice that preserves the important invariants.
- Prefer one spec per coherent shippable unit. When the request bundles independently valuable or testable outcomes, or splitting would materially reduce implementation or review risk, propose concrete spec boundaries and sequencing. Let the human choose the split; keep the current spec limited to the selected slice.
- Trace enough end-to-end behavior, ownership, callers/callees, and failure paths to ensure decisions are grounded in the repository rather than hypothetical.
- Implementation design belongs to build. Record an architectural constraint only when it is itself part of the approved semantics, compatibility contract, or scope boundary. Do not design implementation tasks or manage worktrees.
- maintain concise semantic prose in `plans/<project>/spec.md`: motivation, outcome, behavior, decisions, invariants, constraints, non-goals, risks, acceptance evidence, and deferred follow-ons.

Finish only when the material decision tree is resolved, scope exclusions are explicit, and the build target is narrow enough that implementation has little room to solve the wrong problem while retaining freedom over routine engineering. Present semantics and deferred follow-ons in the webpage. The human explicitly approves the exact current displayed revision there; the workspace records `Status: APPROVED` after that action. Do not infer approval from discussion, a saved marker, or closing the page. After semantic changes obtain renewed approval.
