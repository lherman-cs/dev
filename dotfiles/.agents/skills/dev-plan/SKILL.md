---
name: dev-plan
description: Define one bounded software project through rigorous user alignment, resolve consequential decisions, gather necessary repository evidence, and write executable numbered plans. Never implement.
---
# Dev Plan
Define one bounded project. Never modify production code.
`plans/` is Git-ignored workflow state. Access exact paths directly.
Read `references/context.md` before investigation; its main-thread boundary and explorer ownership rules apply throughout.

## Workflow

1. **Align**
   - Treat alignment as an interactive design interview, not requirements transcription.
   - Do not explore the repository or write a plan until the intended direction is sufficiently clear to make repository discovery targeted.
   - Interrogate the request for hidden assumptions, underspecified behavior, conflicting goals, unnecessary complexity, and decisions the user may not realize they are making.
   - Challenge weak premises and proposed solutions when a simpler, more coherent, or more canonical direction may exist.
   - Work backward from the desired outcome and public behavior before discussing implementation.
   - Cover consequential ambiguity in outcome, behavior, ownership, lifecycle, compatibility, non-goals, acceptance, migration, failure semantics, and risk where relevant.
   - Ask related questions in small coherent batches rather than one at a time or as an exhaustive questionnaire.
   - For each meaningful choice, explain the tradeoff concisely and recommend a default when justified. Do not make the user invent an answer the planner can responsibly recommend.
   - Follow answers wherever they expose another consequential ambiguity. Continue until remaining uncertainty is either immaterial or explicitly delegated to repository discovery.
   - Periodically restate the emerging contract and actively look for disagreement: "If we build exactly this, is anything important wrong or missing?"
   - Do not accept vague agreement when materially different implementations would still satisfy the stated requirements.

2. **Discover**
   - Translate the aligned direction into specific repository questions before spawning explorers.
   - Identify only repository facts that can change the contract, design, acceptance, or plan boundaries.
   - Partition independent repository questions and run useful explorers concurrently.
   - Discovery answers repository questions; it must not silently decide unresolved product or design questions.
   - Ask the user follow-ups whenever evidence exposes a consequential choice that was not settled during alignment.
   - Verify relevant toolchain availability, baseline checks, input suppliers, ownership, and integration points; use targeted disposable probes for consequential uncertainty, never production implementation.
   - Stop when decision-relevant evidence is sufficient. Repository facts go to discovery; consequential behavior choices go back to the user, not to a builder.

3. **Design**
   - Resolve the design from approved requirements and distilled evidence.
   - Prefer canonical owners and existing mechanisms.
   - Add only what the outcome requires.
   - Avoid speculative abstraction, state, configuration, compatibility, dependencies, and future-proofing.
   - Challenge the emerging design once more for unnecessary machinery, duplicated ownership, ambiguous lifecycle, and accidental compatibility commitments.
   - Return to the user if evidence exposes a consequential undecided choice.

4. **Confirm**
   - Present the proposed contract concisely in terms of outcome, externally meaningful behavior, key design decisions, non-goals, and acceptance.
   - Explicitly distinguish binding decisions from implementation guidance. Do not conceal an unresolved consequential decision in an assumption.
   - Before approval, have an independent reviewer challenge design, input/ownership completeness, feasibility evidence, dependency order, and executable acceptance; resolve findings and return new consequential choices to the user.
   - Ask for correction or confirmation when the contract contains consequential choices not already explicitly approved.
   - Do not finalize numbered plans until consequential decisions are resolved; a clearly marked draft may support independent challenge.
   - Confirmation is a gate, not a summary ritual.

5. **Write**
   - Create or update `plans/<project>/spec.md`: binding contract, explicit non-goals, confirmed decisions, and acceptance. Reuse existing wording and numbering; IDs are optional.
   - Document concrete final checks, including required manual evidence: inputs, commands/procedure, and expected outcomes. Distinguish achievable preparation work from unresolved feasibility blockers.
   - Create ordered `plans/<project>/<NN>-<outcome>.md` as the smallest practical verifiable outcomes, including required integration and failure-path checks rather than deferring them all to the end.
   - Write each numbered plan so a builder can execute it without recovering intent, making consequential design choices, or consulting sibling artifacts.
   - Read only exact existing sections needed for a surgical edit; do not reload whole plan sets after discovery.
   - Verify structure and changed sections without rereading unchanged artifacts.

Use these sections for new plans; equivalent existing sections are valid. Preserve accepted plans unchanged; missing template fields are not a reason to replan.

```markdown
# <Milestone>

## Outcome
<one coherent result>

## Scope
<complete milestone-specific behavior>

## Constraints
<only consequential constraints>

## Implementation guidance
<nonbinding approach; binding architecture belongs in Constraints>

## Verified preconditions
- <fact already verified in the current repository, with evidence; not a future plan output>

## Repository handoff
- Canonical owner: `<path>::<symbol>`
- Starting points: `<paths/symbols>`
- Direct callers / consumers: `<paths/symbols or None>`
- Relevant tests: `<tests or None>`
- Completeness checks: `<scoped checks or None>`

## Acceptance
- <owned binding obligation and exact milestone-specific verification evidence>

## Dependencies
- `plans/<project>/<NN>-<prerequisite>.md` — <consumed output>; use None when empty
```

The numbered plan is the complete build/review contract. A builder must be able to execute it without recovering intent, making consequential design decisions, consulting `spec.md` or sibling plans, or performing broad repository discovery.

After normal planning, ask an independent reviewer to evaluate the actual written plans for READINESS; use existing readiness evidence where it still applies.
Challenge design, feasibility, dependencies, obligation ownership, and verification coverage; record the result in `readiness.review.md` or the existing equivalent.
Resolve consequential readiness findings before reporting READY; review material plan changes, not cosmetic edits. Do not repeat grilling or completed discovery without new evidence.
For MAINTAIN, propose only the necessary guidance, boundary, or dependency change in a note or diff; preserve approved behavior and accepted plan text.
Explain why and where each affected obligation, finding, and check will live. The parent obtains independent review before applying the proposal; no special directory or hash is needed.
Binding outcomes, interfaces, ownership, behavior, constraints, and explicitly approved architecture require user approval to change; implementation guidance may adapt without changing them.
Report `Project: <exact-project-directory>` and `Status: READY`, the approved outcome, decisions, files, and first plan path. Then stop; execution requires a separate project invocation.
