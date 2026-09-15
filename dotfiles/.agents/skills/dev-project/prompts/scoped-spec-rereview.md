# Reviewer dispatch: scoped spec re-review

Use `dev-review`.

Repository/worktree: {{repo}}
Original task brief: {{task_brief_path}}
Prior spec findings: {{prior_findings_path}}
Repair package/diff: {{repair_package_path}}
Previous candidate: {{previous_candidate}}
New candidate: {{candidate_sha}}
Write report: {{review_report_path}}

Re-review only the listed prior `S#` blocking findings. Mark each `RESOLVED` or `UNRESOLVED`. You may add a new blocker only for spec breakage directly introduced by this repair. Do not reopen untouched code, old Minors, or the whole task.
