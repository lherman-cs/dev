---
name: dev-review
description: Read-only evidence review of one exact local candidate.
disable-model-invocation: true
---

# dev-review

Read `../../references/engineering.md` at entry. Review the supplied candidate against the approved outcome and repository constraints from its immutable read-only snapshot. Reconstruct its comparison base, local diff/history and applicable proof independently; do not assume a prior handoff or spec file. The snapshot may contain settled uncommitted candidate content, but never infer later owner-worktree changes from it. If candidate identity or evidence has drifted, report the gap rather than PASS. Never write to the owner's worktree.

- Honor the frozen purpose and focus. For a broad review, account for the whole supplied outcome at a bounded level and investigate the listed high-risk invariants deeply. Return all material findings in one batch rather than stopping after the first. For a repair audit, inspect only the listed finding closures, repair delta and directly affected invariants; do not restart whole-candidate discovery. Report a serious incidental defect if encountered, but disclose it as incidental rather than silently expanding scope.
- Be bounded, adversarial and conservative. For every focus, report examined, finding, or unexamined with concrete evidence. Identify material correctness, compatibility, scope, or proof gaps and consequential tradeoffs, with evidence and impact. Separate taste-only or speculative suggestions from actionable defects; do not recommend low-value churn.
- Every material defect needs a proposed repair direction and observable closure checks; a consequential semantic tradeoff needs a focused human decision. The Shipper decides with the human which meaningful repairs to make and owns routine closure. Your verdict is evidence, not a veto, human approval, or proof of convergence.
- Do not rerun passing tests. Missing, stale, interrupted, failing or unexamined required coverage is a gap, not a pass. BLOCKED is for a genuine consequential decision or unavailable necessary evidence that prevents judgment.

Return compact findings tied to the exact purpose, candidate, evidence and focus. Never edit product code or persist raw logs/transcripts.
