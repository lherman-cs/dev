---
name: dev-review
description: Review the existing candidate against agreed intent, repair it, and obtain approval for consequential changes.
disable-model-invocation: true
---

# dev-review

Read `../../references/reconcile.md` and `../../references/engineering.md` at entry. Establish the candidate diff, comparison scope, and applicable agreed specifications and intent from observable repository state, including relevant uncommitted changes. A newly written spec is not required. Resolve ordinary scope questions from evidence; ask when intended outcome or comparison scope is consequentially ambiguous.

- Review the relevant diff for spec alignment and material correctness. Follow affected interactions only where needed to understand consequences: behavior, contracts, data and security effects, compatibility, operational risk, and major architecture, ownership, dependency, or maintainability choices. Avoid style-only cleanup, speculative refactoring, unrelated defects, and system-model teaching.
- Repair clearly incorrect in-scope code directly and validate affected behavior without requesting permission. Include consequential effects of those repairs in the human approval summary. Do not treat an ambiguous product or design choice as an automatic fix.
- Obtain explicit human approval for **all consequential changes**, even spec-compliant behavior and major design choices. Group related changes into high-level batches by outcome or decision, without hiding distinct choices. For each batch, summarize what changed, alignment with agreed intent, why it matters, relevant evidence or uncertainty, and a recommended direction. Offer approval, requested changes, and deferral. Minor internal edits do not need approval.
- Surface potentially intentional spec deviations, uncovered consequential changes, and discretionary behavior, scope, design, or risk choices with a recommendation before keeping or changing them. Do not silently remove or endorse them. Implement and validate approved requested changes yourself; do not hand repairs to the human.
- Preserve approval for unchanged decisions. If repairs or requested changes materially alter approved effects, revisit affected approvals and validation. Deferral leaves an unresolved concern, not an approved candidate.
- Report reviewed scope, consequential approvals, repairs, validation, and remaining concerns concisely. Finish successfully only when applicable validation passes, every required batch is approved, and material concerns are resolved. State missing evidence or decisions explicitly rather than claiming success.

**Endpoint:** The observed candidate has been reviewed and repaired, possibly with fixes still uncommitted. Do not merge the integration branch, stage, commit, rewrite history, publish, or deploy. The human prepares integration and commits before Ship; material changes introduced afterward need renewed review of affected effects, while unchanged approved content needs no reapproval merely because it was committed.
