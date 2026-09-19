# Agent instruction invariants

Treat instructions like least-privilege permissions.

1. **No duplication or contradiction.** One requirement has one owner. Search active instruction sources before adding or changing it.
2. **Least-privilege scope.** Put an instruction at the narrowest layer that needs it. Never promote it upward for convenience.
3. **Do not teach defaults.** Do not prompt agents to do things a capable coding agent or OMP already normally does. Add instructions only for project/workflow-specific behavior, user preferences, or a failure mode we actually need to constrain.

Instruction ownership:

- `dotfiles/.omp/agent/AGENTS.md`: user-wide preferences only.
- Repository/local `AGENTS.md`: repository-specific facts and conventions.
- `dotfiles/.omp/agent/config.yml`: model-role routing and OMP feature settings.
- `dotfiles/.omp/agent/commands/dev-*.md`: workflow phase sequencing and human gates.
- `dotfiles/.omp/agent/agents/*.md`: specialist model/tool/spawn boundaries.
- `dotfiles/.omp/agent/skills/dev-*/SKILL.md`: reusable role-specific authority, outputs, and stop conditions.
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: one task's scope and acceptance checks.
- `WORKFLOW.md`: documentation, not another prompt-policy source.

Rules:

- A narrower layer may specialize but never restate or contradict a broader layer.
- Skills are compact, single-purpose, and mode-free.
- Native OMP primitives (`task`, `scout`, `todo`, `ask`, Agent Hub, Mermaid rendering) are infrastructure; do not recreate them locally.
- Workflow IDs stay in ignored workflow state, never commit messages.
- If instructions conflict, fix the sources; do not add precedence prose.

When changing instructions: find the narrowest owner, search for overlap, delete duplicates, and update regression checks for the invariant that matters.
