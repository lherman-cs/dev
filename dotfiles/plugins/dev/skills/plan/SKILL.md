---
name: plan
description: Investigate a repository and produce an implementation-ready plan without editing code. Use when the user invokes $dev:plan or asks to plan a non-trivial change involving architecture, ownership, APIs, state, concurrency, migration, compatibility, or performance. Do not use for implementation or simple mechanical edits.
---

# Plan

Produce the smallest self-contained plan that lets a capable builder implement the change without making a consequential design decision.

Keep the user in the parent thread. Do not modify the repository, build, test, or commit.

## Normalize the request

Recover this contract from the request, conversation, and workspace:

1. **Task** — goal and observable completion criteria.
2. **References** — repository path, relevant artifacts, errors, and prior decisions.
3. **Constraints and non-goals** — behavior to preserve, approaches to avoid, and excluded scope.

Do not require the user to follow this format or rewrite a rough prompt. Infer safe facts. Before spending a planner turn, ask only when missing information would materially change the goal, scope, or completion bar. Ask at most three concise questions in one turn, include a recommendation when useful, and never ask for facts repository inspection can establish.

## Model and delegation contract

The parent coordinator is `gpt-5.6-luna`. Keep the user in this parent thread.

For a non-trivial change, make one native delegation to the configured `planner` agent, which must use `gpt-5.6-sol` with `high` reasoning. The planner is read-only and must not build, test, edit, or commit. Do not use Terra or Luna for the planner role.

Plan directly in the Luna parent only when the change is localized, follows an established pattern, and contains no consequential choice.

Reuse the same planner handle for the entire planning cycle. Send it only the normalized contract, explicit decisions, repository path, and output contract below; do not fork the full conversation history. Do not start parallel planners or background retry processes.

If native planner delegation is unavailable, do not launch nested `codex exec`, request network escalation, use `--approve-for-me`, or transmit repository contents to another process automatically. Those actions do not preserve the planner handle and may cross the user's authorization boundary. Perform the planning locally in Luna only with an explicit `Sol planner unavailable` limitation in the result, or stop with `DELEGATION UNAVAILABLE` when Sol-level planning is required. Do not present a local plan as Sol-generated.

If a delegation attempt starts but fails, wait for or terminate that attempt before falling back. Do not leave background agents running and do not retry the unchanged failed command more than once.

Require the planner to read applicable repository instructions and inspect relevant code, tests, and history before recommending a design. It must distinguish repository evidence, user decisions, and recommendations.

## Resolve decisions before drafting

If inspection leaves a consequential choice about architecture, ownership, contracts, state, concurrency, lifecycle, protocol behavior, compatibility, performance or security invariants, migration, or scope, require `DECISION REQUEST` instead of a plan.

Include at most three decisions. For each, give the evidence, viable options, material tradeoffs, and recommendation. Do not generate or regenerate a full plan while decisions remain. Forward answers to the same planner as a compact decision delta rather than replaying the conversation.

Leave local, behaviorally equivalent implementation choices to the builder.

## Output contract

Return `DRAFT PLAN` containing:

1. **Goal and acceptance criteria**
2. **Baseline** — repository revision or working-tree basis and relevant current flow
3. **Decisions, invariants, and non-goals**
4. **Implementation checkpoints**
5. **Risks and failure behavior**
6. **Final verification**
7. **Open questions** — only unresolved user decisions; otherwise `None`

For each checkpoint, include only applicable files and symbols, behavior or ownership changes, data flow or state transitions, required removals or migrations, and targeted validation. End each checkpoint in a coherent repository state.

Be precise about behavior and boundaries, not line-by-line mechanics. Omit background that does not affect implementation or verification.

## Approval

Present the draft and remaining decisions separately. Accept clear natural-language approval; do not require a magic phrase.

If approved unchanged, reuse the draft as `APPROVED PLAN` without another planner turn. If the user requests material changes, send only the delta to the same planner and request one consolidated revision.

Do not approve a plan that still requires the builder to make a consequential decision.
