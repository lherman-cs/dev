# Agent instruction invariants

Treat instructions like least-privilege permissions.

1. **No duplication or contradiction.** One requirement has one owner. Search active instruction sources before adding or changing it.
2. **Least-privilege scope.** Put an instruction at the narrowest layer that needs it. Never promote it upward for convenience.
3. **Do not teach defaults.** Do not prompt agents to do things a capable coding agent already normally does. Add instructions only for project/workflow-specific behavior, user preferences, or a failure mode we actually need to constrain.
4. **Explorer-first context economy.** Main agents must use Explorer heavily by delegating every open-ended or input-heavy codebase, web, or other evidence-gathering scope. Give each Explorer one independent scope, run independent scopes in parallel when useful, and return only compact findings so raw exploration stays out of the main context.

Instruction ownership:

- `pi/AGENTS.md` (seed for the user-owned Pi `AGENTS.md`): user-wide preferences only.
- Repository/local `AGENTS.md`: repository-specific facts and conventions.
- `pi/skills/dev-*/SKILL.md`: reusable role-specific authority, outputs, and stop conditions.
- `pi/extension.ts` and `pi/lib/*.mjs`: deterministic lifecycle mechanics; invocation schemas/boundaries; tiny contracts for non-reusable internal workers.
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: one task's scope and acceptance checks.
- `pi/roles.json`: exact roles and explicit subscription/API authentication transport.
- `pi/package.json` and lockfile: pinned requested plugins, not a second harness.
- `WORKFLOW.md`: documentation, not another prompt-policy source.

Rules:

- A narrower layer may specialize but never restate or contradict a broader layer.
- Skills are compact, single-purpose, and mode-free.
- **Pi lazy-skills.** Keep skill bodies out of standing instructions; load them only through an explicit `/skill:<name>` invocation when needed.
- Reusable semantic roles belong in skills; retries, polling, checkpoints, Git/GitHub sequencing, and independent verification belong in code.
- Controller prompts may add invocation data/output schema/tool boundaries, but must not duplicate skill semantics.
- Workflow IDs stay in ignored workflow state, never commit messages.
- Never overwrite user Pi/OMP settings or credentials.
- Preserve symmetric `dev a <phase>` / `/dev-<phase>` dispatch; no foreground coordinator model.
- If instructions conflict, fix the sources; do not add precedence prose.

When changing instructions: find the narrowest owner, search for overlap, delete duplicates, and update regression checks for the invariant that matters.
