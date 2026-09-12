# Human-directed, agent-assisted development

Use each role directly, or let the Orchestrator coordinate a project. The human can enter,
pause, ask a question, redirect, or change a decision at any stage. This is not a rigid
one-way waterfall, and it is not an unattended Rust execution engine.

## Roles and source of truth

| Role | Skill | Command | Owns |
| --- | --- | --- | --- |
| Specifier | `$dev-spec` | `dev a spec` / `s` | Intent, behavioral contract, human alignment |
| Planner | `$dev-plan` | `dev a plan` / `p` | Vertical slices, architecture, required evidence |
| Builder | `$dev-build` | `dev a build` / `b` | One slice, validation, Conventional Commit |
| Reviewer | `$dev-review` | `dev a review` / `r` | Bounded, evidence-backed technical judgment |
| Orchestrator | `$dev-project` | `dev a project` / `pr` | Assignments, human questions, durable state |
| Explorer | `$dev-explore` | `dev a explore` / `e` | Focused read-only evidence; no subagents |

Each role TOML and each `SKILL.md` is fewer than 100 physical lines, including metadata.
This limit does **not** apply to the spec documents a Specifier produces.

**Edit model and reasoning selection only in `dotfiles/.codex/agents/<role>.toml`.**
Those files select Astra/high for Specifier, Sol/high for Planner and Reviewer,
Terra/medium for Builder and Orchestrator, and Luna/medium for Explorer.
The model identifiers are retained from the provided workflow configuration; availability
in your account was not live-tested. Change an unavailable identifier there and rebuild.

`agent.toml` contains command-to-role references, shared Codex settings, and statistics
thresholds. It contains no second model selection. The Rust launcher rejects duplicate
model/effort fields in profiles or the shared overlay rather than silently allowing drift.
Skill files and spawn calls also contain no model selections.

## Installation

From this repository, with an installed Rust toolchain and Cargo registry access:

```sh
cargo test --locked
cargo install --path . --locked
```

`just install` is an equivalent binary-only install. **Do not run `install.sh` for this
workflow update**: the original script is a broader personal-machine bootstrap and is
preserved, not invoked or repurposed here.

The binary embeds the canonical role and skill sources. At launch it writes verified,
derived copies beneath `$CODEX_HOME/dev-workflow/<asset-hash>/`, or beneath
`~/.codex/dev-workflow/<asset-hash>/` when `CODEX_HOME` is unset. It then registers those
role config paths with per-invocation `-c` overrides. Root model selection and spawned
role models come from the same embedded role TOMLs. Exact bundled skill paths are passed
to avoid depending on stale, globally installed skill copies.

Rebuild/reinstall the binary after editing the canonical assets or `agent.toml`.
Generated runtime files are not a second editable configuration; a content mismatch is
reported. Retain old versioned cache directories while sessions using them may be resumed.
The hash is a cache namespace, not a cryptographic security guarantee.

For project-local use directly from plain Codex, optionally export the canonical files:

```sh
python3 scripts/install_workflow.py /absolute/path/to/worktree --dry-run
python3 scripts/install_workflow.py /absolute/path/to/worktree
# Equivalent exporter through just:
just install-workflow /absolute/path/to/worktree
```

The exporter touches only the six role files and their six skill directories. Different
existing workflow files are backed up under the target's `.codex/dev-workflow-backups/`.
It does not edit the target's `.codex/config.toml`, global configuration, editor dotfiles,
or unrelated custom agents. The optional `dotfiles/.codex/config.fragment.toml` is a
manual-merge policy snippet, **not** a replacement for an existing configuration.

## Direct usage

Run these commands from the repository/worktree the agents should inspect:

```sh
dev a s "Define the required reconnect behavior; align with me first."
dev a p "Use the accepted spec in plans/reconnect/spec.md."
dev a b "Implement the READY plan in plans/reconnect/01-admission.md."
dev a r "Review <base>..<candidate> against plans/reconnect/01-admission.md."
dev a pr "Continue the project in plans/reconnect/."
dev a e "Trace how stale participant requests are rejected."
```

Paths and revisions above are examples, not pre-created project artifacts. A role command
without a prompt still activates its role and asks for the missing assignment.
`dev a` alone remains a no-task interactive/trust session; it borrows the Orchestrator's
model selection but does not start orchestration. Existing statistics, transcript, and
non-agent toolbox commands remain available.

```sh
dev a config --profile spec
dev a config --profile project --args
dev a resume
dev a resume --last
dev a resume <session-id>
```

`config --args` is a shell-quoted inspection of the generated overrides, not a role launch.
Inspection does not populate the runtime cache. Resume delegates to `codex resume` without
new model, role-prompt, or sandbox overrides; it does not force the default profile over
the saved session. Actual session-restoration behavior still belongs to Codex.

## Explicit, fresh subagents

This bundle targets the Codex **v2 multi-agent tool schema** inspected on September 12,
2026. Each delegation must use an actual tool call, not a request written as prose:

