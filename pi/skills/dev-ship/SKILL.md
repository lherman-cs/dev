---
name: dev-ship
description: Ship a clean committed candidate to local main with an approved squash message.
disable-model-invocation: true
---

# dev-ship

Use `/dev-ship` or `dev a ship`. The deterministic runtime checks source and local main, proposes a Conventional Commit message, obtains explicit human approval of the exact message and local integration, then safely fast-forwards main to one squash commit with the candidate tree. A tweak is not approval. The feature branch is left untouched. No remote operation or shipping branch is created.
