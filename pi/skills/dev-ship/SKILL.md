---
name: dev-ship
description: Collaboratively review and converge a completed local candidate into a clean, validated, human-ready branch without publishing or merging.
disable-model-invocation: true
---

# dev-ship

Read `../../references/reconcile.md` and `../../references/engineering.md` at entry. Reconstruct the intended outcome, fixed comparison base, candidate scope, history, validation, and unresolved feedback. Include uncommitted candidate changes.

Own the local candidate through convergence:

1. **Orient.** Inspect enough to form a reliable high-level model. Keep the human incrementally oriented around resulting behavior, important invariants, consequential design choices, and risks. Use `ask_user_question` at meaningful review checkpoints and for focused decisions. Prefer concise diagrams, tables, or before/after views when they reduce cognitive load.

2. **Review.** Review the candidate yourself and use the read-only `review` sub-agent for independent scrutiny. Give it the intended outcome, fixed base, exact candidate, and relevant constraints; request only concrete, evidence-backed material findings. If its snapshot cannot see uncommitted changes, provide them explicitly. Verify, deduplicate, group, and judge its findings yourself. After repairs, target follow-up review at the changed findings and their interaction blast radius unless the candidate changed broadly.

3. **Converge.**

   * Repair clear, material, in-scope defects directly.
   * Ask the human when semantics, scope, tradeoffs, repair value, regression risk, or understanding materially benefit from judgment.
   * Group related findings around the decision they require.
   * Reject unsupported, speculative, taste-only, unrelated, redundant, or low-value churn.

   Validate affected behavior after repairs and re-review as needed. Continue until serious review yields no meaningful actionable feedback.

4. **Refine.** Leave a clean worktree and rewrite candidate history into the smallest useful set of coherent Conventional Commits. Squash fixups, debugging, detours, and incidental churn; preserve boundaries that materially aid review, understanding, testing, rollback, or archaeology. Rewrite only owned candidate history and verify the final tree and base-to-candidate diff are unchanged by history-only cleanup.

5. **Confirm.** Present a concise closing view of resulting behavior, consequential decisions and repairs, validation, residual risks, and final commit structure. Use `ask_user_question` to confirm that no meaningful review feedback remains.

Do not make the reviewer a gatekeeper, decision-maker, repair owner, or source of repeated full-candidate reviews without reason. Material content changes invalidate affected review and validation evidence.

**Endpoint:** A committed local candidate with an intentional diff, coherent Conventional Commit history, applicable passing validation, no known meaningful review feedback, and explicit human convergence. The human owns branch integration and remote publishing. Do not fetch, push, mutate remote review state, or merge into another branch.
