# Working evidence, not a document protocol

Use the project's existing Markdown plans and handoffs. The labels and examples below are
conventions, not a machine-validated schema. Missing IDs, hashes, punctuation, or preferred
headings do not invalidate understandable evidence. No journal, manifest, or migration is required.

## Existing projects

Preserve accepted plan text and prior work. Read the matching build/review evidence by meaning:
which plan was reviewed, at what revision, with what outcome and remaining work?
Ignore archived/superseded plans. Do not infer acceptance from a filename or plan number alone.
If identity or coverage is genuinely unclear, inspect the relevant evidence or obtain one focused
review; do not restart all planning or require an old document to match today's template.
Later HEAD movement alone is not a regression. New evidence of a broken obligation requires repair.
Obsolete generated workflow journals may be left untouched; they are not inputs to this procedure.

## Assignments and continuity

Supply the exact plan/project path, purpose, worktree, candidate revision when reviewing code,
original plan base, and relevant handoff paths. Plain prose or existing headers are both valid.
Retain the independent builder/reviewer pair for the active plan. Use native worker IDs to continue.
After a turn ends, check that the returned artifact answers this assignment. A file's existence,
mtime, or matching Git revision alone does not prove the latest requested review occurred.
For evidence-only repairs, the reviewer explicitly evaluates the new evidence at the unchanged
revision and updates its verdict/rationale. No empty commit or generated attempt token is needed.
Keep compact progress notes for decisions, remaining findings, failed approaches, and recovery.
Do not duplicate the full contract or conversation in another state system.

## Build and review evidence

Keep existing `<plan-stem>.build.md` and `<plan-stem>.review.md` paths unless assigned otherwise.
A build should identify the plan, base/result revision, outcome, changes, checks, and limits.
A review should identify its scope/revision, verdict, checked obligations, findings, and evidence.
Use existing `Commit` / `Base revision` fields or their clear equivalents; never guess Git hashes.
Preserve stable finding IDs when present; otherwise a stable descriptive label is enough.
Each blocking finding needs the requirement/invariant, evidence, impact, and observable closure.
A DESIGN blocker also needs a concrete conforming alternative, material benefit, and replacement cost.
Record resolved/refuted findings and settled design directions compactly so workers do not reopen them.
An accepted review has no unresolved blocker. A blocked review may retain unresolved findings;
it must name the unavailable prerequisite instead of pretending those findings were resolved.
Report actual check commands/procedures, outcomes, and important limits. A table is optional.
Evidence obtained from different or uncommitted inputs must not be represented as a verified commit.

## Readiness and maintenance

Use `readiness.review.md` or the existing equivalent for independent planning acceptance.
Review the actual proposed plans, toolchain/feasibility evidence, unresolved decisions, and coverage.
Preparation that can reasonably be completed during implementation is not a planning failure;
name its owner, how it will be completed, and how acceptance will verify it.
Do not disguise an unresolved consequential feasibility assumption as a verified fact.
Reuse applicable prior readiness evidence; recheck material changes and affected obligations only.
Planning approval and readiness do not certify completed implementation.
For contract-preserving maintenance, a note or diff states what changes, why, and where affected
obligations, checks, and unfinished findings move. Independently review before applying it.
Preserve approved commitments and accepted plan text; no special proposal directory is required.

## Final acceptance

Use `project.review.md` or the existing equivalent for final integrated verification.
The final reviewer checks the approved outcome at the resulting revision, not a new wish list.
Record all required automated checks and manual evidence; not-run or pending is not passing.
Complete other feasible work before stopping for a genuine external prerequisite. For required human
verification, report the exact remaining action instead of claiming completion or inventing evidence.
Route a failure to the smallest responsible plan, preserve unrelated accepted work, and rerun
checks affected by the repair. Final acceptance is independent of individual historical acceptances.

These checks are the agents' responsibility, not a runtime-enforced guarantee. Prefer clear,
verifiable evidence over elaborate metadata; never relax actual acceptance to simplify the paperwork.
