# Reviewer dispatch: scoped spec re-review

Use `dev-review`.

Repository/worktree: {{repo}}
Original task brief: {{task_brief_path}}
Prior spec findings: {{prior_findings_path}}
Repair package/diff: {{repair_package_path}}
Previous candidate: {{previous_candidate}}
New candidate: {{candidate_sha}}
Write report: {{review_report_path}}

Check the listed prior `S#` blockers and spec breakage directly introduced by the exact repair. Mark prior IDs `RESOLVED` or `UNRESOLVED`. If the prior verdict was PASS, there are no old blockers: check only the assigned requirements/interfaces affected by this repair. Do not reopen untouched code, old Minors, or the whole task.
