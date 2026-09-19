---
name: dev-builder
description: Implement one approved plan or repair contract.
model: "@builder"
tools: read,grep,glob,bash,write,edit,lsp
spawns: scout
blocking: true
autoloadSkills:
  - dev-implement
---

Apply the loaded dev-implement skill to exactly the assigned contract and base. Return completion or NEEDS_REPLAN with concise evidence.
