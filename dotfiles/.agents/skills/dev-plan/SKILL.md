---
name: dev-plan
description: Align deeply on a project, challenge weak ideas, produce an authoritative spec, and decompose it into small human-reviewable vertical slices.
---

# Dev Plan

Turn a project idea into an unambiguous contract and an ordered set of reviewable vertical slices.

Tenets, in order:

1. Robustness first.
2. Simple by design.
3. Performance without cleverness.

## Alignment

Before planning, understand the problem deeply.

Grill the user on material ambiguity: product behavior, public APIs, ownership, invariants, compatibility, architecture, operational risk, and irreversible choices.

Challenge the proposed approach when a simpler, safer, more robust, or more coherent design exists. Be willing to recommend not building something.

Do not challenge decisions merely for discussion. Focus on choices with meaningful consequences.

Do not ask the user questions that repository inspection can answer.

Resolve minor implementation details yourself. Do not begin planning while a material product, API, or architectural decision remains unresolved.

Use concise pseudocode when it materially clarifies behavior, ownership, state transitions, or control flow.

## Exploration

Use `spawn_agent` with an `explorer` agent for repository discovery and evidence gathering.

* Spawn every explorer with `fork_turns = "none"`; never rely on inherited parent context.
* Give each explorer exactly one self-contained, narrowly scoped question or decision to investigate.
* Include only the context required to answer that question in the spawn prompt.
* Multiple explorers may run when useful.
* Spawn independent explorer questions in parallel.
* Reuse an existing explorer for a closely related follow-up when practical.
* Require compact output: conclusion, evidence, relevant paths/symbols, and material uncertainty.
* Do not ask explorers to broadly inspect or rediscover the repository.
* Do not rediscover facts already established in the parent or prior explorer findings.
* Keep repository discovery out of the parent context except for compact returned findings.

## Specification

Write:

`plans/<project>/spec.md`

Use a short kebab-case project name.

The spec is the authoritative durable contract. Keep it concise and include only what future implementation and review need:

* goal and observable outcome;
* non-goals;
* behavioral and architectural invariants;
* public/API contracts when applicable;
* important decisions and constraints;
* acceptance criteria;
* materially rejected alternatives and why.

Do not leave material unresolved questions in the spec.

Do not turn the spec into an implementation diary.

## Plans

Write ordered plans:

`plans/<project>/01-<name>.md`
`plans/<project>/02-<name>.md`
...

Each plan is the smallest coherent vertical slice that:

* delivers one meaningful behavior end-to-end;
* leaves the repository valid;
* can be implemented and verified independently;
* deserves one isolated human-reviewable commit.

Optimize for enjoyable review, not minimum line count.

Each numbered plan must be self-contained enough for a builder to execute without reconstructing the planning conversation.

Include:

* objective;
* relevant contract and constraints;
* affected areas;
* implementation requirements;
* verification and acceptance criteria.

Reference `spec.md` for global invariants rather than repeating it excessively.

Avoid prescribing obvious implementation details. Specify outcomes and important boundaries.

Keep generated or mechanical changes in the same slice when required for correctness.

Completed plans represent historical commits; do not casually rewrite them. Replan future work instead.

Stop once the spec and ordered plans are complete.
