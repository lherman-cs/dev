# Design sources and adaptations

These are human references, not additional worker routers or mandatory skills to load.

- [agent-skills orchestration patterns](https://github.com/addyosmani/agent-skills/blob/main/references/orchestration-patterns.md): avoid routing/paraphrasing layers; isolate research when a small digest saves a large unrelated working set. We retain autonomous coordination rather than its human-driven sequential lifecycle.
- [agent-skills context engineering](https://github.com/addyosmani/agent-skills/blob/main/skills/context-engineering/SKILL.md): curated task context, durable boundaries and preserved constraints. No universal context-token threshold is treated as a correctness guarantee.
- [agent-skills code review](https://github.com/addyosmani/agent-skills/blob/main/skills/code-review-and-quality/SKILL.md): explicit quality bar, material improvements over perfection, actionable evidence and optional versus required findings. We do not import its entire broad checklist into every task.
- [agent-skills planning](https://github.com/addyosmani/agent-skills/blob/main/skills/planning-and-task-breakdown/SKILL.md): coherent verifiable slices and acceptance criteria. File-count heuristics do not override behavioral task boundaries.
- [Superpowers subagent-driven development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md): isolated task workers, stable review packages, compact file handoffs, durable recovery and bounded scoped review. We use one ordinary repair plus one justified exceptional repair, not its larger retry budget or controller technical adjudication.
- [Superpowers planning](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md): explicit cross-task contracts and tasks worth a review gate. We plan consequential decisions rather than require complete implementation code in every plan.
- [Superpowers scoped rereview](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/re-review-prompt.md): verify identified defects and repair regressions, not a fresh broad audit. We explicitly retain serious late discoveries for routing instead of mechanically downgrading them.
- [Codex subagents](https://developers.openai.com/codex/subagents): role configuration and context isolation. Actual installed runtime tools/config support remain authoritative; no helper claims to validate live model availability.

The user discussion and current repository authority/permission contracts determine the adaptations. Upstream measured costs, model rankings or defect rates are not transferred into claims about this repository. Concrete models/efforts have one editable source: dotfiles/.codex/agents/*.toml.
