---
name: dev-plan
description: Define one bounded software project with the user and write a concise spec plus coarse implementation plans. Use before substantial or architectural work; reject multi-project scope early.
---

# Dev Plan

Plan with the user as a senior software engineer.

Stay in the current primary thread. Do not spawn subagents or implement
production code. A small disposable probe is allowed only when it is the
cheapest way to settle a consequential fact.

## Gate the project

Before broad investigation:

1. State the intended deliverable in one sentence.
2. Inspect enough repository and Git state to establish the relevant baseline
   and boundary.
3. Decide whether the request is one project.

One project has one primary outcome and one final acceptance boundary. Its
plans are necessary milestones toward that outcome, not independent roadmap
outcomes.

If the request includes another outcome with its own acceptance boundary, or
work that remains valuable even if the primary outcome is never delivered,
stop early. Propose the smallest sensible project split and ask the user to
choose one. Do not plan multiple projects in one invocation.

Treat optional cleanup and adjacent improvements as non-goals. Re-run this gate
whenever investigation materially expands the scope. A long plan list or
unrelated validation domains are evidence that the project may be too broad;
they are not reasons to create finer plans.

## Establish the design

Keep the outcome and non-goals visible throughout the conversation.

- Inspect the repository narrowly and read only relevant supporting docs.
- Distinguish repository facts, external facts, user decisions, and
  assumptions.
- Verify any assumption whose failure would make substantial implementation
  disposable. Prefer primary sources, upstream code, current repository
  behavior, or a focused executable probe.
- Challenge weak designs and recommend the strongest simple option.
- Ask one consequential product or architectural question at a time. Do not
  ask questionnaires or delegate ordinary engineering judgment back to the
  user.
- Do not introduce performance, scale, portability, compatibility, cleanup,
  or future-generalization requirements unless the stated outcome requires
  them.

Before finalizing, try to falsify the proposed design. A consequential
unresolved premise is a blocker or an explicit user-accepted risk, not a
hidden assumption.

## Choose convincing evidence

Match evidence to the claim. Internal tests can prove internal invariants; they
cannot alone prove interoperability or user-visible behavior against an
independent implementation.

When that distinction matters, require the narrowest external or end-to-end
oracle that proves the real contract. Order the plans so the earliest feasible
milestone retires the risk most capable of invalidating later work. Do not
schedule a broad migration before that boundary is proved.

## Write the project

Create `plans/<project>/spec.md` with only:

- **Outcome** — the single concrete deliverable.
- **Required behavior** — what must be true.
- **Design / invariants** — consequential decisions and boundaries.
- **Non-goals** — nearby work intentionally excluded.
- **Acceptance** — evidence that proves the project complete and correct.
- **Accepted risks** — only unresolved consequential assumptions the user
  explicitly accepts.

Omit empty sections. Do not include discussion history, generic engineering
guidance, or implementation choreography.

Then create ordered coarse plans:

`plans/<project>/01-<outcome>.md`
`plans/<project>/02-<outcome>.md`

Each plan is one coherent implementation outcome for one dedicated build chat
and one commit. It must be understandable, implementable, verifiable, and
reviewable as a whole.

If two plans require shared live implementation context, merge them. If a plan
contains an optional independent outcome, remove it to follow-up scope; if
that outcome is required by the original request, split the project.

Use this format:

```markdown
# <Milestone>

## Outcome
<what is true when this plan is complete>

## Scope
- required behavior and important affected surfaces
- migration or integration boundary, when relevant

## Constraints
- only consequential ownership, lifecycle, protocol, compatibility, or
  failure semantics

## Verification
- evidence that can prove the outcome wrong or complete

## Dependencies
- earlier plans or external prerequisites, only when required
