# Minimal native workflow update

This update starts from the original `dev(2).zip`, retains native Codex agents and the existing command surface, and closes the agreed planning, convergence, and workflow-integrity gaps. It does not introduce a replacement scheduler, `project.json`, API integration, Python environment, or installation framework.

## What is retained

The original builder's implementation discipline is retained word-for-word: avoid unnecessary behavior, reuse existing mechanisms, prefer suitable standard/native/existing capabilities, and add only the necessary new code without sacrificing safeguards. Its detailed main-thread/explorer ownership rules are preserved in a mandatory `references/context.md`; the planner's original context policy is preserved there as well, with feasibility evidence and thread-budget clarifications. These reference files are required reading, not optional substitutes that remove the original rules.

All four SKILL.md entry files are at most 100 physical lines. The existing interview questions, repository handoff template, focused verification, Conventional Commits, and explorer delegation remain. The longer reusable context policy is separated from the task procedure rather than deleted to meet the line cap.

Models, reasoning effort, permissions, concurrency settings, `agent.toml`, Cargo dependencies, explorer configuration, unrelated dotfiles, and provisioning scripts are unchanged. A native planner role is added for the explicitly authorized maintenance task, using the existing planning profile's model and effort.

## Architecture and limits

`src/main.rs` still launches the native interactive Codex CLI. It adds synchronous lifecycle-hook configuration, a hidden `_workflow-hook` entry point, and preflight/exit checks for an explicit project invocation. The actual guard is one embedded Python standard-library file, `scripts/workflow_gate.py`. Python and Git must be installed; no pip installation is needed. Use Python 3.11 or later to run the complete test suite. The guard requires POSIX file locking; Linux is the primary target.

Native `PreToolUse` validates a supported assignment before dispatch and injects an opaque Attempt ID and plan Snapshot. `SubagentStart` and the native tool result identify the worker. `SubagentStop` validates that this worker produced this assignment's current handoff; malformed fields keep the same assignment open for correction. Native `Stop` rejects premature project completion and unsupported technical stops. The explicit project launcher also rejects an exit without an observed validated stop. The orchestrator does not have to remember to invoke a validator.

There is no model-call scheduler in the guard. The orchestrator chooses repairs, investigation, adjudication, conforming design changes, and worker replacement. The guard records identities and checks objective consistency; it does not judge whether evidence is true, tests are adequate, a design is better, or a recovery explanation establishes root cause.

The normal boundary is a trusted, enabled hook integration on a compatible Codex CLI. Hooks must be reviewed in `/hooks`; this update does not pass a hook-trust bypass flag or alter the sandbox/approval policy. Codex can skip untrusted, disabled, unsupported, or administratively excluded hooks. Some tool paths are not intercepted. Direct/manual actions, deliberate state edits, missing hook events, and dishonest evidence are not covered by a software-correctness guarantee. The outer exit check detects missing validated completion on explicit project runs, but does not retroactively prevent work performed with hooks disabled. A native `dev a resume` retains normal resume behavior and relies on the trusted Stop hook rather than a replacement resume supervisor.

The guard does not run project test/build commands outside Codex. A reviewer must actually execute/inspect final verification and record exact-revision evidence. The guard verifies the declared coverage, PASS fields, freshness, and reviewer/assignment identity, not the truth of an arbitrary PASS assertion. Final acceptance and software correctness remain independent engineering responsibilities.

## The fifteen decisions

