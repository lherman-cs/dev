# Development workflow

This bundle implements a Superpowers-inspired, context-efficient development workflow for Codex while preserving five public skills:

- `dev-spec` — human-facing semantic design and approval
- `dev-plan` — execution-grade planning/replanning
- `dev-build` — one bounded implementation/repair with TDD
- `dev-review` — bounded candidate/final review
- `dev-project` — recovery-first orchestration

Explorer is intentionally **not** a public skill. It is a cheap read-only leaf agent that any public role may spawn for one narrow factual question.

## Upstream and adaptation rule

Use [Superpowers](https://github.com/obra/superpowers) as the behavioral baseline; explicit questionnaire answers override its defaults. The local roles consolidate its procedures rather than adding new workflow phases:

- [Brainstorming](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md) -> `dev-spec`: human dialogue, alternatives, section alignment and approval; Q4–6/Q64/Q77 require a durable spec at every scale and a separate human-started execution phase.
- [Writing plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md) -> `dev-plan`: complete actionable tasks, verified interfaces, meaningful test cycles and self-review; Q11/Q12/Q75 preserve execution-grade detail without a rigid universal task schema or human plan gate.
- [Subagent-driven development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md) -> `dev-project`: isolated handoffs, sequential acceptance, controller rulings and scoped repair; Q9/Q23/Q33/Q81 specify three repairs, two parallel reviewers, configured reactive escalation and operational splits.
- [Test-driven development](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md) and [systematic debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md) -> `dev-build`: meaningful RED/GREEN, root cause before fixes, Q31/Q41 scoped verification without routine reviewer reruns.
- [Verification before completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) -> final validation and evidence-backed handoff; Q15/Q32/Q52–53 retain one integrated final fix wave, and Q16 leaves Git integration to the human.

Do not import upstream defaults that conflict with these answers: no extra public skills, worktree automation, plan approval, five-round repair loop, or model names in skill policy. The human reviews the finished result after the final AI review; that handoff does not authorize integration.

## Core artifact model

Every project lives under a git-ignored directory:

```text
./plans/<project>/
├── spec.md       # semantic authority: DRAFT | APPROVED
├── plan.md       # execution authority: DRAFT | READY
├── progress.md   # small controller-owned recovery ledger
└── work/         # disposable task briefs/reports/review packages
```

Single writers:

- Specifier owns `spec.md`; during execution Orchestrator may record the exact bounded amendment explicitly approved by the human, without concurrent writers.
- Planner owns `plan.md`.
- Orchestrator owns `progress.md` and derived task/review packages.
- Builder writes repository changes/commits and assigned build reports.
- Reviewer writes only assigned review reports; repository source remains read-only by contract.
- Explorer creates no durable workflow artifacts.

`work/` is deleted only after successful project completion. The other three files remain as the compact local record.

## Human boundary

`dev-spec` is the human-facing design phase. It chooses the lightest sufficient path:

- Bounded — compact clarification/design
- Architectural — one-question-at-a-time alignment, alternatives/tradeoffs, section validation
- Spike — bounded experiment to resolve a concrete uncertainty, then return to design

Every path ends in `spec.md`. It remains `DRAFT` until the human explicitly approves it. Unapproved semantic revisions return the affected spec to DRAFT. A bounded amendment explicitly approved inline during execution may be recorded by Orchestrator with APPROVED retained; that answer is the approval.

After approval, `dev-spec` stops. The explicit command to execute is `dev a project ...` / `dev a pr ...`.

Human alignment is concentrated before that approval. For affected external contracts, resolve defaults, valid/rejected inputs, bounds/units, state transitions, failure behavior, and compatibility with concrete examples or exact contract references. “Reject invalid options” is not resolved if validity is undefined. Record implementation latitude only when actually approved. Do not reconfirm settled decisions or ask the human for discoverable repository facts.

## Planning

When `dev-project` sees an approved spec but no READY plan, it automatically spawns a fresh Planner. `dev-plan` may also be used directly.

Planner:

- requires `Status: APPROVED` in `spec.md`;
- plans from actual current repository state;
- writes one current `plan.md`, not plan-v1/plan-v2 files;
- uses execution-grade detail: verified files/interfaces, concrete implementation steps, test commands/expected outcomes, and code snippets where useful;
- carries applicable spec requirements directly into each task;
- uses natural Markdown with only one parser-stable convention: `### Task N: <name>`;
- chooses meaningful test/review units rather than artificial microtasks;
- batches trivial same-shape edits when they share one meaningful test/review surface;
- defines a baseline validation and one whole-project final validation;
- self-reviews before changing `Status: DRAFT` to `Status: READY`.

A material plan defect discovered later causes a fresh isolated Planner to rewrite the single `plan.md`. Human approval is not needed when semantics remain unchanged. Bounded semantic questions are answered inline and recorded by Orchestrator; substantial changes reopen affected sections through `dev-spec`.

Check semantic prerequisites before elaborating the plan, and walk the first task through a viable initial test/candidate before READY. Keep full execution-grade coverage; avoid source dumps, repeated workflow prose, and speculative implementation detail. During a material replan preserve unaffected task text. No new independent planning gate is introduced.

## Worktree and Git ownership

The human owns worktree/branch/integration lifecycle. The workflow never creates or deletes worktrees, merges, rebases, squashes, pushes, resets, cleans, or stashes.

Fresh project execution requires a clean tracked/index state. The controller records the starting SHA and runs the plan-defined baseline validation. Known unrelated baseline failures are recorded instead of becoming surprise project scope.

Builders create local commits:

```text
project base
└── task candidate
    └── repair 1
        └── repair 2
            └── repair 3
```

Every Builder commit follows Conventional Commits: `<type>[optional scope][!]: <description>`, with breaking changes marked by `!` or a `BREAKING CHANGE:` footer. This applies to task, repair, and direct-use commits.

A repair is always a new commit; reviewed commits are never amended by the workflow. The human may rewrite history later outside the workflow.

## Context isolation and packaging

Every **new** subagent starts with `fork_turns="none"`. No Builder/Reviewer/Planner inherits the controller's accumulated conversation.

The only intentionally warm child is the current Builder while answering a clarification or repairing that same task.

`dev-project` embeds deterministic helper files under its skill directory:

- `scripts/package_task.py` — extracts one planned task verbatim and appends only bounded execution metadata;
- `scripts/package_review.py` — creates the exact Git base..candidate review package;
- `scripts/validate_workflow.py` — checks clerical state/commit/report invariants without judging semantics;
- `prompts/*.md` — specialized dispatch contracts.

The controller passes paths and SHAs, not pasted plans/diffs/history.

Task briefs are immutable after dispatch. Repair instructions get new incremental repair briefs. Review packages are exact immutable Git ranges.

Read only the dispatch template needed now. Helpers write packages directly to files; controllers do not print full packages into their own context. Children return status, report path, SHA or blocker IDs rather than duplicating reports. Builders and task reviewers start with their bounded brief and owning code; historical reports and full project authorities require a specific missing fact. Final reviewers still receive whole-project context.

### Operational task splits

Size alone is `NEEDS_SPLIT`, not a material replan. The Builder identifies independent behavioral surfaces and a viable first candidate. The controller records unit IDs, coverage, ordering and shared interfaces in `progress.md`, leaving the Planner's text unchanged. Generate each incremental unit artifact with `package_task.py --scope` and a fresh output path; this preserves the original task text and appends assigned/deferred requirements and verification obligations.

Resume the current Builder for the first unit. Each subsequent meaningful unit gets a fresh Builder, and every unit passes the normal parallel spec/quality gate. Explicitly deferred sibling work cannot block the current unit. The parent task is accepted only after all units and integration obligations pass. Splitting cannot reset a consumed repair budget. Reuse baseline evidence at unchanged HEAD; do not repeat whole-plan preflight for a size-only split. Strategy/interface redesign still requires Planner.

## Task loop

Meaningful tasks are sequentially gated. Trivial same-shape work can be batched, but Builders do not run in parallel by default.

```text
fresh Builder
  ↓
TDD + task validation + Builder self-review + commit
  ↓
┌──────────────────────────────┐
│ fresh Spec Reviewer          │  parallel
│ fresh Quality Reviewer       │
└──────────────────────────────┘
  ↓
PASS/PASS → accept task → next task
  ↓ blockers
one combined repair wave using same warm Builder
  ↓ new repair commit
fresh scoped re-review(s) for affected dimension(s)
```

### Builder discipline

Normal implementation uses strict RED -> GREEN -> REFACTOR:

1. write smallest meaningful behavioral test;
2. run it and confirm the expected RED reason;
3. implement minimum coherent behavior;
4. confirm GREEN;
5. refactor while green;
6. run the task-prescribed package/integration validation;
7. self-review;
8. commit and write a compact report.

Generated artifacts, pure documentation, some configuration/mechanical work, and throwaway spikes may use an explicit TDD exception. The Builder must state why and run the strongest meaningful verification instead; fake RED tests are forbidden.

When debugging surprises, determine root cause before stacking patches. Several failed approaches should trigger context/capability/task-size/plan reconsideration rather than an infinite local patch loop.

### Review discipline

Two fresh reviewers inspect the same immutable candidate in parallel:

- Spec Reviewer — requirements, accepted invariants, compatibility, assigned interface behavior only.
- Quality Reviewer — concrete bugs/edge cases, technical architecture/maintainability within the changed surface, meaningful tests, safety/security when relevant.

Review like a senior engineer on a fast-moving startup team. Each blocker needs a reachable failure or explicit unmet criterion, evidence, material impact, and candidate responsibility. Request the smallest correct fix. Alternative designs, nonessential hardening, and optional tests cannot block. Builders implement the assignment and necessary correctness fixes; they may challenge a repair prescription with concrete counterevidence. Changes to shared helpers require checking their affected callers and real contracts.

Both use:

- Critical — blocking
- Important — blocking
- Minor — non-blocking/deferred

Reviewers normally trust Builder validation and do not rerun it. A small targeted check is allowed only to resolve a concrete doubt.

Unrelated pre-existing defects cannot block the task. Scoped re-review may evaluate only prior blocker IDs and breakage directly introduced by the repair.

Before each repair, the controller checks scope/evidence completeness, combines duplicate root causes, and sends unsupported or disputed findings back to the originating Reviewer for clarification. Clarification consumes no repair round; the controller does not replace technical review or overrule substantiated blockers. Optional suggestions do not become automatic repair or follow-up tasks. Final review uses the same threshold; an unfixed Minor needs concrete integrated impact to become blocking.

A denied Git write preserves the verified diff and becomes a specific permission blocker. Resolve that boundary once; never repeat the same denied action through another agent.

### Repair budget

One reviewed repair candidate consumes one round. Local debugging/editing before a reviewable repair does not consume additional rounds.

Maximum automatic task repair budget: **three rounds total**. There is no round four.

If a blocker survives the third scoped re-review, Orchestrator reaches a breaker and may:

- adjudicate a mistaken/out-of-scope/actually-Minor finding;
- use configured capability escalation for a demonstrated reasoning blocker;
- split an oversized task;
- invoke Planner for a material plan defect;
- ask a bounded semantic question inline, or reopen affected spec sections for substantial changes;
- surface a genuine unresolved blocker.

It may not overrule a real blocking finding before the breaker.

## Capability escalation and model policy

Skills contain **no model names**. The authoritative runtime model/effort policy lives in `.codex/agents/*.toml`; the table below only documents that policy for humans.

Current tuned roles:

| Agent type | Model / effort | Why |
| --- | --- | --- |
| `specifier` | GPT-6 Astra / medium | Highest-leverage semantic/design judgment; used infrequently, medium avoids defaulting every bounded spec to expensive deep reasoning. |
| `planner` | GPT-5.6 Sol / high | Precise execution-grade decomposition and interface reasoning. |
| `builder` | GPT-5.6 Terra / medium | Cost/performance default for repeated implementation work. |
| `builder_strong` | GPT-5.6 Sol / high | Explicit escalation only after a concrete Builder reasoning/debugging blocker. |
| `reviewer` | GPT-5.6 Sol / high | Independent adversarial task review needs stronger reasoning than routine building. |
| `reviewer_strong` | GPT-6 Astra / low | Final whole-project review / explicit review escalation only. |
| `orchestrator` | GPT-5.6 Terra / medium | Mostly deterministic routing/state work; stronger reasoning belongs to specialist roles. |
| `explorer` | GPT-5.6 Luna / medium | Cheap high-volume factual lookup; no judgment authority. |

`dev-project` does not know or rank model names. It sees configured agent types. Capability escalation is reactive, never “this task looks hard, spend more.” Missing context, ordinary test failure, or one review finding is not enough to escalate.

## Recovery and interruption

Every `dev-project` invocation begins by reconciling:

- `spec.md`
- `plan.md`
- `progress.md`
- relevant surviving `work/` artifacts
- actual Git HEAD/status and recorded SHAs
- actual resumable agent handles, if any

The ledger is a recovery hint, not unquestionable truth. A restarted controller never waits on a ghost child merely because the ledger says BUILD/REVIEW.

If restart finds uncommitted changes clearly attributable to the recorded active task, preserve and recover them. If ownership is ambiguous, stop and show the human the paths.

Explicit cancellation preserves commits, dirty work, ledger, and `work/`; it does not roll back Git automatically.

## `progress.md`

Only Orchestrator mutates the ledger. Keep it small:

```markdown
# Progress

## Status
Project base: abc123
Current task: 03
State: REVIEW
Current candidate: def456

## Tasks
- 01: ACCEPTED candidate=...
- 02: ACCEPTED candidate=...
- 03: REVIEW candidate=def456

## Rulings
- R1: ...

## Deferred
- M1: ...

## Active findings
- Q1 [Important] round=1 OPEN: ...

## Validation
- Baseline: ...
- Final: ...
```

Detailed Builder/Reviewer reasoning belongs in disposable `work/` reports, not the ledger.

## Full-project validation and final review

After all task gates are accepted:

1. run the plan-defined whole-project validation;
2. fix candidate-caused validation failures before review using the smallest responsible scope;
3. launch one fresh `reviewer_strong` with approved spec, READY plan, progress rulings/deferred Minors, full base..candidate diff, and validation evidence;
4. if it blocks, dispatch **one** fresh integrated Builder fix wave;
5. run focused verification and whole-project validation again;
6. launch one fresh scoped `reviewer_strong` re-review;
7. adjudicate residuals once. No second automatic final-fix wave.

Remaining genuine Critical/Important findings mean the project is not complete. Remaining genuine Minors do not block completion and are surfaced in the final report.

On success Orchestrator records final range/validation/rulings/deferred Minors and the final reviewer verdict, deletes `work/`, and hands off for human final review. The concise handoff links the spec and retained ledger, identifies the final range, summarizes validation and material residuals, and stops. Workflow completion does not assert human acceptance. It does not ask for or perform merge/PR/branch/worktree operations.

## Human-stop conditions

Normal workflow transitions never ask “continue?”. Stop only for a meaningful authority boundary such as:

- approved semantics must change;
- irreversible/destructive handling of pre-existing human work;
- security-sensitive/external permission;
- meaningful outside-worktree side effect requiring authorization;
- plan/spec contradiction so severe every path would be guessing.

Ordinary implementation ambiguity, review repair, moving to the next task, validation, or autonomous replanning with unchanged semantics are not human gates.

Before declaring a semantic stop, check the exact approved clause, established contract, and prior rulings. Make authorized reversible implementation rulings; do not invent external validation rules or product defaults. For a bounded semantic gap, ask one concrete inline question with a recommendation/tradeoff. The human's explicit answer authorizes the corresponding amendment to the owning spec/shared contract; Orchestrator records it with an approval note and retains APPROVED. Do not require a skill switch, manual edit, or repeated approval. Silence is not approval. Resume the same available Planner/Builder, update only affected planning/briefs and validation, and preserve settled decisions. Substantial changes to goals, architecture, or accepted work reopen only affected sections in DRAFT for `dev-spec` alignment. This exception supersedes the questionnaire's blanket semantic-stop/single-spec-writer rule at the human's request; it grants no authority to invent semantics.

## Direct role usage

The role skills are reusable outside `dev-project`:

```sh
dev a s "Define reconnect behavior; align with me first."
dev a p "Plan the approved spec at plans/reconnect/spec.md."
dev a b "Implement this bounded task."
dev a r "Review <base>..<candidate> for correctness."
dev a e "Trace where stale participant mappings are rejected."
dev a pr "Execute/resume plans/reconnect/."
```

Direct Builder normally commits verified work unless the human says not to. Direct Reviewer needs no `plans/` directory and returns its bounded findings directly. Explorer is a direct role command but not a public skill.

## Agent spawning

Fresh role assignments must explicitly use `fork_turns="none"`. Omitting it is unsafe because current Codex MultiAgentV2 defaults omitted `fork_turns` to a full-history fork in the documented implementation path.

Orchestrator may spawn Planner, Builder/Builder escalation, Reviewer/Reviewer escalation, and Explorer. It never spawns Specifier or another Orchestrator. Specifier/Planner/Builder/Reviewer may spawn only Explorer. Explorer cannot spawn children.

Task reviewers run in parallel; implementation tasks do not. `max_concurrent_threads_per_session = 4` allows the two task reviewers plus narrow nested Explorer use without encouraging parallel Builders.

## Installation

The Rust launcher embeds the role files, five public skill files, dispatch templates, and helper scripts into a versioned runtime cache. It does not rewrite the user's global Codex configuration.

```sh
python3 tests/validate_assets.py
python3 -m unittest discover -s tests -p 'test_*.py'
cargo test --locked
cargo build --locked
python3 tests/launcher_e2e.py --binary target/debug/dev
```

Optional workflow export into another worktree:

```sh
python3 scripts/install_workflow.py /path/to/worktree --dry-run
python3 scripts/install_workflow.py /path/to/worktree
```

The exporter backs up changed workflow assets and does not replace `.codex/config.toml` or unrelated roles/skills.

Upstream reference: [Superpowers](https://github.com/obra/superpowers). `tests/workflow_pressure_cases.yaml` is a behavioral scenario catalog; `tests/validate_assets.py` checks its structure, not agent compliance. Use isolated agent exercises for behavioral evidence and report their limitations separately from mechanical/launcher tests.
