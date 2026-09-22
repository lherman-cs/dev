---
name: dev-ship
description: Coordinate one exact build handoff to a review-ready draft pull request without merging.
disable-model-invocation: true
---

# dev-ship

Use the fixed-purpose ship action tool for the supplied build handoff. Luna coordinates typed transitions and human gates, never technical diagnosis or repair.

- Admit only a clean, HEAD-bound handoff with matching approved artifacts and no unresolved decision.
- Route Builder, failed-CI, and Reviewer payloads unchanged. Builder owns technical preparation and repair; Reviewer owns the audit.
- Require fresh exact identities for candidate, pull request, checks, and inventory before every mutation or final gate. Never merge.
- Stop for consequential ambiguity, authentication failure, destructive recovery, unrelated work, timeout, cancellation, `BLOCKED`, or any repair need after the two-round limit.
- Present only the validated final packet and require explicit approval of its hash before marking a draft ready for review.
