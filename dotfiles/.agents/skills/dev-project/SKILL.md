---
name: dev-project
description: Execute one approved project with native agents, evidence-driven technical recovery, stable decisions, and independently verified final integration.
---
# Dev Project

Drive one exact approved directory under `plans/` to completion; do not stop after one plan or child.
Numbered plans carry the binding contract; nonbinding execution guidance may adapt.
Use `references/handoffs.md` for compact evidence conventions, not a mandatory schema or second planning system.
Use existing plans and evidence directly; obsolete workflow journals are not prerequisites or authoritative acceptance records.

## Role

Own dependency order, worker sequencing, exact revisions, progress, and technical recovery.
Do not implement production code or self-approve a technical resolution.
Use scoped explorers for repository context and narrow direct inspection when essential to a recovery/design decision.
Challenge unsupported findings, compare conforming approaches, and commission independent adjudication where needed.
Never change approved outcomes, interfaces, ownership, behavior, constraints, or binding architecture without user approval.

## Exploration

Read contracts, handoffs, and Git metadata directly; delegate non-local searches and tracing to `explorer`.
Give it one self-contained question, relevant paths/revision, known facts, and a clear stopping condition.

```text
spawn_agent(task_name="explore_<topic>_<n>", agent_type="explorer", fork_turns="none",
    message="<question, scope, known facts, and stopping condition; require concise path::symbol evidence and explicit uncertainty; do not edit files>")
```

Use unique task names and the configured role; do not override its model or effort.
Reuse valid evidence; do not duplicate active investigation or spawn explorers for routine transitions.
Await needed results; reuse the returned identity for same-scope follow-ups through the runtime's turn-starting continuation tool.
Release explorers when no longer needed; the orchestrator owns decisions and inspects narrow source only when essential.

## State and workers

On start/resume, read the active top-level numbered plans, handoffs, and necessary Git metadata; exclude history, archives, and superseded plans.
During normal execution, update only the active plan; do not repeatedly audit historical commits or bulk-read the repository.
Keep compact progress notes only as useful for recovery: accepted work, bases, worker IDs, findings, settled decisions, failed approaches, next action.
Preserve valid prior acceptance without rewriting old plans. Missing IDs, hashes, or preferred headings do not invalidate clear evidence or require migration.
Reuse applicable approval/readiness evidence; resolve a real missing decision with focused clarification, not schema migration or repeated grilling.
Choose the lowest-numbered dependency-ready incomplete plan, honoring supplied starting guidance without skipping unfinished prerequisites.
Execute one numbered plan at a time, with one build/review turn active in the designated worktree.
Start one independent builder/reviewer pair per plan with no inherited conversation (`fork_turns="none"` when exposed).
Reuse that pair across repairs using the runtime's actual turn-starting continuation tool; plain send_message is not continuation.
Replace unavailable, context-degraded, or entrenched workers with settled decisions, findings, and failed approaches preserved.
Do not reuse a worker across numbered plans. Retire the pair after acceptance.
Use the smallest useful explorer fan-out within actual capacity; release explorers instead of evicting useful same-plan workers.
A wait timeout is not failure; never launch a duplicate while the original attempt is live.

## Dispatch

Use native spawn/continuation tools and their exposed schemas; retain configured models and effort.
Supply the exact plan/project path, review purpose, and worktree; ordinary prose or existing headers are fine.
Code-review assignments also include `Revision: <full current revision>`; pass artifact paths, not rewritten findings.
Use BUILD for the builder, INITIAL for first review, and REPAIR for follow-ups including evidence-only repairs.
Preserve the original plan base across repairs; give each worker the current candidate, prior findings, and intended output path without invented hashes or tokens.
Continue the known native worker ID; confirm it finished this assignment and read its resulting handoff, not just an old file at the same commit.
When a result is materially unclear, obtain the missing evidence from that worker; do not repeat completed work or reject clear evidence for formatting.

## Main loop

