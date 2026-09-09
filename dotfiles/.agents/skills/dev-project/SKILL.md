---
name: dev-project
description: Execute one approved project with native agents, evidence-driven technical recovery, stable decisions, and independently verified final integration.
---
# Dev Project
Drive one exact approved directory under `plans/` to completion; do not stop after one plan or child.
Numbered plans carry the binding contract; nonbinding execution guidance may adapt.
Read `references/handoffs.md` before dispatching work. Native hooks validate supported transitions and handoffs.
Do not call the hook validator yourself, edit its `.workflow.json` journal, or substitute prose for accepted evidence.

## Role
Own dependency order, worker sequencing, exact revisions, progress, and technical recovery.
Do not implement production code or self-approve a technical resolution.
Use scoped explorers for repository context and narrow direct inspection when essential to a recovery/design decision.
Challenge unsupported findings, compare conforming approaches, and commission independent adjudication where needed.
Never change approved outcomes, interfaces, ownership, behavior, constraints, or binding architecture without user approval.

## State and workers
Reconstruct on start/resume from exact plans, hook-observed assignments, handoffs, and necessary Git metadata.
During normal execution, update only the active plan; do not repeatedly audit historical commits or bulk-read the repository.
Keep `project.progress.md` compact: accepted work, original bases, worker IDs, OPEN findings, settled decisions, failed approaches, next action.
The hook journal owns mechanical identities; progress notes own engineering context, not acceptance certificates.
Choose the lowest-numbered ready incomplete plan; ready means all declared dependencies are accepted.
Execute one numbered plan at a time, with one build/review turn active in the designated worktree.
Start one independent builder/reviewer pair per plan with no inherited conversation (`fork_turns="none"` when exposed).
Reuse that pair across repairs using the runtime's actual turn-starting continuation tool; plain send_message is not continuation.
Replace unavailable, context-degraded, or entrenched workers with settled decisions, findings, and failed approaches preserved.
Do not reuse a worker across numbered plans. Retire the pair after acceptance.
Use the smallest useful explorer fan-out within actual capacity; release explorers instead of evicting useful same-plan workers.
A wait timeout is not failure; never launch a duplicate while the original attempt is live.

## Dispatch
Use native spawn/continuation tools and their exposed schemas; retain configured models and effort.
Each assignment message starts with exact `Plan: <path>` and `Mode: <mode>` headers.
Code-review assignments also include `Revision: <full current revision>`; pass artifact paths, not rewritten findings.
Use BUILD for the builder, INITIAL for first review, and REPAIR for follow-ups including evidence-only repairs.
The hook injects Attempt, Snapshot, original base, assignment base, and Handoff path; workers must copy the identity fields.
Inspect the observed task identity when continuing a worker; do not guess aliases or hashes.
Repair handoffs with the same worker when only fields are missing; do not repeat completed engineering work.

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
It writes `.proposal/` with the identical approved spec, proposed numbered plans, and `maintenance.md` mapping old/new obligations and OPEN findings.
Keep live plans and accepted work unchanged while a fresh reviewer evaluates Mode MAINTENANCE.
Only after exact-snapshot acceptance, apply exactly the reviewed numbered documents and remove only superseded unfinished plans.
The next transition validates activation; incomplete application must be completed to the accepted snapshot, not treated as a new contract.
Do not discard pending findings or verification; pass their original artifacts and new owners to replacement workers.
A binding change requires the smallest necessary user decision, updated planning/readiness, and a new explicit execution invocation.

## Legitimate stops
Independently validate a proposed technical stop with ADJUDICATE review; fixable work returns to the builder.
BLOCKED requires a genuinely unavailable prerequisite, attempted feasible remedies, and a concrete next action.
REQUIRES REPLANNING requires a binding conflict or consequential decision that no conforming implementation resolves.
Wrong symbols, ordinary engineering choices, fixable assumptions, and elapsed review rounds are not replanning.
For runtime interruption/service failure or a user-imposed budget, use PAUSED with Reason and Next action; never claim technical impossibility.

## Finish line
After all active plans pass, create a fresh reviewer with Mode FINAL, the project path, and exact current HEAD.
Use the approved final commands and `<project>/project.review.md`, not a new architecture audit.
Map failures to the smallest responsible plan; preserve unrelated accepted work and pass the final finding IDs into repairs.
Review those repairs and continue the same FINAL worker against the integrated candidate; retain all unresolved final findings.
Completion requires all plans accepted, exact-snapshot FINAL acceptance at current HEAD, and every required final check recorded as passing.
The hook checks identity/coverage/receipts, not truth or test adequacy; independent verification remains mandatory.
On success report Project, `Status: COMPLETED`, exact Final revision, final evidence path, and accepted plan/revision list.
On a technical stop report Project, Status, Plan, Revision or unavailable, Reason, and Next action from validated evidence.
Do not return merely because a child finished; execute the next transition until the finish line or a legitimate stop.
