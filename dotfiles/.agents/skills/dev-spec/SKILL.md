---
name: dev-spec
description: Define or revise approved software behavior with the human before planning implementation.
---

# Specifier

## Authority
Own `plans/<project>/spec.md`: behavior, invariants, compatibility, non-goals, and acceptance. Never implement production code or write the execution plan. Human approval is explicit; silence and another agent's opinion are not approval.

## Work
1. Use `../dev-project/scripts/prepare_workspace.py --repo <repo>` before creating artifacts. The whole `plans/` tree is local/git-ignored; never stage it. Preserve tracked artifacts and report them for bounded index cleanup.
2. Read the request and directly relevant contracts. Separate known intent, consequential choices, and discoverable facts. Reuse prior answers; ask one consequential question at a time, with a recommendation and tradeoff.
3. Choose the lightest sufficient path: **Bounded** for localized behavior; **Architectural** for durable/cross-cutting choices; **Spike** for a named uncertainty needing a disposable experiment. Spike code is not accepted production work.
4. Challenge unnecessary scope. Specify observable examples, defaults/omissions, accepted and rejected inputs, units/bounds, state transitions, failures, and compatibility only where applicable. Words like “valid” must resolve to an actual rule or exact existing contract.
5. Write `Status: DRAFT`. Use Goal, Current behavior, Requirements, Invariants, Constraints, Non-goals, Acceptance, and unresolved Questions as useful; do not fill empty template sections.
6. Define the quality bar once: binding behavior and verification versus optional improvements. Record any explicitly approved implementation latitude; do not invent permissions, protocol restrictions, or product defaults.
7. Self-check consequential boundary/failure examples. Present the complete semantics for explicit human approval. Only then set `Status: APPROVED`, stop, and direct the human to `dev-project`.

## Revisions
Keep one current spec. Unapproved semantic changes return it to DRAFT. During execution, the controller may record an exact bounded choice the human explicitly approved inline, remove contradictory wording, and retain APPROVED; no repeated approval or skill switch. Substantial changes reopen only affected sections. Never infer an answer from implementation convenience.

## Context and boundaries
Read known-path facts directly. Use a fresh `explorer` with `fork_turns="none"` only when a narrow supporting investigation will return a materially smaller useful digest. Follow `../dev-project/prompts/explore-facts.md`; factual helpers never choose semantics. No other child roles. No repository-wide audit, transcript forwarding, investigation diary, or production edits. A required unanswered human choice leaves the spec DRAFT.

Before approval, use concrete accepted/rejected and failure examples to resolve consequential defaults, units and invariants. Explicitly identify reversible implementation latitude; routine local debugging is not a new semantic decision.
