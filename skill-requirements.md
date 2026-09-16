# Workflow requirements

Bundle invariants, not another worker prompt. WORKFLOW.md explains the procedure; the five bundled skills are its executable role contracts.

- Exactly five public skills: dev-spec, dev-plan, dev-build, dev-review, dev-project.
- One Reviewer persona always; it covers requirements and engineering quality. Final review and capability escalation use the same persona, not an extra routine seat.
- Fresh isolated task agents with explicit `fork_turns="none"`. Builder remains warm only within its task. Each real scoped rereview is fresh; clarification resumes its owner without creating a review round.
- Human approves semantics; Planner autonomously resolves execution under them. Explicit bounded inline human answers may be recorded clerically by the controller; no silent semantic decisions.
- One controller owns execution state, not engineering judgment. It routes references and exact findings, preserves a compact recovery ledger, and uses deterministic helpers for mechanical invariants.
- Only plans/<project>/{spec.md,plan.md,progress.md,work/}, all ignored; single-writer authority and Git/user-state preservation. Work reports are not committed.
- Planner creates decision-complete, independently reviewable tasks. Binding acceptance/contracts are distinguished from local implementation guidance. No microtask ceremony or complete duplicate implementation in plans.
- Builder uses meaningful TDD, focused prescribed validation, one self-review and stable local commits. No fake RED, test weakening or opportunistic scope expansion.
- Review is candidate/contract-bound. Critical/Important findings have concrete failure, impact and resolution evidence. Minor findings never enter repair packets. Unrelated old defects do not become task work.
- One combined repair packet, exact finding bodies, stable IDs. Fresh scoped review verifies old IDs and causal regressions, including unchanged callers. Serious late discoveries remain explicit blockers, never automatically demoted.
- One ordinary repair; at most one justified exceptional second reviewed repair after changed input/capability. No blind third attempt, no counter resets, no real-blocker waiver. Clarifications do not consume rounds.
- Full-project validation then one strongest fresh final review; one integrated final fix wave at most. Real residual blockers mean incomplete.
- Explorer is a TOML-only read-only factual leaf, available when its compact answer saves substantial unrelated context. It cannot plan, review, implement, accept, or spawn.
- Model/effort selection belongs only to role configuration, never dynamic rankings in skill policy. Treat the configured baseline as an experiment, not proved optimal.
- Validators check format, provenance, immutable candidates and files. They cannot prove correctness, judge causality, decide semantic scope or certify live agent behavior.
- Preserve approvals, permission boundaries, cancellation state, user changes and accepted work. No automatic merge/push/rebase/worktree management.
- Local testing via Justfile only. No CI or automatic live paid model runs. Rules need concrete regression scenarios, not ever-growing defensive boilerplate.
