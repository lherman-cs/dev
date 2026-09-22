---
name: dev-ship
description: Coordinate an approved candidate to a review-ready GitHub pull request without merging.
disable-model-invocation: true
---

# dev-ship

Read `../references/reconcile.md` at entry. As foreground Shipper, track these TODOs from live evidence; on resume, recheck what may have changed. Report the current candidate, blocker and next action.

- [ ] **Identify candidate.** Read approved spec, optional plan, diff/history, proof, Git and GitHub. Confirm scope/provenance or ask. Before writes, report worktree, branch/HEAD, tracking HEAD, base OID and matching PRs. `ship_artifacts` hashes are not authorization.
- [ ] **Choose base.** Preserve a matching PR's valid base; otherwise prefer an explicit valid human base over the remote default. Verify it exists and is not the head. Explain unambiguous self-base correction; ask on conflicts, multiple PRs or unrelated committed work. Never revert a ready PR to draft.
- [ ] **Prepare and publish.** `ship_builder` owns repairs, commits and local proof; you own fetch/rebase, push and PR writes. Check identities before/after writes. Rebase when safe; have Builder resolve ordinary conflicts from approved scope and code evidence, then continue and rerun affected proof. Ask only for consequential ambiguity. Published rewrites need exact `--force-with-lease` against an unchanged observed remote head, with no independent work overwritten. Human owns destructive history/remote recovery. Reconcile uncertain writes before retrying; pause on auth or divergence.
- [ ] **Verify published HEAD.** Discover required CI from protection, rulesets and repository evidence; unknown policy is a gap. Match checks and expected feedback to HEAD. Wait boundedly, then refresh; incomplete/failed evidence cannot pass. Run independent `review`. Send findings unchanged to Builder; after repairs/rebase, repeat affected proof and review. Pause on stalled repairs, not a fixed count; never weaken checks.
- [ ] **Approve readiness.** Present PR/head/base, scope, changes, proof, CI, feedback, Reviewer verdict, repairs and risks. Ask human approval of this packet via `ask_user_question`. Refresh identity and evidence; material drift requires renewed proof/review and approval. Verify ready state. Never merge.

For cancellation or outages, report a concrete resume action. Attempted writes are not success; completed remote effects are not rolled back.
