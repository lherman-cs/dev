# Builder dispatch: bounded repair

Use `dev-build`.

Repository/worktree: {{repo}}
Project: {{project}}
Original task brief: {{task_brief_path}}
Repair brief: {{repair_brief_path}}
Previous candidate: {{previous_candidate}}
Write repair report: {{repair_report_path}}

Address only the listed blocking finding IDs and directly necessary repair consequences. Preserve the original accepted task requirements and any controller rulings. Diagnose root cause before patching. Run focused affected verification plus the repair-brief validation, self-review, and create one **new** repair commit; never amend the reviewed candidate.
Finalize the repair report with the actual committed SHA and run the dev-build handoff validator before returning COMPLETED.

Do not opportunistically repair unrelated old code or implement optional suggestions. Verify affected shared-helper callers against their real contracts. If a finding or prescribed fix is contradicted by evidence, return that evidence to the controller for clarification before editing; preserve the requirement and choose the smallest correct repair.
