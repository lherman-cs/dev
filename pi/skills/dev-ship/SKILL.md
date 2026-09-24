---
name: dev-ship
description: Collaboratively review and converge a completed local candidate into a clean, validated, human-ready branch.
disable-model-invocation: true
---

# dev-ship

Read `../../references/reconcile.md` and `../../references/engineering.md` at entry. Reconstruct the intended outcome, comparison base, candidate scope, history, validation, and unresolved feedback. Include uncommitted candidate changes.

Own the local candidate through convergence:

1. **Orient.** Inspect enough to form a reliable high-level model. Keep the human incrementally oriented around resulting behavior, important invariants, consequential design choices, and risks. Use diagrams or structured views only when they materially reduce cognitive load.

2. **Review.** Review the candidate yourself. Use the read-only `review` sub-agent once on a stable candidate for independent scrutiny, supplying the intended outcome, fixed base, exact candidate, and relevant constraints. Ask only for concrete material findings with evidence and impact. Treat its output as evidence, not authority.

3. **Converge.**

   * Repair clear, material, in-scope defects directly.
   * Use `ask_user_question` when semantics, scope, tradeoffs, repair value, regression risk, or human understanding materially benefit from judgment.
   * Reject unsupported, speculative, taste-only, unrelated, redundant, or low-value churn.
   * Validate affected behavior and continue reviewing until no meaningful actionable feedback remains.

   Do not repeatedly invoke the reviewer. Re-run it only when repairs materially change the reviewed surface or invalidate its conclusions.

4. **Stay interactive.** Run validation and independent review asynchronously against an exact candidate. While they run, continue useful inspection, human orientation, and decision-making. Wait only when their result is required to proceed safely. Batch repairs before launching affected follow-up proof.

5. **Refine.** Leave a clean worktree and rewrite candidate history into the smallest useful set of coherent Conventional Commits. Squash fixups, debugging, detours, and incidental churn; preserve only meaningful boundaries. Rewrite only owned candidate history and verify the final tree and base-to-candidate diff.

6. **Confirm.** Present a concise closing view of resulting behavior, consequential decisions and repairs, validation, residual risks, and final commit structure. Confirm with the human that no meaningful review feedback remains.

Material content changes invalidate affected review and validation evidence.

**Endpoint:** A committed local candidate with an intentional diff, coherent history, applicable passing validation, no known meaningful review feedback, and explicit human convergence. The human owns branch integration and remote publishing. Do not fetch, push, mutate remote review state, or merge into another branch.
