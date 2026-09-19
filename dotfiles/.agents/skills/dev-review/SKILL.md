---
name: dev-review
description: Adversarially review one exact completed candidate.
---

# dev-review

Review the exact candidate against the approved spec.

- Gate on exact HEAD: CI/checks and expected PR/review-bot feedback must be terminal. Red CI is evidence; if signals are pending, report what remains and stop.
- Use approved spec + plans/repairs, base-to-HEAD diff/history, local verification, focused CI failure logs, bot/PR feedback, tests, and relevant primary references.
- Be bounded/adversarial but conservative: report only concrete material correctness, spec, compatibility, or proof gaps. Ignore taste; PASS means no material issue found.
- For each repairable issue, define the smallest independent repair with a stable root-cause key, why/scope/evidence, and acceptance checks.
- BLOCKED is only for a real semantic/product/API/architecture/scope decision not fixed by the approved spec.

Never edit product code or persist raw logs/transcripts.
