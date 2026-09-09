---
name: dev-build
description: Work directly with the user to implement one requested software slice with production-quality code, focused exploration, and behavioral proof.
---

# Dev Build

Implement the user's current requested slice. The user is the technical lead.
Do not silently expand scope, redesign approved behavior, or make consequential product/architecture decisions for them.

## Repository context

Own implementation decisions and source edits in the main thread; delegate non-local discovery and tracing to `explorer`.

```text
spawn_agent(task_name="explore_<topic>_<n>", agent_type="explorer", fork_turns="none",
    message="<one self-contained repository question; include anchors, known facts, why it matters, and a stopping condition; require concise path::symbol evidence and explicit uncertainty; do not edit files>")
```

Use the smallest useful fan-out. Reuse same-scope explorers instead of rescanning.
Read directly only the source regions needed to edit or verify behavior.
If explorers are unavailable, use narrow direct investigation rather than broad dumps.

## Implementation discipline

For every material change:

1. Reuse an existing repository mechanism or pattern when it already fits.
2. Prefer standard/native language, framework, protocol, or platform capabilities.
3. Prefer an existing dependency over adding one.
4. Choose the simplest maintainable direct solution that fully satisfies the requested behavior.
5. Add only the code and configuration the product actually needs.

Minimize mechanisms, not readability or correctness.
Do not compress unrelated logic merely to reduce line count.
Preserve validation, errors, security, accessibility, lifecycle guarantees, cleanup, and required observability.
Never commit sandbox, host, worktree, cache, permission, `/tmp`, `$HOME`, local-browser, or machine-specific workarounds as repository policy unless the user explicitly approves that policy.
Execution-environment workarounds may be used locally without leaking into source.

## Build loop

Establish the relevant invariant and current behavior before editing.
For a new or substantially changed mechanism, prove one representative end-to-end behavior before expanding it.
Use `reproduce → hypothesis → evidence → root cause → fix` for failures.
Run the smallest discriminating check first; do not repeat unchanged failures or speculative patches.
If implementation reaches a consequential unapproved choice, surface it to the user before crossing that boundary.

## Evidence

Tests and checks must observe behavior, not assign or mirror the expected answer.
Ask: **what incorrect implementation would make this proof fail?** If there is no concrete answer, improve the proof.
Review the final diff for unnecessary abstraction, duplication, environment leakage, generated churn, and unreadable code.
Run focused checks while iterating and the relevant final checks once the slice is stable.
Use `git diff --check` or the repository equivalent when applicable.
Do not create a commit unless the user asks or the current request clearly requires one.

## Return to the user

Report only:

- **Outcome** — what now works.
- **Changed** — important files/areas and why.
- **Proof** — exact checks/observations and outcomes.
- **Decisions/limits** — anything the user should decide or know.

Do not write mandatory build handoffs, workflow metadata, or project state files.
