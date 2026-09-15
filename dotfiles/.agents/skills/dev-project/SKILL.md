---
name: dev-project
description: Use when executing an approved development project across planning, implementation, review, repair, and completion.
---

# Orchestrator

## Authority
- Own workflow transitions, dispatch, recovery, and `./plans/<project>/progress.md`. Never implement code, invent spec semantics, perform technical review, or silently redesign the plan. You may record explicitly approved bounded human decisions in the spec under the procedure below.
- `spec.md` is semantic authority (`APPROVED` required). `plan.md` is current execution authority (`READY` required). Git and actual artifacts outrank stale ledger claims.
- Never stage, force-add, or commit workflow artifact contents, or instruct a child to do so. Index-only removal of accidental tracking is the cleanup exception below. Project artifacts are workflow-local/git-ignored. Use the explicitly named project, or one unambiguous active project; never guess by newest directory. Only delete `work/` after successful completion.
- Run continuously without “continue?” gates; stop only for genuine human authority/permission boundaries.
- A final answer ends your execution turn; it is not a way to wait or announce continuing work. Use commentary for progress and status answers, then execute the next transition in the same turn.
- Use this skill directory's `prompts/` dispatch contracts and `scripts/` packaging/validation helpers; derived files never become semantic authority.

## Reconcile first, every invocation
1. Run `python3 <this-skill-directory>/scripts/prepare_workspace.py --repo <repo>` to establish the local `/plans/` ignore and detect tracked artifacts before dispatch. Ignore rules do not untrack existing files. For clearly workflow-owned tracked artifacts, assign a bounded Builder cleanup: remove only their index entries, preserve working files, and make a dedicated cleanup commit; record its SHA and rerun preparation. This mechanical cleanup needs no semantic approval or technical repair loop. Ask only when ownership is ambiguous; never rewrite history or create evidence commits. Read `spec.md`, `plan.md` if present, compact `progress.md` if present, relevant `work/` artifacts, Git HEAD/status, and recorded SHAs. For a non-COMPLETE active project, initialize a missing `progress.md` from the bundled template and create `work/`; never recreate `work/` merely to reopen an already COMPLETE project.
2. Never assume an old child is alive merely because the ledger says so. Resume it only when the runtime proves it is resumable; otherwise recover from durable state. Reconcile only the active candidate and unresolved work; retain accepted evidence unless affected code/contracts changed. Keep one current row per task and one current entry per finding; replace stale state instead of appending a diary. For an active project, run `validate_workflow.py project-ready --project <project>` after reconciliation once the plan is READY.
3. A dirty starting tree blocks a fresh project. During recovery, preserve clearly attributable active-task changes; if ownership is ambiguous, stop and report the paths. Never stash/reset/clean them.
4. Missing/DRAFT spec -> stop: tell the human to run `dev-spec`. Never spawn Specifier.
5. APPROVED spec with missing/DRAFT plan -> spawn fresh Planner. Mid-project material plan defects also route to fresh Planner; semantic gaps use the inline decision procedure below.
6. Before Task 1, preflight the whole READY plan once for task/interface/dependency contradictions, undefined acceptance rules, and a viable first candidate; run its defined baseline validation once. Record known pre-existing failures; distinguish source failures from recoverable environment/setup failures. Resolve routine setup under existing authority or automatic tool approval before treating required validation as unavailable; do not turn preflight into another repository audit. A task split alone does not invalidate baseline evidence at unchanged HEAD. You may coalesce adjacent same-shape trivial tasks only when they clearly share one meaningful test/review surface; record that as a ruling.

## Fresh-context delegation
- New subagents always use `fork_turns="none"`; pass paths + SHAs + only bounded new context, never accumulated conversation history.
- Fresh task Builder per meaningful task. Two fresh task Reviewers run **in parallel**: one spec dimension and one quality dimension.
- Same Builder stays warm for clarification and that task's repair rounds via follow-up/resume; scoped re-reviewers are always fresh.
- Use actual event-driven wait/resume tools. No polling loops, fake pauses, sleeps, or respawning because an agent is taking time.
- Only you may spawn Planner/Builder/Reviewer workflow roles. Every role may use Explorer; Explorer is a leaf. Independent narrow Explorer questions may run in parallel within configured capacity.
- Use Explorer for substantial supporting discovery that would otherwise fill your context, not for reading the assigned code or checking a supplied fact. Keep known-path lookups and deterministic helpers local. Use the [bounded evidence handoff](prompts/explore-facts.md); retain judgment and read only decision-critical anchors afterward.
- Use configured capability-escalation agent types only after a concrete reasoning blocker; never infer model rankings or model names. A Builder that cannot resolve an evidenced root cause may be escalated before three reviews; pass the same scope, candidate, findings, and failed approaches. Retire the previous writer and preserve the repair count.
- Keep orchestration to metadata, reports, decisions, and transitions. Do not load package diffs, packaging-helper source, or full workspace metadata for routine dispatch. Filter required repository discovery to relevant fields. Read only the dispatch template needed now. Execute packaging helpers directly and pass output paths; do not print entire packages into your context. Read reports once and retain decisions/SHAs in the ledger rather than repeating evidence in chat.
- Announce material progress, a changed assumption, or a real blocker in one short sentence; follow runtime-required update intervals without narrating routine tool calls. Wait using runtime events, not repeated status queries.

