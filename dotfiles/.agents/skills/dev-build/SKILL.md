---
name: dev-build
description: Implement exactly one approved numbered plan with the minimum necessary code, verify it, and produce one clean reviewable commit
---

# Dev Build

Implement exactly one:

`plans/<project>/<ordered-numbered-plan>.md`

The plan is the implementation contract. `spec.md` provides the project-wide invariants.

Tenets, in order:

1. Robustness first.
2. Simple by design.
3. Performance without cleverness.

Do not continue into another numbered plan.

## Context

Read the supplied plan, relevant `spec.md`, and applicable repository instructions.

Use `spawn_agent` for repository discovery when additional context is required.

* Spawn an `explorer` with `fork_turns = "none"`; never rely on the default.
* Give each explorer one self-contained, narrowly scoped repository question.
* Include all context needed to answer that question in the spawn prompt.
* Spawn independent explorers in parallel when useful.
* Reuse an existing explorer for closely related follow-up work when practical.
* Require compact output: conclusion, evidence, and relevant paths/symbols.
* Do not ask explorers to broadly inspect or rediscover the repository.
* Keep exploration out of the parent context except for the compact returned findings.

Preserve the existing design unless the plan requires changing it.

## Implementation

For every piece of code, apply this order:

1. Does this need to exist? Speculative need means skip it. YAGNI.
2. Does the codebase already contain the helper, utility, abstraction, or pattern? Reuse it.
3. Does the standard library solve it? Use it.
4. Does a native platform feature solve it? Use it.
5. Does an already-installed dependency solve it? Use it. Do not add another.
6. Can the behavior be expressed directly and clearly in one line? Prefer that.
7. Only then write the minimum new code that works.

Do not narrate this checklist mechanically. Apply it.

Prefer explicit, boring, local code over clever abstractions.

Do not introduce complexity for hypothetical performance. Respect measured or explicitly specified performance requirements.

Do not fix unrelated issues unless they directly block the slice. Report them instead.

## Plan mismatch

If implementation reveals a discrepancy:

* resolve trivial local details yourself;
* make narrow adaptations that preserve the approved contract;
* stop and report `REPLAN` if correctness requires changing product behavior, public API, architecture, ownership, invariants, or acceptance criteria.

Do not silently redesign the project.

## Verification

Run the narrowest meaningful verification that proves the slice.

Prefer:

targeted tests → affected package/crate tests → broader suites when warranted.

Run canonical formatting or lint commands relevant to the touched code.

Tests must prove the intended behavior, not merely execute code.

Do not commit known-broken work.

## Commit

A successful numbered plan produces exactly one isolated reviewable commit unless the user explicitly requests otherwise.

Follow the repository's Git conventions and Conventional Commits.

Keep the subject concise and scoped when appropriate.

Include generated or mechanical files in the same commit when required for the vertical slice to remain correct.

Before committing, inspect the final diff for accidental, unrelated, generated-noise, or over-engineered changes.

Finish with:

* what changed;
* what was verified;
* commit revision;
* any material caveat or unrelated issue discovered.

Then stop.
