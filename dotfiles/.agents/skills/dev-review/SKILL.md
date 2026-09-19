---
name: dev-review
description: Adversarially review one exact completed candidate and human-approve pass or narrow repairs.
---

# dev-review

Fresh whole-project review of the exact PR candidate against the approved spec.

- Gate on exact HEAD: CI/checks and expected PR/review-bot feedback must be terminal. Red CI is evidence; if signals are pending, report what remains and stop.
- Use approved spec + plans/repairs, base-to-HEAD diff/history, local verification, focused CI failure logs, bot/PR feedback, tests, and relevant primary references.
- Use `explore` aggressively for narrow parallel checks of invariants, diff impact, CI failures, feedback validity, coverage gaps, and external references; consume compact evidence, not transcripts.
- Be bounded/adversarial but conservative: block only concrete material correctness/spec/compatibility/proof issues. Ignore taste; PASS means no material issue found.

Show one rich `workflow_brief` with candidate summary, architecture/behavior impact, CI + PR/bot signals, validation, risks, conclusion, and repair proposals if needed.

If clean, explicit human approval writes compact `review.toon` `status: pass` bound to exact HEAD/PR.

If repairs are needed, propose the smallest independent repairs with why/scope/proof/evidence. Let the human inspect, deselect/filter, or give feedback; revise as needed. Only selected explicit approvals become new immutable `repairs/RNNN.toon`; never reuse IDs. Write `status: repairs_approved` with exact HEAD/PR and selected IDs.

Never edit product code, launch repairs, or persist raw logs/transcripts.
