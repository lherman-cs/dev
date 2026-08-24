---
name: dev-spec
description: Define and align on the desired end state for a substantial code change before implementation planning. Use only when explicitly invoked for architectural, ambiguous, or substantial work that needs a durable spec under plans/<project>/spec.md.
---

# Dev Spec

Reach shared understanding of the destination before planning how to get there.

The spec owns intent. Do not design the implementation plan.

## 1. Establish context

1. Resolve the project name from the invocation and target `plans/<project>/spec.md`.
2. Read the task, supplied references, constraints, and explicit rejections.
3. Inspect the repository only as deeply as necessary to understand:
   - current behavior;
   - relevant architecture and terminology;
   - constraints imposed by existing code;
   - decisions already encoded in the system.
4. Resolve factual questions from repository evidence instead of asking the user.
5. Reuse relevant facts and decisions already established in the session. Do not make the user repeat them.

Separate what is:

- known from evidence;
- explicitly decided by the user;
- still unresolved.

Do not turn assumptions into requirements.

## 2. Grill the unresolved design

Treat the desired system as a decision tree.

A decision is ready to ask only when the decisions it depends on are already settled.

Work through the unresolved frontier until no consequential branch remains.

For each unresolved decision:

1. Determine whether repository evidence can resolve it.
2. If not, ask the user.
3. State your recommended answer when you have one, with the key reason.
4. Surface meaningful alternatives or tradeoffs only when they could change the destination.
5. Incorporate the answer into the working model before advancing to dependent questions.

Ask one consequential decision at a time.

Prefer questions of the form:

> I recommend **X** because **Y**. The main alternative is **Z**, which would change **W**. Which behavior do you want?

Do not ask:

- implementation questions that belong in planning;
- questions answerable from the repository;
- speculative edge cases with no effect on the destination;
- preference questions where all answers lead to effectively the same spec;
- broad questionnaires detached from the decisions already established.

If an answer exposes a new consequential branch, pursue it.

If an answer conflicts with repository reality, another requirement, or an earlier decision, surface the conflict rather than silently reconciling it.

If the user's proposed design appears internally inconsistent or creates a significant tradeoff they may not have intended, challenge it before recording it as settled.

## 3. Determine when alignment is complete

Stop investigating and grilling when you can state the desired end state without making consequential assumptions.

Before drafting, explicitly check:

- What must be true?
- What must remain true?
- What must not be built?
- What observable behavior defines success?
- Are any terms ambiguous?
- Are any decisions being inferred rather than agreed or evidenced?
- Could two competent engineers read the current understanding and build materially different products while both believing they satisfied it?

If the last answer is yes because the intended behavior is underspecified, continue grilling.

Do not manufacture decisions merely to make the spec exhaustive.

## 4. Draft the spec

Present `DRAFT SPEC` in the conversation before writing the file.

Keep it concise and include only sections that carry useful information:

- Goal
- Requirements
- Invariants
- Non-goals / rejected designs
- Acceptance criteria

The spec describes the destination, not the route.

Exclude:

- migration sequencing;
- implementation phases;
- file-by-file changes;
- task breakdowns;
- incidental implementation mechanics;
- speculative future requirements.

Prefer observable behavior and durable architectural constraints over implementation prescriptions.

Record rejected designs only when remembering the rejection prevents likely future ambiguity or backtracking.

Do not silently expand scope while translating the conversation into the spec.

## 5. Commit the shared understanding

After presenting `DRAFT SPEC`:

1. Ask the user to approve it or identify remaining disagreement.
2. Treat corrections as evidence that alignment was incomplete; update the working model accordingly.
3. Re-grill any consequential ambiguity exposed by the corrections.
4. Write `plans/<project>/spec.md` only after explicit approval.

Done when an engineer can judge whether an implementation reaches the intended destination without being told how to implement it, and neither the engineer nor the LLM needs to invent consequential product or architectural decisions.
