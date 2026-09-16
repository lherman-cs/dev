# Workflow decisions — optimized revision

This decision record supersedes the previous questionnaire's conflicting answers. It is for humans, not loaded into worker context. The implementation is in the five skills; WORKFLOW.md is the consolidated guide. The original questionnaire remains available [in Git history](https://github.com/lherman-cs/dev/blob/82fdc8887ef9616a55fcc164aa09f38720b21429/workflow-questionnaire.md).

## Changes approved through the optimization discussion

| Earlier decision | Current decision |
|---|---|
| Q23: parallel Spec and Quality reviewers on every task | One fresh Reviewer persona covering both dimensions, always. No risk-based second seat. |
| Q9/Q10: three reviewed repairs before a breaker/adjudication | One ordinary repair. After failure, change context/capability/plan as evidence warrants. At most one justified exceptional second repair; genuine blockers never become acceptable because a cap was hit. Clarify unsupported/disputed findings with the owner before pointless repair. |
| Q11: heavy execution-grade planning | Decision-complete planning: binding requirements, interfaces, proof strategy, verified entry points and uncertainty. Leave ordinary code mechanics to Builder; no mandatory second implementation written in the plan. |
| Q19/Q93: meaningful task boundaries and trivial batching | Retained. Each task must justify one Builder and one independent review. Include necessary setup/config/tests with the coherent behavior. |
| Q29/Q44/Q45: bounded file handoffs and reports | Strengthened: paths/SHAs/tiny status envelopes. JSON review reports bind candidate, base, mode and immutable contract digest. Exact blockers become repair packets mechanically, without controller paraphrase. Build evidence stays concise Markdown. |
| Q36/Q55/Q68: warm task Builder and fresh rereviewers | Retained, now with one reviewer. Warmth ends at task acceptance. Report clarification may resume its owner; rereview of a changed candidate is fresh. |
| Q7/Q83: small controller rulings and bounded inspection | Controller owns mechanics and exception routing, never another technical review. Builder owns local code judgment; Reviewer correctness; Planner material plan changes; human semantics. |
| Q14/Q42: candidate-scoped and repair-scoped blockers | Retained with explicit causal scope. A repair can break an unchanged caller. A serious original-candidate miss found late is labeled and routed, not silently demoted to Minor. |
| Q15/Q51/Q52/Q53: strongest final look and one fix wave | Retained. Same Reviewer persona, integrated assignment, fresh context, full-project validation first. Not a replay of every historical task review. |
| Q33/Q102: model selection outside skills | Retained. Concrete baseline updated in role TOMLs only. Evaluate accepted-task cost/latency and missed defects before asserting an optimum. |
| Q54: mechanical helper scripts | Retained; no large new workflow engine, daemon, tracker or state manifest. |
| Q56: pressure testing | Local deterministic tests plus explicit manual behavioral scenarios. No CI and no default paid model calls. |

## Retained boundaries

Exactly five public skills and a factual read-only Explorer leaf. Human-approved spec; no separate human plan approval. Sequential task gates. Stable task/repair commits, never amend reviewed candidates. Fresh children never inherit controller history. Approved artifacts plus Git truth provide recovery. All plans/ content ignored; single-writer ownership; success-only work/ cleanup. No automatic Git integration, worktree management, rejected-permission bypass, or discard of user work. Cancellation preserves state.

The repository's later bounded inline-approval procedure is retained: an explicit human decision can be recorded in the owning spec clause and affected work resumed without a redundant skill switch/approval. This is not authority to invent semantics. Substantial unresolved changes reopen only affected sections.

## Acceptance of this revision

The controller remains; its default path is coordination, not another engineering role. One Reviewer replaces two perspectives-as-separate-agents. Planning removes expensive ambiguity without dictating every edit. Repair loops require observable progress and a changed input when stuck. Mechanical checks cannot approve a bug or hide a serious miss. Local Justfile checks are the supported verification entry points.

Token/cost/time improvements are hypotheses until measured on representative live runs with quality checks. Fewer findings alone is not success.
