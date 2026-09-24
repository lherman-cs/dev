---
name: dev-ship
description: Collaboratively review and converge a completed local candidate into a clean, validated, human-ready branch.
disable-model-invocation: true
---

# dev-ship

Read `../../references/reconcile.md` at entry. Read `../../references/engineering.md` at entry. Reconstruct the intended outcome, fixed local comparison base and exact candidate scope, history, validation, prior review coverage, and unresolved feedback. Include uncommitted candidate changes. A resumed session alone does not justify repeating a reviewer launch: reuse evidence still applicable to the candidate.

Own the local candidate through a collaborative conversation:

1. **Orient and walk through.** Inspect and judge the candidate yourself. Start with a short map of resulting behavior and the few consequential decisions worth discussing. Take one meaningful topic at a time: use a concrete scenario, explain the design and tradeoff, recommend a direction, then pause for the human's questions and concerns before moving on. Use diagrams or code only if they improve understanding. Follow the human's priorities, explore concerns deeply, and skip settled or routine details; do not run a fixed approval checklist.

2. **Repair while converging.** Fix clear in-scope defects directly. Discuss consequential changes to agreed behavior, scope, or risk with the human before implementing them; explain the behavioral difference afterward. Reject unsupported, speculative, taste-only, unrelated, redundant, or low-value churn. Validate affected behavior. Use `ask_user_question` for consequential decisions and focused pauses, not routine repair approvals.

3. **Review the settled candidate.** After the walkthrough and known repairs settle, launch one independent read-only `review` on the stable agreed candidate, supplying the intended outcome, fixed base, exact candidate, and relevant constraints and evidence. Do not review a moving target. Treat findings as evidence, not approval: bring back only meaningful findings; repair and verify straightforward defects yourself, inspect affected changes, and reopen only the relevant human discussion when a finding changes an agreed decision or reveals important risk. Material repairs invalidate affected evidence; obtain fresh applicable proof rather than treating earlier checks or review as covering changed behavior. Do not automatically launch another reviewer for routine repairs. If substantial redesign genuinely needs a second independent review, explain the coverage gap and obtain human permission first.

4. **Confirm, then refine.** After meaningful findings are resolved and required validation passes, explicitly ask the human whether meaningful feedback is exhausted. Do not infer convergence from silence. Only then create a recoverable pre-cleanup reference and rewrite the owned candidate history into the smallest useful set of coherent Conventional Commits. Preserve the comparison base and unrelated/shared history; verify tree equivalence and the final base-to-candidate diff. History-only changes preserving the reviewed tree do not require another human approval or behavioral revalidation solely because commit IDs changed. Leave a clean worktree and present a concise closing view of behavior, decisions and repairs, validation, residual risks, and final commits.

Keep independent review and validation asynchronous against an exact candidate. Continue useful work while they run, but do not change the tested candidate until verification completes or is cancelled; wait when evidence gates progress.

**Endpoint:** A committed local candidate with an intentional diff, coherent history, applicable passing validation, no known meaningful review feedback, and explicit human convergence. The human owns branch integration and remote publishing. Do not fetch, push, mutate remote review state, or merge into another branch.
