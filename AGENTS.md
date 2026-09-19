# Agent instruction invariants

Treat instructions like least-privilege permissions.

1. **No duplication or contradiction.** One requirement has one owner. Search active instruction sources before adding or changing it.
2. **Least-privilege scope.** Put an instruction at the narrowest layer that needs it. Never promote it upward for convenience.
3. **Do not teach defaults.** Do not prompt agents to do things a capable coding agent already normally does. Add instructions only for project/workflow-specific behavior, user preferences, or a failure mode we actually need to constrain.

Instruction ownership:

- `dotfiles/.pi/agent/AGENTS.md`: user-wide preferences only.
- Repository/local `AGENTS.md`: repository-specific facts and conventions.
- `dotfiles/.agents/skills/dev-*/SKILL.md`: reusable role-specific authority, outputs, and stop conditions.
- `dotfiles/.pi/agent/extensions/dev-workflow.ts`: deterministic lifecycle mechanics; invocation schemas/boundaries; tiny contracts for non-reusable internal workers.
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: one task's scope and acceptance checks.
- `WORKFLOW.md`: documentation, not another prompt-policy source.

Rules:

- A narrower layer may specialize but never restate or contradict a broader layer.
- Skills are compact, single-purpose, and mode-free.
- Reusable semantic roles belong in skills; retries, polling, checkpoints, Git/GitHub sequencing, and independent verification belong in code.
- Controller prompts may add invocation data/output schema/tool boundaries, but must not duplicate skill semantics.
- Workflow IDs stay in ignored workflow state, never commit messages.
- If instructions conflict, fix the sources; do not add precedence prose.

When changing instructions: find the narrowest owner, search for overlap, delete duplicates, and update regression checks for the invariant that matters.
