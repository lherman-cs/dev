# Agent instruction invariants

Treat instructions like least-privilege permissions.

1. **No duplication or contradiction.** One requirement has one owner. Search active instruction sources before adding or changing it.
2. **Least-privilege scope.** Put an instruction at the narrowest layer that needs it. Never promote it upward for convenience.
3. **Do not teach defaults.** Do not prompt agents to do things a capable coding agent already normally does. Add instructions only for project/workflow-specific behavior, user preferences, or a failure mode we actually need to constrain.
4. **Child-worker contract ownership.** Keep the general costly-evidence delegation trigger in the shared Explorer tool contract so every parent agent receives it. Every child-agent launch, including worker-owned and fixed dev-ship launches, must return immediately and deliver completion asynchronously. Repository and user instructions must not restate these shared contracts.

Instruction ownership:

- `pi/AGENTS.md` (seed for the user-owned Pi `AGENTS.md`): user-wide preferences only.
- Repository/local `AGENTS.md`: repository-specific facts and conventions.
- `pi/skills/dev-*/SKILL.md`: reusable role-specific authority, outputs, and stop conditions.
- `pi/extension.ts` and `pi/lib/*.ts`: current-session alias dispatch; child-session capability boundaries; transport validation; tiny contracts for non-reusable internal workers.
- Approved Markdown specs and plans: one task's scope and acceptance checks.
- `pi/roles.json`: exact roles and explicit subscription/API authentication transport.
- `pi/package.json` and lockfile: pinned requested plugins, not a second harness.
- `WORKFLOW.md`: documentation, not another prompt-policy source.

Rules:

- A narrower layer may specialize but never restate or contradict a broader layer.
- Skills are compact, single-purpose, and mode-free.
- **Pi lazy-skills.** Keep skill bodies out of standing instructions; load them only through an explicit `/skill:<name>` invocation when needed.
- Reusable semantic roles, sequencing, Git/GitHub work, verification, repair convergence, and human gates belong in skills.
- Internal worker transport may add invocation data/output schema and tool boundaries, but must not duplicate skill semantics.
- Never overwrite user Pi/OMP settings or credentials.
- Preserve symmetric `dev a <phase>` / `/dev-<phase>` dispatch. The only foreground coordinator is the fixed-purpose, typed `/dev-ship` runtime; do not introduce a general coordinator.
- If instructions conflict, fix the sources; do not add precedence prose.

When changing instructions: find the narrowest owner, search for overlap, delete duplicates, and update regression checks for the invariant that matters.
