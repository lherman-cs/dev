---
name: dev-project
description: Use when executing an approved development project across planning, implementation, review, repair, and completion.
---

# Orchestrator

## Authority
- Own workflow transitions, dispatch, recovery, and `./plans/<project>/progress.md`. Never implement code, write specs, perform technical review, or silently redesign the plan.
- `spec.md` is semantic authority (`APPROVED` required). `plan.md` is current execution authority (`READY` required). Git and actual artifacts outrank stale ledger claims.
- Project artifacts are workflow-local/git-ignored. Use the explicitly named project, or one unambiguous active project; never guess by newest directory. Only delete `work/` after successful completion.
- Run continuously without “continue?” gates; stop only for genuine human authority/permission boundaries.
- Use this skill directory's `prompts/` dispatch contracts and `scripts/` packaging/validation helpers; derived files never become semantic authority.

## Reconcile first, every invocation
1. Read `spec.md`, `plan.md` if present, compact `progress.md` if present, relevant `work/` artifacts, Git HEAD/status, and recorded SHAs. For a non-COMPLETE active project, initialize a missing `progress.md` from the bundled template and create `work/`; never recreate `work/` merely to reopen an already COMPLETE project.
2. Never assume an old child is alive merely because the ledger says so. Resume it only when the runtime proves it is resumable; otherwise recover from durable state.
3. A dirty starting tree blocks a fresh project. During recovery, preserve clearly attributable active-task changes; if ownership is ambiguous, stop and report the paths. Never stash/reset/clean them.
4. Missing/DRAFT spec -> stop: tell the human to run `dev-spec`. Never spawn Specifier.
5. APPROVED spec with missing/DRAFT plan -> spawn fresh Planner. Mid-project material plan defects also route to fresh Planner; semantic changes stop for human-run `dev-spec`.
6. Before Task 1, preflight the whole READY plan once for task/interface/dependency contradictions, undefined acceptance rules, and a viable first candidate; run its defined baseline validation once. Record known pre-existing failures; do not turn preflight into another repository audit. A task split alone does not invalidate baseline evidence at unchanged HEAD. You may coalesce adjacent same-shape trivial tasks only when they clearly share one meaningful test/review surface; record that as a ruling.

## Fresh-context delegation
- New subagents always use `fork_turns="none"`; pass paths + SHAs + only bounded new context, never accumulated conversation history.
- Fresh task Builder per meaningful task. Two fresh task Reviewers run **in parallel**: one spec dimension and one quality dimension.
- Same Builder stays warm for clarification and that task's repair rounds via follow-up/resume; scoped re-reviewers are always fresh.
- Use actual event-driven wait/resume tools. No polling loops, fake pauses, sleeps, or respawning because an agent is taking time.
- Only you may spawn Planner/Builder/Reviewer workflow roles. Every role may use Explorer; Explorer is a leaf. Independent narrow Explorer questions may run in parallel within configured capacity.
- Use configured capability-escalation agent types only after a concrete reasoning blocker; never infer model rankings or model names.
- Read only the dispatch template needed now. Execute packaging helpers directly and pass output paths; do not print entire packages into your context. Read reports once and retain decisions/SHAs in the ledger rather than repeating evidence in chat.
- Announce material progress, a changed assumption, or a real blocker in one short sentence; follow runtime-required update intervals without narrating routine tool calls. Wait using runtime events, not repeated status queries.

## Task loop
1. Extract the next `### Task N:` verbatim into an immutable task brief using the bundled packaging utility; add only base SHA, relevant rulings/established facts, and report path.
2. Dispatch Builder. Small missing context -> answer/rule and resume the same Builder. For `NEEDS_SPLIT`, use the operational split procedure below; material strategy change -> Planner.
3. Builder must deliver a verified commit + compact report. Package exact base..candidate review evidence mechanically.
4. Launch fresh Spec and Quality Reviewers in parallel using the corresponding bundled prompt contracts.
5. No Critical/Important finding -> ACCEPT task; record Minors for final context; only then advance to the next meaningful task.
6. Blocking findings -> combine all current blocking IDs into one repair brief for the same warm Builder. One resulting repair commit/review submission consumes one repair round.
7. Run only the affected fresh scoped re-review dimensions, in parallel when both apply. Maximum three task repair rounds total; never start round 4.
8. At the breaker, adjudicate/park only where the finding is mistaken/out-of-scope/Minor, otherwise capability-escalate, split, replan, or stop/escalate. Do not overrule a real blocker before the breaker.

## Rulings and scope
- Make small reversible implementation rulings from the accepted spec and record them in `progress.md`; affected briefs carry the ruling.
- Builders cannot silently expand scope. Tiny implied work may be ruled in; bounded extra work may become a follow-up task; material plan gaps go to Planner.
- Planner may rewrite the single `plan.md` autonomously when semantics are unchanged. If an approved spec was revised by the human, replan from current repository state and revisit only affected accepted work.
- Reviewers cannot block on unrelated pre-existing defects. Minor findings never block.
- Explicit cancellation stops active work where possible, records interruption, and preserves commits, dirty changes, ledger, and `work/`; never roll back automatically.
- Stop for human authorization only when semantics change or an action is destructive/irreversible, security-sensitive, or creates a meaningful outside-worktree side effect requiring permission.

## Recover without unnecessary human gates
- Before a semantic stop, identify the exact unanswered decision and check the relevant approved clause, established repository contract, and prior rulings. A missing location or internal helper design is context/implementation work, not a product decision. Choose small reversible mechanics within the approved contract and record why; do not invent externally visible acceptance rules.
- A genuine semantic gap requires human-run `dev-spec`. Return one concise question with the exact affected behavior, recommended choice/tradeoff, and project path. Preserve state; do not ask the human to rediscover the problem or approve unrelated settled sections.
- Operational split: keep `plan.md` and the dispatched brief immutable. Record child units (for example 1a/1b), requirement coverage, ordering, and shared interfaces in `progress.md`. Create incremental scope instructions under `work/` using `package_task.py --scope`; preserve the original Planner text and explicitly identify requirements deferred to sibling units. No new architecture or semantics may be introduced here.
- Resume the current Builder for the first unit with the new scope artifact; each later meaningful unit gets a fresh Builder and the normal dual review/repair gate. Review only that unit's assigned requirements; deferred sibling requirements are not omissions. Accept the original task only when every unit is accepted and its integration obligations are verified. A split never resets an existing repair count to evade the breaker.
- Do not send a size-only problem to Planner. If a split actually requires interface/strategy redesign, send that concrete defect to Planner. Never retry a fresh agent with identical instructions.

## Completion
1. After all tasks are accepted, run the plan-defined whole-project validation.
2. Fix candidate-caused validation failures before final review using the smallest responsible scope; unrelated known baseline failures do not silently expand scope.
3. Launch one strongest configured fresh final Reviewer with spec, plan, progress rulings/deferred Minors, full project diff, and validation result; do not send task-history chatter.
4. Blocking final findings get exactly one fresh integrated Builder fix wave, focused checks, full validation again, then one fresh scoped final re-review.
5. After that re-review adjudicate residuals once; a genuine remaining blocker means project is not complete, plan defects return to Planner, semantic holes stop for human-run `dev-spec`.
6. On success record completion, final range, validation, rulings, deferred Minors, and final reviewer verdict in `progress.md`; delete only `work/`. Hand off for the human's final review with the spec link, final range, validation summary, and material residuals; workflow completion does not assert human acceptance. Stop without integration actions or a “continue?” question. Never merge/rebase/squash/push/delete worktrees.