| Choice | Implementation | Mechanical versus engineering boundary |
|---|---|---|
| 1B: binding contract, adaptable guidance | Binding spec; explicit nonbinding guidance in each plan; conforming fixes do not require replanning. | Snapshot/spec hashes protect approved documents; semantics remain reviewed. |
| 2B: technical-lead orchestrator | Narrow source/evidence inspection, design direction, investigation, recovery, independent adjudication. | Guard never routes implementation itself or accepts the lead's self-approval. |
| 3C: verified planning readiness | Toolchain/baseline/input/ownership checks, risk-proportional disposable probes, independent READINESS review. | Execution requires exact-snapshot readiness at the repository revision; reviewer judges feasibility evidence. |
| 4C: best-design review | Separate CORRECTNESS and DESIGN blockers, with concrete alternative, benefit, and replacement cost. | Finding fields/kinds required; quality is not reducible to a field check. |
| 5B: settle design | Preserve Decisions and IDs; new material evidence is necessary to reopen design. | Follow-up design blockers require a New evidence field; the lead/reviewer assesses it. |
| 6B: consequential batch grilling | Preserve original interview process; resolve behavior/ownership/lifecycle/failure decisions before finalizing plans. | No validator can prove every important question was asked; readiness challenge is independent. |
| 7B: verifiable outcomes | Small practical outcomes with integration/failure checks, explicit verified facts and predecessor outputs. | DAG and one-owner obligation coverage checked; plan/test adequacy independently reviewed. |
| 8B: active recovery, no round cutoff | Same failure triggers diagnosis and a discriminating check, then a changed approach; targeted adjudication and replacement available. | No iteration cap manufactures failure or acceptance; explanation quality remains judgment. |
| 9B: persistent plan pair | Retain builder/reviewer across repairs; same-revision rebuttals get new assignment IDs. | Worker identity, scope, role, previous OPEN IDs, and original baselines recorded. |
| 10A: sequential plans | Lowest-numbered ready incomplete plan; bounded explorers; one active build/review assignment. | Live-attempt and dependency gates apply within the worktree. |
| 11B: fresh final reviewer | Fresh FINAL worker; integrated checks; known failures go to exact owning plans. | All owners accepted, exact HEAD/snapshot, clean tree, current final handoff and check rows required. |
| 12B: validator | One standard-library gate and small Markdown identity/coverage conventions. | Implemented in code and behavior-tested against real temporary Git repositories. |
| 13B: separate execution | Planning may grill and finish READY; only a separate explicit project invocation approves execution. | Session phase is retained on native resume; old READY evidence cannot end execution. |
| 14B: checked maintenance | Proposal directory, immutable spec/accepted plans, old/new obligation and finding maps, independent MAINTENANCE review. | Exact proposal and mapping hashes checked before activation; pending work carried to new owners. |
| 15B: runner-integrated enforcement | Native lifecycle hooks plus explicit-project preflight/exit checks. | Not an optional agent command; requires compatible trusted hooks, with the limits stated above. |

## Existing commands and setup

Existing command names and aliases remain. The workspace-wide `dev exec` command is untouched. No-prompt interactive commands and native `dev a resume` retain their model/profile semantics. A project run still uses the existing positional prompt, but must name one exact existing project directory under `plans/`, as required by the skill.

From the source checkout:

```sh
just workflow-test   # Python behavior and asset tests; no Rust or model call
just fmt             # Explicit formatting, not hidden mutation inside validation
just verify          # Workflow tests, formatting check, Cargo check, Cargo tests
just build
just install         # Binary only; no machine provisioning or agent deployment
```

Without Just, run the recipes' ordinary Python/Cargo commands. Install the changed skill directories (including references) and builder/reviewer/planner role TOMLs using the existing dotfile deployment process. Rebuild `dev` when changing the embedded guard. Do not run the machine-provisioning install.sh just to apply this patch.

Start `dev a plan <request>`. Open `/hooks` and review/trust the `dev agent _workflow-hook` handlers. Normal planning must produce an independently accepted READINESS handoff before READY. Review the package, then separately invoke:

```sh
dev a project plans/<project>
```

That explicit invocation approves the exact reviewed snapshot. It does not grant permission to change binding commitments later. Do not launch it on a user's behalf before their approval. Ordinary repairs proceed without additional user confirmation. A binding change returns to planning/readiness and a new explicit execution invocation.

Before using the update on a costly project, validate the installed native adapter on a disposable Git repository: check that `/hooks` lists and trusts the handlers, observe an injected Attempt/Snapshot on a real reviewer assignment, verify an intentionally stale handoff is blocked and corrected in the same worker, and observe final completion rejection before a final review. This is an installed-runtime compatibility check, not a promised test result from the authoring environment.

## Handoffs, state, and migration

