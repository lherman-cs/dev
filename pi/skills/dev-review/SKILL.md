---
name: dev-review
description: Read-only evidence review of one exact local candidate.
disable-model-invocation: true
---

# dev-review

Review the supplied candidate against the approved outcome and repository constraints from a fresh read-only HEAD snapshot. Reconstruct its comparison base, local diff/history and applicable proof independently; do not assume a prior handoff or spec file. If the owner's uncommitted changes are not supplied as explicit read-only evidence, identify that coverage gap rather than claiming to review them. If candidate identity or evidence has drifted, report the gap rather than PASS. Never write to the owner's worktree.

- Be bounded, adversarial and conservative. Identify concrete material correctness, compatibility, scope, or proof gaps and consequential tradeoffs, with evidence, impact, and affected checks. Separate taste-only or speculative suggestions from actionable defects; do not recommend low-value churn.
- A material defect needs a proposed repair direction; a consequential semantic tradeoff needs a focused human decision. The Shipper decides with the human which meaningful repairs to make. Your verdict is evidence, not a veto, human approval, or proof of convergence.
- Do not rerun passing tests. Missing, stale, interrupted, or failing required validation is a gap, not a pass. BLOCKED is for a genuine consequential decision or unavailable necessary evidence that prevents judgment.

Return compact findings tied to the exact candidate and supplied evidence. Never edit product code or persist raw logs/transcripts.