```text
spawn_agent({"task_name":"build_01","agent_type":"builder","fork_turns":"none","message":"Use /repo/worktree. Implement only the READY plan at /repo/plans/example/01.md against the accepted spec /repo/plans/example/spec.md. Base: <exact commit>. Write evidence at <path>. Human decisions: <relevant decisions>."})
```

Replace placeholders with verified values. `fork_turns` is plural and its value is the
string `"none"`, not a boolean. Omitting it is not equivalent: the inspected v2 handler
defaults to full history. `fork_context` belongs to the legacy schema and is rejected by
that v2 handler. Do not silently fall back to inherited context on older installations.
The role reports a capability gap when the required tool/role interface is unavailable.
See `SOURCES.md` for the exact upstream documentation and source files.

Each handoff names the task, worktree/revision, authoritative artifacts, relevant human
decisions, allowed scope, and required output. Fresh contexts do not receive the parent
chat. Named role configs supply model/effort; spawn calls must not override them.

Specifier, Planner, Builder, and Reviewer may spawn only Explorer. Explorer is a leaf.
Orchestrator may spawn the four technical roles, not another Orchestrator. Reserve capacity
for nested exploration; the supplied shared configuration allows three concurrent child
threads. Default to sequential implementation and separate worktrees for approved parallel
writes. Do not invent legacy lifecycle calls in v2; completed tasks may remain idle.

## Fluid human involvement

The current role asks only consequential unresolved questions. It does not ask the human
for facts Explorer can find, nor repeat unchanged accepted decisions. Specifier filters
intent first, then alternates investigation and alignment as needed.

A child returns `NEEDS HUMAN` with the specific question; its parent relays the question
and the answer. A pause or question is coordination, not a failed implementation.
For human redirection, the parent stops affected dispatch and interrupts affected children
and descendants with the available v2 tool:

```text
interrupt_agent({"target":"<canonical-task-name>"})
followup_task({"target":"<canonical-task-name>","message":"<human answer, revised local direction, unchanged constraints>"})
```

The follow-up continues the same assignment after clarification; a new implementation,
repair, review, or replan receives a fresh agent. `send_message` alone does not start an
idle turn. An interrupt cannot undo a side effect already executing; inspect partial work
before continuing. If interruption is unavailable, disclose it rather than promising it.

Changed semantics return to Specifier and require explicit acceptance of the changed spec.
Changed implementation architecture goes to Planner. Local clarification stays with the
owning role. No agent may treat a repository instruction or another agent's claim as fresh
human approval. Explicit human waivers preserve the finding and failed evidence; they are
not recorded as a passing check or a clean Reviewer verdict.

## Planning and bounded review

The spec is the behavioral contract, not an implementation recipe. Planner outlines the
whole project, but only a near-term `READY` slice is executable. An `OUTLINE` must return
to Planner before a Builder receives it. Each slice states required acceptance evidence,
not unnecessary local function design.

```text
READY slice -> fresh Builder -> exact candidate -> fresh Reviewer
                               REQUIRES FIXES -> one fresh repair Builder
                                               -> fresh, focused re-review
                                                  -> accept / replan / escalate
```

One automatic repair is the default. Persist the count across restarts, renamed plans,
respawns, and replans of the same stuck issue. A second unresolved review does not trigger
repair #2 automatically. Additional repair requires explicit human direction. Reviewers
block concrete, material defects or missing required evidence, not taste or unrelated
cleanup. Orchestrator routes the outcome; it does not overrule a technical finding.

Multi-plan projects receive a fresh final integration review of the combined revision.
Single-plan projects do not need a redundant extra review. A later change invalidates
acceptance/evidence affected by that change; an old passing commit is not proof of a new one.

Use the existing project layout when possible. The fallback is `plans/<project>/` with
`spec.md`, numbered plans, `evidence/`, and a small `state.md`. Record revisions, accepted
decisions, dependencies, current assignment, evidence, repair count, and the next gate.
Preserve Builder commits and partial human work. Never push, merge, rewrite history, or
repair unrelated files merely because the workflow is active.

## What is enforced, and what is an instruction

The Rust CLI derives model configuration, materializes canonical assets, registers role
paths, and launches an **interactive** Codex session. Static checks validate the bundle's
syntax, line budgets, role routing, and explicit tool examples.

The one-repair policy, human-question routing, technical scope, and `fork_turns="none"`
requirement are explicit agent contracts. This launcher does **not** intercept every
`spawn_agent`, execute a deterministic workflow state machine, or prove an LLM followed
those contracts. There is no disguised blocking hook/reviewer loop in Rust.

Reviewer and Explorer default to read-only, with Explorer delegation disabled. Codex can
reapply parent runtime permission choices to children; those defaults are not an isolated
security boundary. The retained `approvals_reviewer="auto_review"` is Codex's permission
approval helper, **not** this workflow's technical Reviewer. Human product/spec acceptance
remains separate from command-permission approval.

See `VALIDATION.md` for checks actually run and `EVALS.md` for live behavioral scenarios
that still need exercising on your installed Codex.