- No successful current build: run builder with `$dev-build` for exactly the selected plan.
- Successful build without current review: run reviewer with `$dev-review` before another build.
- COMPLETED/NO CHANGE: use exact Commit, or Base revision when no commit exists, and review that candidate.
- ACCEPTED: retain the accepted revision and immediately select the next ready plan.
- CHANGES REQUIRED: give every OPEN finding to the same builder, then return to the same reviewer.
- BLOCKED/REQUIRES REPLANNING: examine the boundary claim and choose recovery; never merely forward a stop verdict.
The current assignment matters even when the revision is unchanged; an old review cannot certify new evidence.
Earlier acceptance need not equal HEAD; reopen only for concrete evidence of a broken applicable obligation.

## Convergence and quality

There is no repair-round cutoff and no budget-based acceptance. Continue actionable conforming work.
Progress is an obligation verified, a finding resolved/refuted, or a causal uncertainty removed with evidence.
If a claimed repair leaves the same failure, require reproduction, a discriminating check, and a changed causal explanation before another patch.
Distinguish a bad finding, missing verification, ineffective fix, unsuitable design, unavailable prerequisite, or degraded context.
Choose a specific next action: focused diagnosis, explorer investigation, counterexample, conforming redesign, or worker replacement.
For an unresolved evidence dispute, use an independent reviewer in ADJUDICATE mode; do not add adjudication routinely.
Prefer demonstrated design improvements, not endless alternative abstractions; preserve settled directions unless new material evidence changes them.
The reviewer may demand a materially better conforming design and may withdraw a disproven finding; neither response changes the contract.
Retry an obvious transient runtime failure once; preserve recoverable state if service remains unavailable.
Actual interruption permits recovery; an unchanged failed approach or another commit is not a recovery strategy.

## Contract-preserving maintenance

Commission a planner with Mode MAINTAIN when guidance, plan boundaries, or dependency order needs correction.
Have it propose a note/diff explaining the change and where affected obligations, findings, and verification move; no manifest or special directory is needed.
Keep live plans and accepted work unchanged until an independent reviewer accepts the substantive maintenance proposal.
Then apply the reviewed changes to affected unfinished plans, preserving accepted plan text and the review rationale.
Check the applied changes against the accepted proposal; resolve local inconsistencies instead of restarting project-wide planning.
Do not discard pending findings or verification; pass their original artifacts and new owners to replacement workers.
A binding change requires the smallest necessary user decision, updated planning/readiness, and a new explicit execution invocation.

## Legitimate stops

Independently validate disputed technical stop claims; reuse already established evidence. An observed outage or requested pause does not need another reviewer.
BLOCKED requires a genuinely unavailable prerequisite, attempted feasible remedies, and a concrete next action.
REQUIRES REPLANNING requires a binding conflict or consequential decision that no conforming implementation resolves.
Wrong symbols, ordinary engineering choices, fixable assumptions, and elapsed review rounds are not replanning.
For runtime interruption/service failure or a user-imposed budget, use PAUSED with Reason and Next action; never claim technical impossibility.

## Finish line

After all active plans pass, create a fresh reviewer with Mode FINAL, the project path, and exact current HEAD.
Use the approved final commands and `<project>/project.review.md`, not a new architecture audit.
Map failures to the smallest responsible plan; preserve unrelated accepted work and pass the final finding IDs into repairs.
Review those repairs and continue the same FINAL worker against the integrated candidate; retain all unresolved final findings.
Completion requires all applicable outcomes accepted and FINAL verification at the resulting revision, including mandatory manual evidence; unresolved required checks are not passing.
Agents own these checks; no hook or JSON journal enforces them. Never claim completion from formatting, a budget, or a builder summary alone.
On success report Project, `Status: COMPLETED`, exact Final revision, final evidence path, and accepted plan/revision list.
On a technical stop report Project, Status, Plan, Revision or unavailable, Reason, and Next action from validated evidence.
Do not return merely because a child finished; execute the next transition until the finish line or a legitimate stop.
