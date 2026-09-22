---
name: dev-review
description: Adversarially review one exact completed candidate.
disable-model-invocation: true
---

# dev-review

Review the exact candidate against the approved spec.

- As a fresh read-only agent, reconstruct the candidate and proof from live Git, artifacts and available remote evidence, not a prior transcript or another worker's verdict. If the supplied identity or evidence has drifted or cannot be verified, report the gap rather than PASS; never reconcile by writing to the worktree.
- Gate on exact HEAD: CI/checks and expected PR/review-bot feedback must be terminal. Red CI is evidence; if signals are pending, report what remains and stop.
- Use the approved spec + any approved plan/repairs, base-to-HEAD diff/history, local verification, focused CI failure logs, bot/PR feedback, tests, and verified Explorer findings.
- Be bounded/adversarial but conservative: report only concrete material correctness, spec, compatibility, or proof gaps. Ignore taste; PASS means no material issue found.
- For each repairable issue, define the smallest independent repair with a stable root-cause key, why/scope/evidence, and acceptance checks.
- BLOCKED is only for a real semantic/product/API/architecture/scope decision not fixed by the approved spec.

Do not rerun passing tests. Never edit product code or persist raw logs/transcripts.
