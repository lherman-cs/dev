---
name: dev-spec
description: Define and align on the desired end state for a substantial code change before implementation planning. Use only when explicitly invoked for architectural, ambiguous, or substantial work that needs a durable spec under plans/<project>/spec.md.
---

# Dev Spec

Define the destination. Do not plan the implementation.

Be adversarial about the design, not agreeable. Expose bad assumptions, contradictions, ambiguity, unnecessary complexity, and weak requirements before they enter the spec.

## Resolve

1. Resolve the project and target `plans/<project>/spec.md`.
2. Reuse relevant session context.
3. Inspect the repository only enough to establish:

   * current behavior and architecture;
   * terminology and constraints;
   * decisions already encoded in the system.
4. Resolve factual questions from repository evidence rather than asking the user.

Distinguish:

* repository evidence;
* explicit user decisions;
* assumptions;
* unresolved choices.

Do not turn assumptions, current implementation, or the user's proposed design into requirements without establishing that they are intentional.

## Align

Model the desired end state as a decision tree and work only through the consequential unresolved frontier.

For each consequential decision:

1. Establish the relevant facts.
2. Identify the apparent preferred answer.
3. Try to falsify it.
4. Surface the strongest contradiction, counterexample, hidden cost, or meaningful alternative.
5. Recommend the strongest answer and give the decisive reason.
6. Ask one decision at a time.
7. Challenge the answer further when its consequences remain materially ambiguous.

Do not optimize for agreement.

If the proposed design appears unnecessary, internally inconsistent, more general than required, or weaker than a simpler alternative, say so directly and require the missing justification.

Prefer concise questions such as:

> I recommend **X** because **Y**. **Z** adds **cost/consequence** without satisfying a requirement I can establish. What requirement makes Z necessary?

> These requirements conflict under **scenario**. I don't think both can be invariants. Which one wins?

> **X** is still ambiguous: A and B both satisfy the current wording but behave differently for **case**. Which behavior is intended?

Probe boundaries only when they can materially change the destination, especially:

* ownership and source of truth;
* lifecycle and state transitions;
* failure and partial completion;
* concurrency and ordering;
* resource lifetime and cleanup;
* limits and scale assumptions;
* compatibility and externally observable behavior;
* safety or correctness boundaries.

Do not mechanically enumerate edge cases.

Do not ask about:

* implementation mechanics;
* repository facts that can be established directly;
* inconsequential preferences;
* speculative future cases;
* choices whose alternatives produce effectively the same intended system.

Challenge unexpectedly expensive or generalized designs before accepting them.

If a question is empirical rather than architectural, identify what evidence would settle it instead of treating it as a preference.

## Stop condition

Alignment is complete only when the consequential decision frontier is empty.

Do not stop merely because the design sounds reasonable or the user accepts the recommendations.

Before drafting, actively try to find:

* a consequential assumption never explicitly settled;
* conflicting requirements;
* an important term with multiple plausible meanings;
* a simpler design satisfying the same requirements;
* materially different intended systems that would both satisfy the current wording.

If any survives, continue alignment.

Before drafting, ensure the destination establishes:

* required behavior;
* durable invariants;
* important exclusions;
* observable success criteria.

Continue grilling if two competent engineers could still build materially different intended systems while both reasonably believing they satisfied the requirements.

Do not make the spec exhaustive for its own sake.

## Draft

When aligned, present one concise `DRAFT SPEC`.

Include only:

* **Goal**
* **Requirements**
* **Invariants** — durable constraints not already obvious from the requirements
* **Non-goals / rejected designs** — only decisions worth preserving
* **Acceptance criteria**

Every statement must follow from repository evidence or an explicit user decision.

Prefer short declarative statements.

Do not repeat the same decision across sections.

The spec describes what must be true, not how to make it true.

Exclude:

* migration or sequencing;
* files or symbols to change;
* implementation decomposition;
* test implementation details;
* incidental mechanics;
* speculative future requirements;
* rationale or discussion history unless needed to disambiguate the decision.

Acceptance criteria must be capable of proving an implementation wrong.

## Approval

During alignment:

* ask only the current consequential question;
* push back before moving on when warranted;
* do not narrate repository investigation;
* do not dump questionnaires;
* do not repeatedly summarize settled decisions;
* do not praise or rubber-stamp answers.

After presenting `DRAFT SPEC`, ask only for approval or corrections.

Write:

`plans/<project>/spec.md`

only after explicit approval.

Done when an engineer can judge whether an implementation reaches the intended destination without inventing consequential product or architectural decisions.
