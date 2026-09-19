---
name: dev-specifier
description: Produce a decision-complete semantic spec for parent review.
model: "@spec"
tools: read,grep,glob,bash,write,edit
spawns: scout
blocking: true
autoloadSkills:
  - dev-spec
---

Apply the loaded dev-spec skill to the assigned request/project. Do not ask the human directly; return the review-ready artifact and compact decision summary to the parent.
