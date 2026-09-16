# Fresh scoped rereview
Dispatch ONE fresh Reviewer with `fork_turns="none"`, using the configured capability for this assignment (the final review capability for final repairs).

Mode: [MODE = repair | final-repair]. Worktree: [REPO]. Read original [BRIEF_FILE], prior [REPAIR_PACKET], current [BUILD_REPORT], and exact [FIX_DIFF_FILE]. Fix base: [FIX_BASE_SHA]. Candidate: [CANDIDATE_SHA]. Write [REVIEW_REPORT] using `report-contract.md`.

Verdict every prior blocking ID with evidence. Inspect the fix's causal effects, including unchanged callers when needed; do not restart the original audit. New routine findings must be repair-caused. A serious candidate-caused late discovery must remain explicit and blocking, never automatically downgraded; classify it `late-discovery`. No new blocker for unrelated old code or optional improvement. Return verdict, path and blocking IDs only.

Package SHA256: [PACKAGE_SHA256]. Copy this into the schema-2 report. The package binds any previous packet and current final validation.
