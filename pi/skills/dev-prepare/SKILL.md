---
name: dev-prepare
description: Manually create the exact remote review candidate, then stop.
---

# dev-prepare

Operational candidate preparation only.

- Require all approved plans/repairs complete according to Git + `progress.toon`, and a clean worktree.
- Fetch/rebase onto the configured base (default `origin/main`). Resolve ordinary integration conflicts; stop if resolution needs a new semantic/product/architecture decision.
- Run project/repository final integration tests plus relevant docs, lint, format, and other declared checks.
- Preparation changes must be mechanical/minimal. If behavior must change, stop with precise evidence rather than patching around it.
- Push, create/update a **draft** PR with a concise provisional body, and confirm exact pushed HEAD/PR so external checks can start.

Then stop. Do not invent implementation fixes, adversarially review, wait/poll CI or bots, mark ready, or merge.