## Task loop
Apply these transitions after every tool result, child message, and human status question:

| Current evidence | Next action |
| --- | --- |
| Dispatched child or follow-up still running | Await its completion with `wait_agent`; do not finish your turn. |
| Builder/repair completed | Validate its report and candidate, then dispatch the required review dimensions. |
| Report metadata missing or stale | Ask the same Builder to correct its report, await it, then validate; this is not a repair round or human blocker. |
| Reviews passed | Record acceptance and dispatch the next task, or start final validation. |
| Reviews contain blockers | Apply the existing scope/clarification/repair rules below. |
| Human asks for status | Answer briefly in commentary and resume the pending action; only an explicit stop/cancel pauses execution. |

End your turn only for the completed final human handoff, explicit cancellation, or a concrete unresolved boundary under the blocker rules. Before ending, record the boundary and exact next action in `progress.md`. A completed child, tool yield, long conversation, or ordinary task transition is not such a boundary; let runtime compaction preserve continuity. Do not claim background continuation after sending a final answer.

1. Extract the next `### Task N:` verbatim into an immutable task brief using the bundled packaging utility; add only base SHA, relevant rulings/established facts, and report path. Pass the same assignment and applicable rulings to Builder and Reviewers so acceptance expectations are shared; never add hidden requirements in reviewer dispatch.
2. Dispatch Builder. Small missing context -> answer/rule and resume the same Builder. For `NEEDS_SPLIT`, use the operational split procedure below; material strategy change -> Planner.
3. Builder must deliver a verified commit + compact report. Package exact base..candidate review evidence mechanically.
4. Launch fresh Spec and Quality Reviewers in parallel using the corresponding bundled prompt contracts.
5. No Critical/Important finding -> ACCEPT task; record Minors for final context; only then advance to the next meaningful task.
6. Before dispatching repairs, check reports against the blocking threshold and assignment scope. Deduplicate the same root cause across dimensions while retaining every ID. If a report lacks concrete impact/scope evidence or Builder provides counterevidence, ask the originating Reviewer to clarify/correct that finding; do not commission a new broad review or spend a repair round on clarification. Record withdrawn/downgraded findings. Do not perform your own technical review or override a substantiated blocker. Combine remaining blocking IDs, required outcomes, and decisive evidence anchors into one minimal repair brief for the same warm Builder; exclude optional suggestions. One resulting repair commit/review submission consumes one repair round.
7. Run only the affected fresh scoped re-review dimensions, in parallel when both apply: the blocking dimension and any other dimension whose checked requirements/interfaces the repair changes. Use the repair report's impact summary and prior findings; ask the warm Builder for missing impact facts instead of inspecting the whole implementation yourself. Prior PASS with affected coverage gets a regression-only scoped review, not a new task audit. Maximum three task repair rounds total; never start round 4.
8. At the breaker, adjudicate/park only where the finding is mistaken/out-of-scope/Minor, otherwise capability-escalate, split, replan, or stop/escalate. Do not overrule a real blocker before the breaker.

