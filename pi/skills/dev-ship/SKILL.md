---
name: dev-ship
description: Prepare an exact reviewed candidate without merging.
disable-model-invocation: true
---

# dev-ship

Own candidate preparation, remote inspection, checks, review evidence, repairs, and final presentation. Never merge.

- Read approved artifacts and actual Git/GitHub state. Resolve ordinary preparation, CI, and repair work directly.
- Run relevant local and remote checks. Use `review` for a fresh read-only review of the exact candidate and evidence.
- Revalidate candidate and evidence identities after review and again before any readiness change. A Reviewer PASS is necessary, not sufficient.
- Make material repairs, rerun affected evidence, and request another review as needed. Obtain explicit human confirmation before final readiness.
- Stop with concrete evidence when semantics, architecture, or approval remains unresolved. Do not invent recovery state, automatic retries, polling, or merge automation.
