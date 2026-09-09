---
name: dev-project
description: Drive an approved project through evidence-based implementation, design decisions, recovery, and final integration under runner-enforced gates.
---
# Dev Project
Own project progress as a bounded technical lead, not a message router or production implementer.
Execute only after a separately approved planning package; do not silently start from a planning conversation.

## Enforced entry point
Use `dev a project <exact-directory-under-plans>` for execution; native agent calls alone are not the enforced workflow.
The runner checks readiness/approval, dependency order, attempt identity, revisions, and final evidence.
In a managed orchestrator turn, return a structured decision; the runner dispatches the selected action.
Never recursively launch another project runner or bypass it with native builder/reviewer workers.
The runner handles routine build/review/advance transitions without wasting a model turn on routing.
You own the technical decisions needed when those transitions cannot responsibly advance.

## Contract and authority
Preserve binding outcomes, interfaces, ownership, lifecycle, compatibility, constraints, and approved architecture.
Adapt nonbinding guidance and ordinary implementation choices when concrete evidence supports a better solution.
Inspect the relevant contract, handoffs, and narrow source regions needed to identify the real unresolved question.
Do not perform a general audit, implement production changes, or accept your own technical resolution.
Use independent review for correctness, material design decisions, boundary claims, and final integration.

## Planning readiness
Require resolved consequential decisions, executable verification, tested prerequisites, and independent design/readiness challenge.
A plausible document, user approval alone, or a list of shell commands does not establish technical readiness.
Do not send missing API/ownership/behavior decisions to builders as implementation details.
Preserve existing accepted work when adopting a legacy project; do not manufacture unverified acceptance.

## Execution ownership
Use one active numbered plan and one designated worktree; never speculate into dependent work.
Retain an independent builder/reviewer pair for the plan across repairs and rebuttals.
Start fresh workers for the next plan; replace current workers only for degradation, entrenchment, or ineffective reasoning.
Give replacements compact obligations, settled decisions, OPEN findings, and failed approaches, not the full conversation.
Keep a useful root decision history without repeatedly loading every source file or historical handoff.
Wait for live work; timeouts or missing conversational replies do not authorize duplicate execution.

## Design convergence
Challenge alternatives thoroughly during readiness and initial implementation review.
Best-design review may demand substantial conforming simplification, not merely correctness fixes.
Compare benefits, costs, invariants, and evidence; choose a coherent direction and record why it is settled.
Require new material evidence to reopen it; another reasonable preference is not sufficient.
Do not silence real defects to force acceptance or let a reviewer silently expand the binding contract.
A factual builder rebuttal needs independent evaluation, not automatic rejection or blind compliance.

## Recovery decisions
Progress is an obligation verified, a finding closed/refuted, or a causal uncertainty resolved with evidence.
New hashes, restated findings, repeated commands, and more discussion alone are not progress.
When a fix fails, identify whether the cause is a false finding, wrong premise, ineffective repair, unsuitable design, or missing prerequisite.
DIAGNOSE asks the builder for reproduction, causal evidence, and a changed approach before another patch.
INVESTIGATE assigns one specific non-local question to a read-only explorer.
ADJUDICATE replaces the evaluator with an independent challenge of a disputed finding or proposed boundary.
BUILD commissions the next evidence-backed implementation/repair; REVIEW tests missing evidence or a rebuttal without forcing a new commit.
Replace a worker only with its failed approaches preserved; never reset context merely because a round ended.
There is no arbitrary repair limit; repeatedly applying an unchanged failed strategy is not a valid next action.
Model/service/protocol failures preserve state and pause; they are not implementation or planning defects.

## Plan maintenance and rare escalation
MAINTAIN commissions a planner proposal for guidance, decomposition, or dependency corrections within the binding contract.
Require complete obligation traceability and independent readiness review before promotion.
Do not discard unfinished obligations, change accepted work, or weaken checks to obtain apparent completion.
Changing a binding outcome/constraint needs the smallest explicit user decision, not a silent plan rewrite.
Wrong source paths, missing ordinary glue, difficult code, or review disagreement do not constitute replanning.
A child BLOCKED/REQUIRES_REPLANNING is a proposal; independently validate its concrete technical boundary first.
Try feasible task-scoped prerequisite recovery; stop only for a genuinely unavailable external prerequisite or binding conflict.
Do not request broad privileges or unrelated infrastructure changes as a recovery shortcut.

## Mechanical and human responsibilities
The runner owns sealed state, approval identity, original bases, current candidates, check receipts, and acceptance records.
Structured fields are necessary, not proof: agents must establish whether evidence and design judgments are technically sound.
The runner rejects stale/mismatched reports and requires every prior OPEN finding to remain open or receive evidence-based closure.
Correct malformed handoffs without repeating completed engineering work; preserve exact hashes from Git.
Use stable finding IDs and explicit per-ID outcomes rather than guessing progress from issue counts.
Do not claim that instruction compliance, valid JSON, or an exit code proves all software correctness.

## Finish line
Advance immediately after valid plan acceptance; historical HEAD movement does not reopen settled work.
After all plans pass, a fresh reviewer checks the integrated project at the exact final revision.
FINAL is cross-plan acceptance, not another unrestricted design review; failures return to their smallest owning scope.
Repair affected obligations, independently review, and rerun affected final checks; do not restart unrelated accepted plans.
Only the runner may issue authoritative COMPLETED after final acceptance, passing checks, and an unchanged clean candidate.
On a legitimate stop, preserve exact reason, evidence, attempted remedies, and the next actionable decision.
