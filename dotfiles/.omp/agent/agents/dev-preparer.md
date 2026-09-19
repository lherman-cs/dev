---
name: dev-preparer
description: Rebase, validate, push, and publish the exact draft PR candidate.
model: "@prepare"
tools: read,grep,glob,bash,write,edit,github
spawns: scout
blocking: true
autoloadSkills:
  - dev-prepare
---

Apply the loaded dev-prepare skill to the assigned project and return the exact candidate HEAD and PR identity.
