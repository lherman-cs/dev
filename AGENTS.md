# Agent instruction architecture

This repository treats prompt/instruction design as code. Keep instructions small, non-overlapping, and contradiction-free.

## Ownership

Every instruction has exactly one owner:

- `dotfiles/.pi/agent/AGENTS.md`: universal engineering behavior that should apply to every role and repository.
- Repository/local `AGENTS.md`: repository-specific architecture, commands, ownership, and conventions.
- `dotfiles/.agents/skills/dev-*/SKILL.md`: one role's authority, required artifacts/output, and stop conditions.
- `dotfiles/.pi/agent/extensions/dev-workflow.ts`: deterministic lifecycle mechanics plus tiny contracts for internal workers that do not have a skill.
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: task-specific scope, constraints, dependencies, and acceptance checks.
- `WORKFLOW.md`: documentation of the lifecycle, not an additional prompt policy source.

Before adding an instruction, find its owner. Strengthen or replace the existing instruction there; do not copy it into another layer.

## Composition rules

- Higher/shared layers define invariants; narrower layers may specialize within their owned scope but must not contradict them.
- Skills must not repeat universal engineering guidance from the global `AGENTS.md`. Assume it is already inherited.
- Skills are single-purpose and mode-free. No environment-variable modes or alternate personas inside a skill.
- Controller prompts must not restate global engineering policy or skill semantics. They provide only invocation data, output schemas, tool/side-effect boundaries, or contracts for genuinely internal roles.
- A reusable semantic role belongs in a skill. Deterministic sequencing, retries, polling, Git/GitHub mechanics, and independent verification belong in code.
- Task contracts must not contain workflow policy or generic engineering philosophy.
- Project `AGENTS.md` files may add repository facts/conventions, but must not redefine workflow lifecycle or role outputs.
- If two active instructions disagree, fix the instruction sources. Do not add precedence prose that asks the model to choose between contradictory rules.

## Workflow boundaries

- `dev-spec`, `dev-plan`, `dev-implement`, `dev-prepare`, and `dev-review` are semantic skills.
- `/dev-build` is a deterministic controller that dispatches `dev-implement`; implementation behavior lives in the skill.
- `/dev-ship` is a deterministic controller. Its conflict resolver and PR finalizer are narrow internal roles. Its machine Reviewer reuses `dev-review` semantics and adds only a structured-output contract.
- Models never own workflow phase, retries, polling, checkpoints, GitHub waiting, or acceptance of their own claims.

## Change checklist

When changing agent instructions:

1. Identify the owning layer.
2. Search all other active instruction sources for overlap or contradiction.
3. Delete duplicated wording instead of trying to keep copies synchronized.
4. Keep skills compact by removing inherited guidance, not semantic requirements.
5. Add/update regression checks for important ownership boundaries and role semantics.
