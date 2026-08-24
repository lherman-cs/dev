---
name: dev-plan
description: Turn an approved plans/<project>/spec.md into concrete isolated implementation plans under the same project directory. Use only when explicitly invoked after the destination has been specified.
---

# Dev Plan

Turn the approved destination into the safest concrete implementation path.

## Resolve

1. Resolve the project and read `plans/<project>/spec.md` first.
2. Reuse relevant session and repository context.
3. Investigate only until the implementation path is decision-complete.

Resolve:

- ownership and data flow;
- affected files, symbols, and call sites;
- lifecycle and dependencies;
- relevant tests and verification;
- constraints and repository conventions.

Prefer targeted symbol, reference, and call-site investigation over broad reading.

Resolve material repository questions from evidence.
Do not treat assumptions as facts.

If the destination itself is insufficient or wrong, stop and return to `dev-spec`.

## Decompose

Split the work into the smallest useful ordered pieces that are independently:

- implementable;
- verifiable;
- reviewable;
- preferably committable.

Preserve buildability between pieces when practical.
State dependencies only when they matter.

Stop investigating when each builder can proceed without reopening:

- architecture;
- ownership boundaries;
- implementation strategy;
- affected surfaces;
- verification strategy.

Cheap local implementation mechanics may remain for the builder.

## Plan files

Each plan should contain only information expensive or risky for the builder to rediscover:

- **Objective**
- **Changes**
- **Verification**
- **Done when**
- **Out of scope**

Add **Key facts / constraints** only when non-obvious repository evidence materially affects implementation.

Add **Dependencies** only when the plan depends on another piece.

In `Changes`, be concrete about relevant files, symbols, ownership, data flow, lifecycle, and required behavior.

Do not include:

- investigation history;
- generic repository context;
- spec requirements already obvious from the objective;
- repeated facts across plans;
- rationale for settled architecture;
- incidental mechanics the builder can determine cheaply.

Reference the spec rather than reproducing it.

## Review output

Optimize conversation output for approving the decomposition, not for reproducing the plan files.

Before writing files, present only a concise `DRAFT PLAN`:

```text
01 <name> — <one-sentence outcome>
   Surface: <important modules/symbols>
   Depends: <only if applicable>

02 <name> — <one-sentence outcome>
   Surface: <important modules/symbols>
   Depends: 01
````

Include an `Important choices` section only when planning introduced implementation decisions that are:

- not already dictated by the spec;
- consequential;
- worth explicit user review.

Do not dump repository findings or full plan contents into the conversation.

Ask only for approval or corrections.

After explicit approval, write:

`plans/<project>/01-foo.md`
`plans/<project>/02-bar.md`
...

Done when build can proceed primarily from the plan and affected code without broad repository investigation or reopening architectural decisions.
