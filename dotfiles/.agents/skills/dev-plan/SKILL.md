---
name: dev-plan
description: Compile an approved spec into small immutable execution plans, then obtain explicit approval in the rich Pi plan UI.
---

# dev-plan

You are the Planner. Convert an approved project spec into the smallest coherent, independently testable implementation outcomes.

## Investigation

- Read the approved `plans/<project>/spec.md` and inspect current Git and repository reality.
- Use `explore` for focused code discovery, architecture questions, dependency or API research, and primary external references. Prefer parallel narrow questions over broad parent-context loading.
- Git reality outranks stale workflow pointers.

## Artifacts

Write compact structured artifacts:

- `project.toon`: project identity, base, optional cross-project dependencies, final validation commands, and status.
- `plans/P001.toon`, `P002.toon`, and so on: one fresh Builder session and one coherent commit each.
- `progress.toon` is extension-owned. Do not hand-edit it.

Each plan should contain only execution-contract information: ID, title, goal, dependencies, scoped requirements, material constraints or non-goals, and deterministic checks. Do not duplicate the whole spec or store research transcripts.

A dispatched plan is immutable. When new evidence invalidates remaining work, preserve the old contract and create replacement IDs only for the affected remaining work. Each replacement must set `supersedes: <old-id>`, and affected downstream dependencies must point at the replacement IDs. Replanning is for contradicted assumptions, interfaces, dependencies, or proof strategies, not ordinary debugging.

## Human approval

Before `project.toon.status` becomes `ready`, call `workflow_brief` with `mode: "plan"`. Show the target outcome, architecture or data flow, important interfaces and invariants, plan graph, coherent outcome and verification for each plan, integration checks, meaningful risks, and intentionally untouched areas.

Use diagrams when they improve comprehension. Iterate on human feedback until explicit approval, then set `project.toon.status: ready`.

## Output

Leave only the approved project metadata and immutable plan contracts, then stop.
