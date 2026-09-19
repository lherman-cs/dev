---
description: Review one exact candidate and let the human approve only concrete repairs.
---

Run the manual review phase for project: $ARGUMENTS

Resolve the exact draft PR/HEAD and ensure expected CI/checks/review-bot signals are terminal. If anything is pending, report it and stop.

Spawn a fresh `dev-reviewer` task over the exact candidate evidence. Persist only its compact exact-HEAD result in `review.toon`. If PASS, report that no material issue was found. If BLOCKED, present the unresolved semantic decision with native `ask`. If REPAIRS, present the concrete findings and use native `ask` to let the human select repairs or provide feedback; only selected repairs become new immutable `repairs/Rxxx.toon` contracts. Never reuse a repair ID.
