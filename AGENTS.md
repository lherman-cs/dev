# Agent instruction architecture

This repository treats prompt/instruction design as code. Apply least privilege: every instruction belongs at the narrowest scope that needs it. Keep instructions small, non-overlapping, and contradiction-free.

## Ownership

Every instruction has exactly one owner:

- `dotfiles/.pi/agent/AGENTS.md`: universal engineering behavior that should apply to every role and repository.
- Repository/local `AGENTS.md`: repository-specific architecture, commands, ownership, and conventions.
- `dotfiles/.agents/skills/dev-*/SKILL.md`: one reusable role's authority, decision standard, role-specific invariants, and stop conditions.
- `dotfiles/.pi/agent/extensions/dev-workflow.ts`: deterministic lifecycle mechanics plus tiny contracts for internal workers that do not have a skill.
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: task-specific scope, constraints, dependencies, and acceptance checks.
- `WORKFLOW.md`: documentation of the lifecycle, not an additional prompt policy source.

Before adding an instruction, find the lowest-scope owner that needs it. Strengthen or replace the instruction there; never promote it to a broader layer for convenience and never copy it into another layer.

## Composition rules

- Broader layers contain only invariants needed by every descendant. Narrower layers add only what their role/repository/task needs; they must not contradict broader invariants.
- Skills must not repeat universal engineering guidance from the global `AGENTS.md`. Assume it is already inherited.
- Skills are single-purpose and mode-free. No environment-variable modes or alternate personas inside a skill.
- Controller prompts must not restate global engineering policy or reusable skill semantics. They provide only invocation data, presentation/output schemas, tool/side-effect boundaries, or contracts for genuinely internal roles.
- A reusable semantic role belongs in a skill. Deterministic sequencing, retries, polling, Git/GitHub mechanics, and independent verification belong in code.
- Task contracts must not contain workflow policy or generic engineering philosophy.
- Project `AGENTS.md` files may add repository facts/conventions, but must not redefine workflow lifecycle or role outputs.
- If two active instructions disagree, fix the instruction sources. Do not add precedence prose that asks the model to choose between contradictory rules.

## Workflow boundaries

- `dev-spec`, `dev-plan`, `dev-implement`, `dev-prepare`, and `dev-review` are semantic skills. Invocation-specific UI or output encoding is supplied by the command/controller, not hidden as a mode inside the skill.
- `/dev-build` is a deterministic controller that dispatches `dev-implement`; implementation behavior lives in the skill. Plan/repair-to-commit mapping stays in ignored workflow state, never commit messages.
- `/dev-ship` is a deterministic controller. Its conflict resolver and PR finalizer are narrow internal roles. Its machine Reviewer reuses `dev-review` semantics and adds only a structured-output contract.
- Models never own workflow phase, retries, polling, checkpoints, GitHub waiting, or acceptance of their own claims.

## Change checklist

When changing agent instructions:

1. Identify the narrowest owning layer.
2. Search all other active instruction sources for overlap or contradiction.
3. Delete duplicated wording instead of trying to keep copies synchronized.
4. Keep skills compact by removing inherited guidance, not semantic requirements.
5. Add/update regression checks for important ownership boundaries and role semantics.
