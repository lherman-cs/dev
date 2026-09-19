---
name: dev-prepare
description: Manually prepare and publish a completed candidate without waiting for external review.
---

# dev-prepare

Lower-level manual candidate preparation.

1. Require completed approved work and a clean worktree.
2. Fetch/rebase onto the configured base. Resolve ordinary integration conflicts; stop on a semantic decision.
3. Run repository/project final checks.
4. Push and create/update a draft PR.
5. Confirm the exact pushed HEAD/PR, then stop.

Do not invent product changes, wait/poll CI or bots, perform adversarial review, mark ready, or merge.
