---
name: dev-spec
description: Define and align on the desired end state for a substantial code change before implementation planning. Use only when explicitly invoked for architectural, ambiguous, or substantial work that needs a durable spec under plans/<project>/spec.md.
---

# Dev Spec

Define the destination. Do not plan the implementation.

## Resolve

1. Resolve the project and target `plans/<project>/spec.md`.
2. Reuse relevant session context.
3. Inspect the repository only enough to establish:
   - current behavior and architecture;
   - terminology and constraints;
   - decisions already encoded in the system.
4. Resolve factual questions from repository evidence rather than asking the user.

Distinguish evidence, user decisions, and unresolved choices.
Do not turn assumptions into requirements.

## Align

Work through only consequential unresolved decisions.

For each:

1. Resolve it from evidence when possible.
2. Otherwise ask one decision at a time.
3. Recommend an answer when useful, with the decisive reason.
4. Mention alternatives only when choosing them would materially change the destination.
5. Surface conflicts with earlier decisions, requirements, or repository reality.

Prefer concise questions:

> I recommend **X** because **Y**. **Z** is the meaningful alternative and would change **W**. Which do you want?

Do not ask about:

- implementation mechanics;
- repository facts you can determine yourself;
- inconsequential preferences;
- speculative edge cases;
- decisions whose alternatives produce effectively the same destination.

Challenge internally inconsistent or unexpectedly costly designs before accepting them.

## Stop condition

Alignment is complete when the desired end state can be stated without consequential assumptions.

Before drafting, ensure you know:

- required behavior;
- durable invariants;
- important exclusions;
- observable success criteria.

Continue only if two competent engineers could still implement materially different intended products while both believing they satisfied the requirements.

Do not make the spec exhaustive for its own sake.

## Review output

Optimize conversation output for user review, not documentation.

During alignment:

- ask only the current consequential question;
- do not narrate repository investigation;
- do not summarize settled decisions repeatedly.

When aligned, present one concise `DRAFT SPEC`.

Include only:

- **Goal**
- **Requirements**
- **Invariants** — only durable constraints not obvious from requirements
- **Non-goals / rejected designs** — only decisions worth preserving
- **Acceptance criteria**

Omit background, rationale, repository facts, and discussion history unless necessary to understand a decision.

Prefer short declarative statements.
Do not restate the same decision across sections.

The spec describes what must be true, not how to make it true.

Exclude:

- migration or sequencing;
- file and symbol changes;
- implementation decomposition;
- incidental mechanics;
- speculative future requirements.

After the draft, ask only for approval or corrections.

Write `plans/<project>/spec.md` after explicit approval.

Done when an engineer can judge whether an implementation reaches the intended destination without inventing consequential product or architectural decisions.
