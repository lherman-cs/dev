---
name: dev-plan
description: Define one bounded software project with the user and write a concise spec plus coarse implementation plans. Use before substantial or architectural work, or when implementation evidence invalidates an existing plan.
---

# Dev Plan

Plan with the user as a senior software engineer.

This skill runs in a dedicated planning session. Do not implement production
code, spawn subagents, or continue into implementation. The repository is the
durable source of truth; this conversation is temporary working context.

## Establish the project

Before broad investigation:

1. State the intended deliverable in one sentence.
2. Inspect repository and Git state enough to establish the relevant baseline.
3. Read the ownership README and architecture documents for every directly
   affected module.
4. Decide whether the request is one project with one final acceptance
   boundary.

A project may contain several implementation milestones, but they must all be
necessary parts of one primary outcome.

If the request contains independent outcomes with their own acceptance
boundaries, split them into separate projects rather than creating one large
plan tree.

Do not run broad validation suites while planning unless their result is
necessary to settle a consequential design question.

## Establish the design

Investigate only enough to make consequential decisions correctly.

Distinguish:

* repository facts;
* external facts;
* user decisions;
* engineering judgments;
* unresolved assumptions.

Treat existing ownership READMEs, architecture documents, and explicitly
accepted design decisions as authoritative unless repository evidence shows
they are stale or contradictory.

Verify any premise whose failure would make substantial implementation
disposable. Prefer:

1. current repository behavior;
2. primary upstream documentation or source;
3. a narrow executable probe;
4. inference only when the consequence is small.

Challenge weak designs. Recommend the strongest simple option rather than
merely recording every proposed idea.

Ask the user only about consequential choices that cannot be responsibly
resolved from repository evidence or ordinary engineering judgment. Ask one
such question at a time.

Do not introduce speculative requirements for future scale, portability,
compatibility, abstraction, or cleanup unless the requested outcome requires
them.

Before finalizing the design, actively try to falsify it.

A consequential unresolved premise must become either:

* a resolved decision;
* an explicit accepted risk; or
* an earlier proof milestone.

## Prefer early vertical evidence

Order implementation so the earliest practical milestone proves the riskiest
boundary capable of invalidating later work.

When a project introduces a new protocol, binding, runtime, interoperability
boundary, public API, storage model, concurrency model, or external
integration, prefer a small end-to-end walking slice before broad
implementation.

Do not build several architectural layers on top of an unproven boundary.

Internal tests prove internal behavior. When the actual contract is browser,
network, protocol, generated binding, platform, or third-party
interoperability, require the narrowest independent or end-to-end evidence that
proves that contract.

## Size implementation plans for fresh build sessions

Each numbered plan is one coherent implementation outcome for:

* one fresh `$dev-build` session;
* one independently reviewable commit;
* one fresh `$dev-review` session.

Plans are coarse engineering outcomes, not microtasks.

A plan is too large when it combines several independently testable behavioral
boundaries, requires several unrelated migrations, or is likely to need a long
sequence of largely independent implementation/debugging loops.

A plan is too small when it describes an individual function, type, file,
compiler fix, or mechanical step that has no useful acceptance boundary by
itself.

Prefer vertical slices that leave the repository in a coherent state.

The expected normal case is that one plan can be implemented and verified
without context compaction. Do not enlarge a plan merely to reduce the number
of commits.

Do not encode speculative implementation details for later milestones. Future
plans should state their required outcome, constraints, and evidence. The
current repository after earlier milestones will supply their implementation
context.

If implementation later disproves a future plan assumption, `$dev-plan` should
revise the remaining plans rather than forcing the stale design through
`$dev-build`.

## Write the project

Create:

`plans/<project>/spec.md`

with only:

* **Outcome** — the single concrete final deliverable.
* **Required behavior** — externally or architecturally significant behavior
  that must be true.
* **Design / invariants** — consequential ownership, lifecycle, protocol, API,
  failure, or architecture decisions.
* **Non-goals** — nearby work intentionally excluded.
* **Acceptance** — evidence that proves the complete project correct.
* **Accepted risks** — unresolved consequential assumptions explicitly
  accepted by the user.

Omit empty sections.

Do not include discussion history, generic engineering advice, implementation
choreography, or facts already adequately owned by a repository architecture
document.

When a design decision is durable beyond this project, update the appropriate
tracked README or architecture document instead of relying only on the plan.

Then create ordered coarse plans:

`plans/<project>/01-<outcome>.md`
`plans/<project>/02-<outcome>.md`

and so on.

Use this format:

# <Milestone>

## Outcome

<one independently reviewable result that becomes true>

## Scope

* required behavior and important affected surfaces
* migration or integration boundary when relevant

## Constraints

* only consequential ownership, lifecycle, protocol, compatibility, API, or
  failure semantics specific to this milestone

## Verification

* focused evidence that can prove the outcome wrong or complete
* broader integration gates only when this milestone needs them

## Dependencies

* earlier plans or external prerequisites only when required

Every plan must be understandable from the current repository, the project
spec, and its referenced architecture documents without requiring the planning
conversation.

## Final audit

Before finishing:

1. Re-read the project outcome and non-goals.
2. Confirm the design does not contradict affected ownership documentation.
3. Confirm the riskiest consequential assumptions are either proven early or
   explicitly accepted.
4. Confirm each plan has one coherent acceptance boundary.
5. Confirm no plan depends on conversation-only knowledge.
6. Remove speculative implementation detail that later repository state should
   decide.
7. Confirm the ordered plans collectively satisfy project acceptance without
   adding unrelated work.

Do not run repository-wide test suites solely to validate that markdown plans
were written.

## Handoff

Report only:

* the project outcome;
* consequential decisions or accepted risks;
* created or updated spec/plan/architecture files;
* the exact first numbered plan to execute.

Then stop.

Do not implement the first plan in this session.
