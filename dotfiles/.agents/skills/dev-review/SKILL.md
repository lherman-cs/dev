---
name: dev-review
description: Independently decide readiness, plan acceptance, or final integration; preserve finding identity and settle design without reopening unrelated work.
---
# Dev Review
Review the assigned approved outcome and constraints, not the entire repository.
Never implement fixes, alter tests, or change approved plans to make them pass.
Nonbinding implementation guidance may adapt without changing approved commitments.

## Inputs
Identify the assigned plan/project, review purpose, and exact candidate revision for code review. Infer omitted labels from the assignment and evidence.
Use `../dev-project/references/handoffs.md` for compact evidence examples; equivalent existing wording is valid.
Judge the actual work, not template compliance. Missing IDs, hashes, or preferred headings are not defects; resolve material evidence gaps narrowly.
Modes are `READINESS`, `INITIAL`, `REPAIR`, `ADJUDICATE`, `MAINTENANCE`, and `FINAL`.
For INITIAL/REPAIR, read the exact numbered plan, matching build, prior findings, and applicable instructions.
Do not read `spec.md`, sibling plans, unrelated history, or broad unchanged modules for a single-plan review.
Use the original plan baseline for full change coverage, not merely the last repair commit.
Inspect only material changes and surrounding source needed to answer concrete acceptance questions.
Use at most one fresh explorer for a necessary non-local repository fact, not a general bug hunt.
Start it without inherited turns, use narrow anchors, and release it after its scoped answer.

## Blocking rule
There are two legitimate kinds of blocker; neither is an invitation to demand perfection.
**CORRECTNESS** requires all of these:
1. A specific approved obligation or established invariant is identified.
2. A required obligation is missing, or the change causes a material defect/regression.
3. The failure is reachable under the approved operating model, not a hypothetical future requirement.
4. Evidence establishes the consequence and an observable closure condition.
**DESIGN** may independently block initial/readiness review for a substantially better conforming approach.
Identify the concrete alternative, approved outcome it serves, material benefit, and replacement cost.
A working implementation is not exempt, but taste, a different equally good pattern, or speculative generality is insufficient.
Resolve disputed design with the technical lead and independent evidence; record the settled direction.
Reopening a settled direction requires new material evidence, including during worker replacement.
Do not block on unrelated existing defects, optional hardening, or extra tests when current evidence proves the obligation.
Do not remove correctness, security, error handling, lifecycle guarantees, or observability merely to reduce code.

## Initial review
1. Read the plan and build evidence once; establish obligation-to-evidence coverage.
2. Inspect the material human-authored change and required integration/failure paths.
3. Check generated interfaces or additional callers only when relevant to an actual acceptance question.
4. Verify that tests exercise required behavior rather than merely mirror the implementation.
5. Run the smallest checks needed to resolve uncertainty; reuse applicable successful evidence.
6. Batch all substantiated blockers in one coherent pass, not one defect per round.
Accept immediately when obligations are verified and no legitimate blocker remains.
A builder's PASS assertion alone is not proof; inspect the evidence and check questionable claims.

## Repair and adjudication
Preserve finding IDs, closure conditions, resolutions, and settled decisions before replacing the review artifact.
For each prior OPEN finding, retain it with evidence, mark RESOLVED, or mark REFUTED with counterevidence.
A builder may disprove a finding; withdraw it instead of defending the earlier verdict.
Inspect the repair delta and affected obligations; do not restart unrelated initial discovery.
A same-revision repair can supply new verification or a factual rebuttal; it still needs this fresh assignment's review.
If a claimed fix fails, identify what remains wrong and the next discriminating check.
Do not hide a demonstrated material defect merely because an earlier pass missed it; state the new evidence and impact.
In ADJUDICATE, independently resolve the assigned dispute or proposed technical stop, not another broad audit.
Do not count elapsed rounds, new commits, or repeated discussion as evidence of either correctness or failure.

## Planning and maintenance readiness
For READINESS, inspect the supplied written spec and numbered plans without requiring a build handoff.
Challenge consequential decisions, design simplicity, ownership/input suppliers, lifecycle, failures, and compatibility.
Check actual toolchain/baseline evidence, risk-proportional feasibility probes, and integration surfaces.
Distinguish verified repository facts, predecessor outputs, and work the current plan must establish.
Check dependency order, clear responsibility for every obligation, concrete automated/manual verification, and self-contained builder handoffs.
No consequential choice may be concealed in an assumption, TBD, or a builder instruction to choose behavior.
For MAINTENANCE, inspect the proposed note/diff and rationale against the approved contract; check where affected obligations and findings move.
Accepted plans must remain unchanged; every unfinished obligation and OPEN finding must retain an owner and verification.
Review the substantive proposal before it is applied; no hash or schema migration is required. Readiness acceptance is not implementation acceptance.

## Final integration
For FINAL, inspect the approved project contract, accepted handoffs, and actual integrated revision.
Run the documented final commands and check cross-plan behavior, interfaces, failures, and still-applicable obligations.
Do not reopen settled design without new integration evidence or invent a new acceptance wish list.
Map each concrete failure to its exact owning plan; keep all known owners/findings together.
On follow-up, verify repairs and affected integration checks with the same final-review worker.
Only pass when the required checks pass at this exact revision and no OPEN blocker remains.

## Verdict and handoff
Use `ACCEPTED`, `CHANGES REQUIRED`, `BLOCKED`, or `REQUIRES REPLANNING`.
CHANGES REQUIRED needs concrete actionable correctness/design blockers, not suggestions.
BLOCKED needs an unavailable prerequisite and attempted feasible remedies; missing evidence is not acceptance.
REQUIRES REPLANNING needs conflicting binding commitments or a consequential unapproved decision.
Explain why no conforming local implementation resolves the conflict; wrong paths or fixable assumptions are insufficient.
Write the assigned or existing handoff path with scope, revision, verdict, verification, and open findings; preserve IDs where used, otherwise use stable descriptive labels.
Keep `## Blocking findings` for OPEN findings only and `## Resolutions` for evidenced RESOLVED/REFUTED IDs.
Retain `## Decisions` for settled design and closure history across replacements.
For FINAL, record required check commands/procedures, revision, results, and evidence, including manual checks; tables and exact field names are optional.
Report the verdict, evidence path, and remaining IDs; finish this turn and retain context for same-scope follow-ups.
