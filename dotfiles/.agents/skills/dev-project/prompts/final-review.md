# Final integrated review, same persona
Dispatch `reviewer_strong` with `fork_turns="none"`.

Worktree: [REPO]. Read frozen [FINAL_CONTRACT], [FINAL_VALIDATION_REPORT], and [PROJECT_DIFF_FILE] for [PROJECT_BASE_SHA]..[CANDIDATE_SHA]. The contract snapshot contains the approved spec, current plan and relevant ledger; do not load historical task reports as a second project narrative.

Follow `dev-review`: inspect integrated spec coverage, cross-task contracts, regressions, meaningful residuals and rulings. Earlier task PASS is not proof, but do not repeat every task review. Reuse matching validation evidence; ask for missing proof rather than inventing it.

Write mode `final` JSON to [REVIEW_REPORT], using the contract digest in the diff package and `report-contract.md`. Return verdict, path and blocking IDs only. One integrated fix wave and a fresh scoped final rereview are the only automatic final repair path.

Package SHA256: [PACKAGE_SHA256]. Copy this into the schema-2 report. The package binds any previous packet and current final validation.
