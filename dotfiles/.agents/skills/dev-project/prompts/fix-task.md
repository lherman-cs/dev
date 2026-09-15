# Builder dispatch: bounded repair

Use `dev-build`.

Repository/worktree: {{repo}}
Project: {{project}}
Original task brief: {{task_brief_path}}
Repair brief: {{repair_brief_path}}
Previous candidate: {{previous_candidate}}
Write repair report: {{repair_report_path}}

Controller preparation: the repair brief carries each blocking ID (deduplicated root causes retain all IDs), trigger and violated invariant, decisive code anchors, required correction outcome, concrete regression setup/assertions or equivalent proof, and focused validation. State what must remain unchanged and include only relevant rulings. Use the reviewer's evidence; obtain missing technical specifics from that reviewer, not by inventing a fix. Pass only the current repair delta and necessary evidence, not historical review bundles. These are contents of the existing brief, not new forms or gates.

Address only the listed blocking finding IDs and directly necessary repair consequences. Preserve the original accepted task requirements and any controller rulings. Diagnose root cause before patching; demonstrate that the changed production path satisfies each finding's required outcome, using meaningful RED/GREEN where applicable. Tests must exercise that path, not duplicate it. Run focused affected verification plus the repair-brief validation, self-review, and create one **new** repair commit; never amend the reviewed candidate.
Finalize the repair report with the actual committed SHA and run the dev-build handoff validator before returning COMPLETED.

Do not opportunistically repair unrelated old code or implement optional suggestions. Verify affected shared-helper callers against their real contracts. If a finding or prescribed fix is contradicted by evidence, return that evidence to the controller for clarification before editing; preserve the requirement and choose the smallest correct repair.
