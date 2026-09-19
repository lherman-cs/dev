---
name: dev-review
description: Manually review one exact completed PR candidate and approve pass or narrow repairs.
---

# dev-review

Review the exact current PR candidate against the approved spec.

- Require terminal CI/checks for exact HEAD; red is evidence. Require relevant PR/review-bot feedback to be complete.
- Inspect the base-to-HEAD diff/history, tests, CI failures, and feedback. Use `explore` for focused read-only verification.
- Ignore taste; find material correctness, compatibility, spec, and proof gaps.
- Present one rich `workflow_brief`.

If clean, explicit human approval writes compact `review.toon` with `status: pass`, exact HEAD/PR, and concise evidence.

If repairs are needed, let the human inspect/filter/revise proposals. Only explicitly approved repairs become immutable `repairs/RNNN.toon`; write `review.toon` with `status: repairs_approved`.

Never edit product code, launch repairs, or store raw logs/transcripts.
