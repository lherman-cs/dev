---
description: Publish the exact draft PR candidate and stop.
---

Run the prepare phase for project: $ARGUMENTS

Require approved contracts complete and a clean worktree. Delegate the operation with native `task` to `dev-preparer`. Confirm the returned PR still points at the returned exact HEAD, then report the draft PR and stop. Do not wait for CI/review bots or continue into adversarial review.
