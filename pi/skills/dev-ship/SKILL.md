---
name: dev-ship
description: Own technical preparation and coordinate a candidate to a review-ready GitHub pull request without merging.
disable-model-invocation: true
---

# dev-ship

Read `../references/reconcile.md` at entry. As sole writing owner of this worktree, reconstruct the requested outcome and remaining work from Git, repository conventions, applicable artifacts, and GitHub. A prior spec, plan, build handoff, Builder, or Reviewer result is not required. Report the current candidate, outstanding proof and next action.

- **Identify candidate and scope.** Read the request, any applicable approved spec/plan, diff/history, local proof, Git and GitHub. Derive missing semantics when evidence suffices; ask only when consequential scope, ownership, product semantics or authority remains unresolved. Before consequential writes, verify worktree, branch/HEAD, tracking HEAD, base OID and matching PRs. Missing artifacts do not block progress.
- **Choose base.** Preserve a matching PR's valid base; otherwise prefer an explicit valid human base over the remote default. Verify it exists and is not the head. Explain unambiguous self-base correction; ask on conflicting targets, multiple plausible PRs or unrelated committed work. Never revert a ready PR to draft.
- **Prepare and publish.** Own repairs, coherent commits, affected local proof, fetch/rebase, push and PR writes. Resolve ordinary rebase conflicts against the request and code evidence, then rerun affected proof. Ask only about consequential ambiguity. Published rewrites need exact `--force-with-lease` against an unchanged observed remote head, with no independent work overwritten; destructive independent history/remote recovery needs explicit authority. Observe the result of any uncertain write before retrying, including a failed commit, push or PR creation. Diagnose authentication and policy failures; ask for access only when required authority remains unavailable.
- **Verify published HEAD.** Discover required CI from protection, rulesets and repository evidence; unknown policy is a gap. Match checks and expected feedback to the published HEAD. Wait boundedly, refresh, diagnose failures and repair; incomplete, interrupted, failed or stale evidence cannot pass. An optional independent read-only `review` supplies evidence against an exact candidate, not permission to proceed. If it is missing, failed or stale, inspect and verify the candidate yourself or obtain fresh review if required by repository policy. Do not weaken checks or repeat nonproductive repairs without changing approach.
- **Complete readiness.** Verify the PR/head/base, scope, changes, local proof, required CI, feedback and residual risks. When the request or applicable policy reserves readiness to a human, present this exact packet through `ask_user_question`; refresh afterward and renew approval if material evidence changed. Otherwise make the authorized readiness transition yourself. Reobserve the live ready state before claiming success. Never merge in dev-ship; merging is a separate authorized action.

On cancellation or unavailable external evidence, state what remains and the normal resume action. Attempted writes are not success; completed remote effects are not rolled back. No other agent is responsible for reaching this terminal state.
