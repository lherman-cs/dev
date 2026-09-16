# Review one task, requirements and quality
Dispatch `reviewer` with `fork_turns="none"`. This is ONE Reviewer persona, not separate spec/quality seats.

Read [BRIEF_FILE], current [BUILD_REPORT], and [DIFF_FILE]. Worktree: [REPO]. Exact base: [BASE_SHA]. Candidate: [CANDIDATE_SHA]. These and `contract_sha256` in the diff package bind this review. Do not accept mismatched evidence.

Follow `dev-review`; inspect the entire assigned outcome once, including material compliance and correctness. Return all material findings found in scope, not one per round. No broad project audit or routine test rerun.

Read `report-contract.md`; write mode `task` JSON to [REVIEW_REPORT]. Return verdict, path, blocking IDs only. The controller validates the envelope; it does not re-review your judgment.
