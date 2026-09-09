# Dev Skills Requirements

Applies to `dev-plan`, `dev-build`, and `dev-review`.

## Shared

* Under 100 lines per skill.
* Tenets: **Robustness first, Simple by design, Performance without cleverness.**
* Use explorers with `fork_turn = false` / no fork.
* Multiple explorers are allowed; each must answer one narrow question.
* Prefer compact conclusions with evidence, paths/symbols, and uncertainty.
* Do not ask the user questions repository exploration can answer.
* Avoid workflow state machines, acceptance IDs, readiness gates, and unnecessary durable metadata.

## Plan

* Grill the user until all material product, API, architecture, ownership, and invariant decisions are clear.
* Challenge bad, speculative, overly complex, or weaker approaches.
* Resolve minor implementation details autonomously.
* Use pseudocode when it removes ambiguity.
* Produce `plans/<project>/spec.md` as the authoritative contract.
* Produce ordered `plans/<project>/01-<name>.md`, `02-<name>.md`, etc.
* Each plan is the smallest coherent vertical slice that leaves the repository valid and deserves one human-reviewable commit.
* Plans must be self-contained enough for Build to execute without reconstructing the planning conversation.

## Build

* Implement exactly one numbered plan and stop.
* Preserve existing design unless the plan requires changing it.
* Apply in order:

  1. Does this need to exist? YAGNI.
  2. Already in the codebase? Reuse it.
  3. Standard library? Use it.
  4. Native platform feature? Use it.
  5. Installed dependency? Use it; add nothing unnecessary.
  6. Can it be one clear line? Do that.
  7. Otherwise write the minimum code that works.
* Do not fix unrelated issues.
* If correctness requires changing the approved contract, stop and request replanning.
* Run the narrowest meaningful tests, formatting, and linting.
* One successful numbered plan = one isolated Conventional Commit.

## Review

* Independently review correctness, formatting, testing, and unnecessary complexity.
* Default to the target diff against its plan and `spec.md`; expand scope only when needed.
* Do not modify code unless explicitly requested.
* Lead with `PASS`, `FIX`, or `REWORK`.
* Give a concise summary and only high-impact findings.
* Each finding states issue, consequence, recommended action, and location when available.
* Do not invent nitpicks or repeat formatter-enforced trivia.
* End with exactly `MERGE`, `FIX THEN MERGE`, or `REWORK`.
* Optimize every review for fast, delightful human scanning.
