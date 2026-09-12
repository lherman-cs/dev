# Workflow requirements

The authoritative contracts are the six role TOMLs under `dotfiles/.codex/agents/` and
six skills under `dotfiles/.agents/skills/`. `WORKFLOW.md` explains operation. This file
supersedes the old direct-only workflow rules; it is not a second set of role prompts.

- Keep every role TOML and every `SKILL.md` strictly under 100 physical lines.
- Keep produced specifications human-readable; no arbitrary spec-document line limit.
- Separate Specifier, Planner, Builder, Reviewer, Orchestrator, and leaf Explorer authority.
- Align consequential intent early; use Explorer for facts, not substitute human decisions.
- Permit human questions, pauses, clarification, and redirection at any stage.
- Accept changed spec semantics explicitly; never infer approval from silence or a child.
- Every real delegation uses a named `agent_type` and explicit `fork_turns: "none"`.
- New role assignments use fresh agents and bounded, artifact-based handoffs.
- Keep model/effort policy only in canonical role TOMLs; derive launcher configuration.
- Plan vertical slices; execute READY plans, never future OUTLINEs.
- Builder implements minimally, applies the expanded simplicity ladder, validates, and commits.
- Reviewer is adversarial within a bounded scope and reports concrete material blockers.
- Allow one automatic repair/re-review, then replan or escalate; persist the budget.
- Orchestrator controls workflow, not code/design/technical dispute arbitration.
- Integration review checks the exact combined result of multi-plan work.
- Preserve unrelated user work, original toolbox commands, and global configuration.
- Distinguish contract instructions, static validation, compiled tests, and live agent evidence.
