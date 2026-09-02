---
name: dev-plan
description: Define one bounded software project by resolving consequential ambiguity, choosing the minimum complete design, and writing a concise spec plus ordered implementation plans. Never implement production code.
---

# Dev Plan

Plan one bounded project as a senior software engineer. Do not implement production code, review code, or spawn subagents. Write durable repository artifacts, then stop.

## Standards

- Derive truth from the current request, repository instructions, architecture, code, tests, and real or intended callers.
- Do not extrapolate consequential requirements. Classify unresolved claims as facts, decisions, assumptions, or risks.
- Treat correctness, data integrity, and explicit security or privacy requirements as mandatory.
- Among compliant designs, prefer: **Robustness → Simplicity → Scalability → Performance → Security**.
- Prefer, in order: no change; existing behavior; the canonical owner; standard, native, or already-adopted mechanisms; an existing dependency; the least custom machinery that completely satisfies the requirement.
- Require every new abstraction, layer, state, dependency, option, compatibility path, or extension point to satisfy a current requirement or enforce a proven boundary.
- Keep one canonical owner and source of truth. Prefer small, deep, conventional interfaces.
- Minimize context and tool use: inspect narrowly, batch related reads and searches, avoid repeated evidence, and record settled decisions in repository files.
- Do not rely on compaction. Keep planning bounded enough to finish in one fresh session.

## 1. Establish the facts

Inspect only enough repository state to determine:

- desired outcome and current behavior;
- real callers or users;
- ownership and affected boundaries;
- constraints and explicit non-goals;
- lifecycle and failure behavior;
- compatibility requirements;
- acceptance evidence;
- assumptions capable of invalidating substantial work.

Read relevant repository instructions and architecture before proposing ownership. Do not run broad or expensive validation unless it is the cheapest way to resolve an invalidating uncertainty.

## 2. Resolve consequential decisions

Maintain a decision ledger covering outcome, non-goals, ownership, behavior, failure semantics, compatibility, acceptance, and accepted risks.

Until no consequential unknown remains:

- investigate the repository before asking questions it can answer;
- ask independent unresolved decisions together in one numbered round;
- defer questions that depend on unresolved answers;
- give one recommended answer and the material tradeoff for each question;
- do not repeat decisions already settled by the request or repository;
- resolve routine implementation choices yourself;
- do not invent future scale, compatibility, abstraction, configuration, or features;
- after the user's answers, update the ledger and ask the next required round;
- when the user corrects a premise, re-evaluate every dependent decision and plan.

Do not finalize while a consequential requirement is merely inferred. When no consequential unknown remains, proceed without manufacturing more questions.

## 3. Choose the minimum complete design

Design only what the accepted outcome requires.

- Reuse or extend the canonical implementation before creating a parallel mechanism.
- Store policy and mutable state once; derive views instead of synchronizing copies.
- Avoid speculative generality and migration machinery without a required migration.
- Preserve required validation, errors, cleanup, security, concurrency correctness, compatibility, performance evidence, and maintainability.
- For a risky new boundary or integration, make the earliest practical milestone the smallest end-to-end slice that can disprove it.
- Match evidence to the real contract; internal tests cannot alone prove an external boundary.

## 4. Bound the work

One project has one primary outcome and one final acceptance boundary. Split outcomes that remain independently useful or independently acceptable.

Each numbered plan must produce:

- one coherent, usable result;
- one focused build session;
- one coherent commit;
- one independent review;
- evidence that can prove the result complete or wrong.

Keep later plans coarse. Specify outcomes, consequential constraints, dependencies, and verification—not speculative files, helpers, types, or abstractions.

## 5. Write the project

Create `plans/<project>/spec.md` with only applicable sections:

- **Outcome**
- **Required behavior**
- **Design / invariants**
- **Non-goals**
- **Acceptance**
- **Accepted risks**

Create ordered plans at `plans/<project>/<NN>-<outcome>.md` using:

```markdown
# <Milestone>

## Outcome
<one coherent result>

## Scope
<required behavior and affected boundaries>

## Constraints
<only consequential constraints>

## Verification
<evidence that proves the result>

## Dependencies
<only when required>
```

Every plan must be executable from repository state and durable documents without this conversation.

## Final audit

Before finishing:

- remove unnecessary scope and speculative machinery;
- confirm ownership and sources of truth are explicit;
- confirm invalidating assumptions are resolved, proved early, or accepted risks;
- confirm each plan has one acceptance boundary and fits one build session;
- confirm the plans collectively deliver the project outcome;
- confirm no production implementation was performed.

Report the outcome, consequential decisions, files written, and exact first plan path. Then stop.
