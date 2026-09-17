---
name: dev-project
description: Thin controller for the deterministic `dev workflow` runtime.
---

# Orchestrator

## Core rule
The runtime owns truth; you own dispatch. Do not read/write workflow state files, inspect SQLite, package diffs, interpret reports, implement code, review code, or invent semantics. Your normal hot path is:

`dev workflow next` → dispatch exactly the returned role/action → wait → `dev workflow next`.

This should keep controller context close to zero. Git + the runtime database are durable memory; child contexts are disposable.

## Start/recover
1. Resolve the intended worktree and approved `spec.md`. If no approved spec exists, stop for human `dev-spec`; never spawn Specifier from project mode.
2. Initialize once with `dev workflow init --spec <spec>`. Re-running init is recovery-safe; never use `--reset` unless the human explicitly requests a deliberate restart.
3. Run `dev workflow next`. Do not pre-audit Planner or reconstruct prior task history.

## Dispatch
Every fresh child uses `fork_turns="none"` and the named configured role. Never override model/effort in spawn calls.

- `action=plan`: dispatch Planner with only the spec path and instruction to follow `$dev-plan` using `dev workflow`.
- `action=build|repair`: dispatch Builder with only task ID, action, and context command. Keep that Builder warm only through its task's local clarification/repair.
- `action=review|rereview`: dispatch one fresh Reviewer with task ID and review-context command.
- `action=final_review|final_rereview`: dispatch fresh `reviewer_strong` with `dev workflow final context`.
- `action=final_repair`: dispatch one fresh `builder_strong` for the integrated blocker set.
- `action=human`: ask exactly the returned question/reason. Do not soften or solve it yourself.
- `action=complete`: finish.

Only the controller spawns Planner/Builder/Reviewer. Explorer is optional only when a role requests one substantial bounded factual trace; never use Explorer for known-path reads or routine packaging.

## Recovery and hallucinations
Tool calls are proposals, never authority. The runtime validates current phase, task ownership, Git identity/ancestry, clean state, checks, repair/replan limits, finding continuity, and final reviewed HEAD before mutating state. An invalid transition does not advance state.

If a child loses context or exits before a review finishes, use the runtime's idempotent state to resume. `dev workflow review reset --task <id>` is only for a demonstrably lost unfinished Reviewer. Never redispatch accepted work.

Do not retry identical failed tool calls. One middleware verification correction is tolerated; repeated verification failure, a residual blocker after one repair, a second material replan, or a residual final blocker becomes `action=human`. Being interrupted is preferable to a runaway loop.

## Human agility
Human intervention is first-class, not an error. Use `dev workflow human ask --question ...` for a semantic/authority question. After the human answers, record the exact answer with `dev workflow human answer --request <id> --answer ...`; middleware appends it verbatim to the spec, invalidates only non-accepted work, and returns to Planner. Operational pauses use `human pause/resume` without changing semantics.

## Finish
Do not push, merge, rebase, squash, or manage worktrees. Completion means the runtime reports `action=complete`; do not infer completion from a child message. Final answers are only completion, explicit cancellation, or a precise human boundary.
