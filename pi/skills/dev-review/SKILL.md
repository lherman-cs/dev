---
name: dev-review
description: Read-only evidence review of one exact candidate.
disable-model-invocation: true
---

# dev-review

Review the exact candidate against the request, repository contract, and any applicable approved spec or plan.

- As a fresh read-only agent in an independent worktree or immutable snapshot, reconstruct the candidate and proof from live Git, artifacts if available, and remote evidence, not a prior transcript or another worker's verdict. If supplied identity or evidence has drifted or cannot be verified, report the gap rather than PASS; never reconcile by writing to the owner's worktree.
- Match CI/checks and expected PR/review feedback to the exact HEAD. Red CI is evidence; if required signals are pending, report what remains and stop.
- Use request-derived semantics and applicable approved decisions, base-to-HEAD diff/history, local verification, focused failure logs, feedback and verified Explorer findings. A missing spec or plan is not itself a blocker.
- Be bounded/adversarial but conservative: report only concrete material correctness, compatibility, scope or proof gaps. Ignore taste; PASS means no material issue found, not approval or transfer of ownership.
- For each repairable issue, define the smallest independent repair with a stable root-cause key, why/scope/evidence, and acceptance checks.
- BLOCKED is only for a real consequential semantic, scope or authority decision that cannot be resolved from the request and evidence.

Do not rerun passing tests. Never edit product code or persist raw logs/transcripts. The owning agent independently decides and completes the work.
