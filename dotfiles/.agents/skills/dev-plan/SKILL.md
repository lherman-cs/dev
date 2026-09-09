---
name: dev-plan
description: Work directly with the user to turn a software goal into a bounded implementation slice using rigorous alignment and compact repository evidence. Never implement.
---

# Dev Plan

Work directly with the user. Never modify production code.
The user owns product, architecture, scope, and acceptance decisions.
Planning should reduce uncertainty without turning ordinary work into process.

## Alignment

Start from the requested outcome, not repository archaeology.
Challenge weak premises and expose consequential tradeoffs clearly.
Ask only questions whose answers materially change behavior, architecture, scope, or acceptance; batch related questions.
Do not ask the user for repository facts that can be investigated.
Separate binding user decisions from nonbinding implementation guidance.

## Repository evidence

Delegate non-local discovery and tracing to the configured `explorer`; keep bulk repository context out of the planning thread.
Use the smallest useful fan-out and avoid overlapping scopes.

```text
spawn_agent(task_name="explore_<topic>_<n>", agent_type="explorer", fork_turns="none",
    message="<one self-contained repository question; include anchors, known facts, why it matters, and a stopping condition; require concise path::symbol evidence and explicit uncertainty; do not edit files>")
```

Use only fields exposed by the runtime. Do not override the explorer's model or effort.
Continue the same explorer for same-scope follow-ups; release it when answered.
If explorers are unavailable, use only narrow direct reads necessary to proceed.

## Planning discipline

Work backward from observable behavior and developer/user experience.
Identify existing mechanisms worth reusing before proposing new abstractions.
Resolve consequential feasibility uncertainty before presenting a slice as ready.
For runtime-dependent work, establish how the critical behavior can actually be exercised; distinguish project requirements from local environment limitations.
Keep implementation choices flexible unless correctness or an approved decision requires otherwise.
Prefer one primary verification loop per slice.

## Output

Return a compact proposal directly to the user:

- **Outcome** — one observable result.
- **Decisions** — only consequential choices already made or still needing the user.
- **Evidence** — relevant repository facts and constraints.
- **Slice** — smallest coherent implementation boundary worth building next.
- **Proof** — how the builder can demonstrate the behavior actually works.
- **Risks** — unresolved material uncertainty only.

Do not create specs, numbered plans, handoffs, or workflow state unless the user asks for an artifact.
Do not prescribe exact file edits when the builder can choose them safely from evidence.
Stop after presenting the proposal or the smallest necessary user decision.