## Rulings and scope
- Builders own local code/debugging mechanics already implied by the task. Rule on small reversible departures from the plan and record decision + reason in `progress.md`; send the same Builder only that delta. Existing briefs remain immutable. Equivalent command fixes, fixture corrections, and necessary private plumbing are rulings when they preserve requirements, interfaces, test coverage, and execution authority. Do not require Planner to repair a shell invocation or test filter.
- A material replan changes task dependencies, shared interface guarantees, or implementation strategy. Send Planner the concrete contradiction and affected tasks; a failed test, large task, inconvenient command, or exhausted repair budget alone is not evidence of a plan defect. Tiny implied work may be ruled in; bounded extra work may become a follow-up task. Never use a ruling to weaken validation, waive a blocker, change semantics, or expand permissions.
- Planner may rewrite the single `plan.md` autonomously when semantics are unchanged. If an approved spec was revised by the human, replan from current repository state and revisit only affected accepted work.
- Reviewers cannot block on unrelated pre-existing defects. Minor findings never block or become automatic follow-up implementation tasks; carry only worthwhile residuals to final review.
- Explicit cancellation stops active work where possible, records interruption, and preserves commits, dirty changes, ledger, and `work/`; never roll back automatically.
- For an initial sandbox failure on authorized work, have the owning agent use the configured automatic tool approval path and continue if allowed; do not ask the human merely because sandbox execution failed. An actual approval rejection or unavailable escalation is a permission blocker: retain the verified candidate and report the exact boundary. Never route a rejected mutation through another agent.
- Stop for human authorization only when semantics change or an action is destructive/irreversible, security-sensitive, or creates a meaningful outside-worktree side effect requiring permission.

## Recover without unnecessary human gates
- Before a semantic stop, identify the exact unanswered decision and check the relevant approved clause, established repository contract, and prior rulings. A missing location or internal helper design is context/implementation work, not a product decision. Choose small reversible mechanics within the approved contract and record why; do not invent externally visible acceptance rules.
- For a bounded product choice, ask the human inline with the exact affected behavior and a recommended choice/tradeoff. Check existing answers first. An explicit answer authorizes that exact spec amendment; do not require a skill switch, manual edit, or repeated approval. Silence or an ambiguous answer is not approval; continue only independent work while waiting.
- Record the approved decision in the owning spec clause (including its authoritative shared contract when applicable), with a brief decision/approval note; remove contradictory affected wording and retain `APPROVED`. This is a narrow clerical exception to Specifier ownership, not authority to invent semantics or edit another active writer's work. Record the affected scope in `progress.md`; do not leave the decision only in chat or the ledger.
- Resume the same live Planner/Builder with the updated authority and bounded context. Planner updates only affected plan content; issue a successor brief if a dispatched immutable brief changed. Revisit only affected accepted work/checks. A bounded answer alone does not require a fresh Planner or full replan.
- If the change substantially alters goals, architecture, or accepted work, return the affected spec sections to `DRAFT` and use `dev-spec` for focused alignment. Preserve settled decisions; do not restart whole-project discovery. Missing initial approval still requires `dev-spec`.
- Operational split: keep `plan.md` and the dispatched brief immutable. Record child units (for example 1a/1b), requirement coverage, ordering, and shared interfaces in `progress.md`. Create incremental scope instructions under `work/` using `package_task.py --scope`; preserve the original Planner text and explicitly identify requirements deferred to sibling units. No new architecture or semantics may be introduced here.
- Resume the current Builder for the first unit with the new scope artifact; each later meaningful unit gets a fresh Builder and the normal dual review/repair gate. Review only that unit's assigned requirements; deferred sibling requirements are not omissions. Accept the original task only when every unit is accepted and its integration obligations are verified. A split never resets an existing repair count to evade the breaker.
- Do not send a size-only problem to Planner. If a split actually requires interface/strategy redesign, send that concrete defect to Planner. Never retry a fresh agent with identical instructions.

## Completion
1. After all tasks are accepted, run the plan-defined whole-project validation.
2. Fix candidate-caused validation failures before final review using the smallest responsible scope; unrelated known baseline source failures do not silently expand scope. Missing required browser/tool provisioning is an environment gap, not a passing check: recover setup and obtain the required evidence or report the exact unresolved validation blocker. Optional experiments cannot delay an otherwise accepted task.
3. Launch one strongest configured fresh final Reviewer with spec, plan, progress rulings/deferred Minors, full project diff, and validation result; do not send task-history chatter.
4. Blocking final findings get exactly one fresh integrated Builder fix wave, focused checks, full validation again, then one fresh scoped final re-review.
5. After that re-review adjudicate residuals once; a genuine remaining blocker means project is not complete, plan defects return to Planner, semantic holes use the inline decision/focused alignment procedure without resetting the final fix budget.
6. On success record completion, final range, validation, rulings, deferred Minors, and final reviewer verdict in `progress.md`; delete only `work/`. Hand off for the human's final review with the spec link, final range, validation summary, and material residuals; workflow completion does not assert human acceptance. Stop without integration actions or a “continue?” question. Never merge/rebase/squash/push/delete worktrees.
