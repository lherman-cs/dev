# Build one task
Dispatch `builder` with `fork_turns="none"`.

Task: [TASK_ID]. Read [BRIEF_FILE] first; it is the immutable assignment, not the session history. Base: [BASE_SHA]. Relevant approved overlay, if any: [OVERLAY_FILE]. Worktree: [REPO]. Write [REPORT_FILE] after committing the candidate.

Follow the bundled `dev-build`. Do not start another task. Return status, actual SHA, report path and a specific blocker only. The controller will supply one independent review; do not create another reviewer.
