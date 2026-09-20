# Agent instruction invariants

Treat instructions like least-privilege permissions.

1. **No duplication or contradiction.** One requirement has one owner. Search active instruction sources before adding or changing it.
2. **Least-privilege scope.** Put an instruction at the narrowest layer that needs it. Never promote it upward for convenience.
3. **Do not teach defaults.** Do not prompt agents to do things a capable coding agent or OMP already normally does. Add instructions only for project/workflow-specific behavior, user preferences, or a failure mode we actually need to constrain.

Instruction ownership:

- `dotfiles/.omp/agent/AGENTS.md`: user-wide preferences only.
- Repository/local `AGENTS.md`: repository-specific facts and conventions.
- `dotfiles/.omp/agent/dev-workflow.yml`: workflow-owned role defaults only; never the user's OMP config.
- `dev a spec|plan|resume`: interactive role + skill launching.
- `dotfiles/.omp/agent/extensions/dev-workflow.ts`: deterministic Build/Prepare/Review/Ship mechanics.
- `dotfiles/.omp/agent/skills/dev-*/SKILL.md`: reusable engineering semantics.
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: one work item's contract.
- `WORKFLOW.md`: documentation, not another prompt-policy source.

Rules:

- A narrower layer may specialize but never restate or contradict a broader layer.
- Skills are compact, single-purpose, and mode-free.
- Code decides workflow; models decide engineering.
- Do not route deterministic phases through a foreground orchestrator model.
- OMP owns task/scout/Agent Hub/rendering/dialog/runtime infrastructure.
- Never manage or overwrite `~/.omp/agent/config.yml` from this repository.
- Workflow IDs stay in ignored workflow state, never commit messages.
- If instructions conflict, fix the sources; do not add precedence prose.
