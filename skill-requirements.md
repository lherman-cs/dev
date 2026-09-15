# Workflow requirements

This file records non-negotiable bundle invariants, not a second workflow prompt.

- Exactly five public skills: `dev-spec`, `dev-plan`, `dev-build`, `dev-review`, `dev-project`.
- Explorer is a TOML-only read-only leaf; every public role may spawn it with explicit `fork_turns="none"`.
- New Planner/Builder/Reviewer agents are isolated; only the active Builder is resumed for clarification/repair.
- Human explicitly approves semantic specs. Planner is autonomous under approved semantics.
- `./plans/<project>/spec.md`, `plan.md`, `progress.md`, `work/` are the only project workflow layout; they are expected to be git-ignored.
- Specifier, Planner, Orchestrator, Builder, Reviewer have single-writer artifact ownership.
- Planner produces one current execution-grade `plan.md`; tasks use `### Task N:` boundaries and carry their relevant semantic requirements.
- Builder uses RED -> GREEN -> REFACTOR when meaningful, then prescribed validation, self-review, and a local commit. TDD exceptions must be concrete and honest.
- Task execution is sequentially gated. Every candidate receives parallel fresh Spec and Quality reviews.
- Critical/Important findings block; Minor findings never block. Unrelated pre-existing problems cannot enter the task repair loop.
- All current blockers are fixed in one repair wave by the same warm Builder. Fresh scoped re-review checks only prior blockers and repair-introduced breakage.
- Maximum three reviewed task repair rounds; never an automatic fourth.
- Full-project validation runs once after task acceptance and again after any final fix.
- One strongest fresh final review; at most one automatic final fix wave and one scoped final re-review.
- Orchestrator never writes production code or spec, performs technical review, or manages merge/rebase/push/worktrees.
- Model names/reasoning efforts exist only in `.codex/agents/*.toml`; skills encode authority, not model rankings.
- Capability escalation is configured via stronger agent types and used only after a concrete reasoning blocker.
- Mechanical packaging/state checks belong in deterministic helpers; semantic/technical judgment remains with agents.
- `progress.md` is compact controller-owned recovery state, not a transcript. Detailed `work/` artifacts are deleted only after successful completion.
- Pressure-test the behavioral contracts; add rules only to close observed loopholes rather than accumulating defensive prose.
