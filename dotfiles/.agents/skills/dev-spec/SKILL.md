---
name: dev-spec
description: Define and align on the desired end state for a substantial code change before implementation planning. Use only when explicitly invoked for architectural, ambiguous, or substantial work that needs a durable spec under plans/<project>/spec.md.
---

# Dev Spec

Define the destination. Do not plan the implementation.

Be adversarial about the design, not agreeable. The purpose of alignment is to expose bad assumptions, contradictions, ambiguity, and unnecessary complexity before they become requirements.

## Resolve

1. Resolve the project and target `plans/<project>/spec.md`.
2. Reuse relevant session context.
3. Inspect the repository only enough to establish:

   * current behavior and architecture;
   * terminology and constraints;
   * decisions already encoded in the system.
4. Resolve factual questions from repository evidence rather than asking the user.

Distinguish evidence, user decisions, assumptions, and unresolved choices.

Do not turn assumptions, existing implementation, or the user's proposed design into requirements without establishing that they are intentional.

## Align

Model the desired end state as a decision tree and work through only the consequential unresolved frontier.

For each consequential decision:

1. Establish the relevant facts.
2. Identify the apparent preferred answer.
3. Try to falsify it before accepting it.
4. Surface the strongest contradiction, counterexample, hidden cost, or meaningful alternative.
5. Recommend the answer you believe is strongest and give the decisive reason.
6. Ask one decision at a time.
7. After the answer, challenge it further if its consequences remain ambiguous.

Do not optimize for agreement.

If the user's proposed design appears unnecessary, internally inconsistent, more general than the requirements demand, or weaker than a simpler alternative, say so directly and make them defend the requirement that justifies it.

Prefer concise questions:

> I recommend **X** because **Y**. Your proposed **Z** adds **cost/consequence** without satisfying any requirement I can establish. What requirement makes Z necessary?

> These two requirements conflict under **scenario**. I don't think both can be invariants. Which one wins?

> **X** is still ambiguous: implementations A and B would both satisfy what you said but behave differently for **case**. Which behavior is intended?

Probe boundaries only when they could materially change the destination, especially:

* ownership and source of truth;
* lifecycle and state transitions;
* failure and partial completion;
* concurrency and ordering;
* limits and scale assumptions;
* compatibility and externally observable behavior.

Do not mechanically enumerate edge cases.

Do not ask about:

* implementation mechanics;
* repository facts you can determine yourself;
* inconsequential preferences;
* speculative future cases;
* choices whose alternatives produce effectively the same intended system.

Challenge unexpectedly expensive designs before accepting them.

If a question is empirical rather than architectural, identify what evidence would settle it instead of treating it as a preference.

## Stop condition

Alignment is complete only when the consequential decision frontier is empty.

Do not stop because the design sounds reasonable or because the user agrees with your recommendations.

Before drafting, actively try to find:

* a consequential assumption that was never decided;
* two requirements that can conflict;
* an important term with multiple plausible meanings;
* a simpler design satisfying the same requirements;
* two materially different intended implementations that both satisfy the current understanding.

If any survives, continue grilling.

Before drafting, ensure you know:

* required behavior;
* durable invariants;
* important exclusions;
* observable success criteria.

Continue only if two competent engineers could still implement materially different intended systems while both believing they satisfied the requirements.

Do not make the spec exhaustive for its own sake.

## Review output

Optimize conversation output for user review, not documentation.

During alignment:

* ask only the current consequential question;
* push back when warranted before moving on;
* do not narrate repository investigation;
* do not dump questionnaires;
* do not repeatedly summarize settled decisions;
* do not praise or rubber-stamp answers.

When aligned, present one concise `DRAFT SPEC`.

Include only:

* **Goal**
* **Requirements**
* **Invariants** — only durable constraints not obvious from requirements
* **Non-goals / rejected designs** — only decisions worth preserving
* **Acceptance criteria**

Every statement must follow from repository evidence or an explicit user decision.

Prefer short declarative statements.

Do not restate the same decision across sections.

The spec describes what must be true, not how to make it true.

Exclude:

* migration or sequencing;
* file and symbol changes;
* implementation decomposition;
* incidental mechanics;
* speculative future requirements;
* rationale or discussion history unless necessary to disambiguate a decision.

Acceptance criteria must be capable of proving an implementation wrong.

After the draft, ask only for approval or corrections.

Write `plans/<project>/spec.md` after explicit approval.

Done when an engineer can judge whether an implementation reaches the intended destination without inventing consequential product or architectural decisions.