The shared skill reference `dotfiles/.agents/skills/dev-project/references/handoffs.md` documents the exact fields and tables. Existing Markdown plans/build/review files remain. Add stable `- [O1]` obligation IDs to spec/owning plan Acceptance sections, exact dependency paths, and a documented final-command list. Do not create a project manifest or duplicate the contract in JSON.

The hook creates `plans/<project>/.workflow.json` as its mechanical journal, plus a per-worktree advisory lock under `plans/`. `project.progress.md` is the lead's compact engineering handoff: settled decisions, OPEN IDs, failed approaches, worker identities, and next action. Both remain ignored workflow state. Never edit the journal to mark work accepted or discard an active worker.

For an existing project, adapt its documents without changing approved behavior, preserve all source commits and old handoffs, then obtain independent readiness. The first explicit execution can import unambiguous historical plan/build/review acceptance when the exact commit remains reachable. This does not bypass final integration review. Existing unfinished code is retained; establish a current build/evidence handoff rather than resetting or rebuilding accepted plans.

A wait timeout is not failure. When an actual worker is stuck or interrupted, resume its coordinator with `dev a resume`, inspect the recorded/native worker, and observe a successful native interrupt/close before replacing it. Unknown or failed interruption responses do not unlock concurrent work. A missing runtime capability is a recoverable external limitation, not a reason to falsify a plan verdict.

Maintenance stays under `.proposal/` until independent acceptance. Activating the exact reviewed files carries pending finding IDs to their new owners and preserves original evidence. A new reviewer cannot silently drop old findings, including after a plan rename or a same-revision repair.

## Final validator correction

This package supersedes `dev-minimal-complete.zip` with a narrow verdict/finding fix. `BLOCKED` and `REQUIRES REPLANNING` reviews may preserve OPEN findings instead of being forced to misstate their verdict or close unfinished work. `ACCEPTED` still forbids OPEN findings; `CHANGES REQUIRED` still requires at least one. Prior finding IDs, boundary evidence, and independent adjudication remain required.

The eight added regression tests cover blocked/replanning review recovery through final completion, finding preservation, missing boundary evidence, independent stop validation, readiness recovery, final-owner repair, and the unchanged acceptance rules. The original 64 tests passed; the expanded suite reproduced the defect before the fix and all 72 tests pass afterward. These are local Python tests, not a live Codex or Rust execution.

All four skill entry files, agent configurations, `src/main.rs`, Cargo files, existing commands, and the `justfile` remain byte-identical to the previous minimal package. The only changes are the validator, its tests, three explanatory lines in the shared handoff reference, and release documentation/validation metadata.

## Validation status

`tests/test_workflow.py` exercises actual guard functions and stdin/stdout hook payloads with real temporary Git repositories. It does not invoke a model or simulate success in a compiled replacement runner. `tests/test_assets.py` checks line budgets, required references, TOML/model coherence, Python syntax, embedded gate wiring, resume semantics, and the simple justfile.

See `VALIDATION.json` for the measured test count, preservation comparison, and precise unexecuted checks. Rust/Cargo/rustfmt, Just, and Codex were unavailable in the authoring environment. The Rust glue, native hook installation, and live-agent workflow therefore remain uncompiled/unexercised here. No claim of measured throughput, guaranteed convergence, or highest possible code quality is made.

## Primary implementation references

Sources checked during this revision; live documentation and main branches may change.

- OpenAI, Hooks: https://learn.chatgpt.com/docs/hooks — native interception, rewrite/continuation shapes, layered hook configuration, trust, and coverage limits.
- OpenAI, native multi-agent tool schemas: https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs — per-version spawn identities, fresh contexts, turn-starting continuation, and interruption semantics.
- OpenAI, local tool hook adapter: https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/registry.rs — hook-facing arguments and model-facing response payloads.
- OpenAI, custom subagents: https://learn.chatgpt.com/docs/agent-configuration/subagents — native role files and inherited configuration.

The workflow/quality policies above implement the agreed decisions. These sources establish integration interfaces; they do not demonstrate that this exact workflow is an experimentally optimal policy.
