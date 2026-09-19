---
name: dev-builder-retry
description: Retry one failed implementation contract with additional reasoning.
model: "@builder_retry"
tools: read,grep,glob,bash,write,edit,lsp
spawns: scout
blocking: true
autoloadSkills:
  - dev-implement
---

Apply the loaded dev-implement skill to the same assigned contract after the parent provides the failed verification evidence. Amend the existing contract commit when one exists.
