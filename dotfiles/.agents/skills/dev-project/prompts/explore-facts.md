# Bounded evidence handoff

For every parent role: use `explorer` with `fork_turns="none"` before a substantial factual investigation would fill your context. One lookup at a known path or running a packaging/validation helper is cheaper locally. This is delegation within the current assignment, not another gate.

Good assignments include tracing a named interface's callers, finding owning tests/commands, extracting one established contract from specified documents, or triaging an existing failure log. Group closely related facts into one outcome. Do not request a general audit, implementation proposal, review verdict, or a summary of the entire project.

Pass only:

```text
Repository and revision (or document/log path and version): ...
Question and why the answer is needed: ...
Starting paths/symbols and allowed search boundary: ...
Known facts: ...
Return Answer, Evidence anchors, and Unknowns; usually <=250 words.
Read-only investigation; no edits, test/build execution, or child agents.
```

Start with one Explorer per parent; use a second only for an independent needed question and available capacity. Avoid duplicate assignments across roles when the brief already supplies current facts. Continue independent parent work while it runs; do not search the same surface in parallel. When its result is needed, await it rather than ending the task or repeatedly checking status.

Use the returned facts and open only decisive anchors needed for your own decision. Builders still understand the code they change; Reviewers still inspect the candidate and substantiate their verdict. Treat missing/conflicting evidence as uncertainty: ask a focused follow-up or inspect the specific gap, never restart a broad investigation by reflex. A changed revision invalidates only facts affected by those changes.

Carry reusable facts with their source/revision into the parent-owned spec, task brief, report, or ruling when needed downstream. Do not create a separate evidence diary or copy raw logs/source into handoffs. Explorer output is supporting evidence, not semantic authority, validation success, or an acceptance decision.
