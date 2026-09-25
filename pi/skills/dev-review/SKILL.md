---
name: dev-review
description: Collaboratively converge a built candidate with the CTO through deep review, repair, and progressive system understanding.
disable-model-invocation: true
---

# dev-review

Read `../../references/reconcile.md` at entry. Read `../../references/engineering.md` at entry. Reconstruct the approved outcome, repository state, local history, validation, unresolved feedback, and relevant uncommitted work.

Own technical convergence of the candidate with the human as CTO. Keep the local Review webpage current through `review_publish`: start with outcome, evidence and its limits, rationale, risks and recommendation, and add relevant system or code context. Use stable subject IDs. For a workspace request, answer there with `review_reply` and its exact requestId; use `review_publish` with a reply if the assessment changes. Publish an updated assessment when the candidate or evidence changes. The human may close/reopen the view while work continues. Do not mistake closing, silence, stale evidence or historical approval for authorization. Review discussion and consequential decisions take place inside that webpage; do not solicit phase-internal input in the terminal. Before declaring the reviewed candidate complete, obtain the workspace's explicit current-candidate approval.

- Merge the current local integration branch, normally `main`, into the candidate before judging it. Keep the merge in the development history. Resolve ordinary conflicts yourself; treat a conflict that changes approved behavior, architecture, scope, or accepted risk as a consequential decision for the human.
- Understand the candidate deeply enough to challenge its correctness, compatibility, failure behavior, maintainability, and fit with the approved outcome. Inspect the whole relevant change, then go deeper where risk warrants it. Prefer material defects and consequential tradeoffs over taste-only or speculative churn.
- Build the human's high-level mental model while reviewing. Explain where the change sits in the system, what owns the affected behavior, the important interactions and invariants, and why findings or repairs matter. Surface useful architectural learning as it becomes relevant, without turning the review into a code tour. Build on context already established in the conversation.
- Keep explanations at CTO level by default: practical behavior, architecture, tradeoffs, failure modes, and evidence. Go into code-level detail when the human asks or when it is necessary to make a consequential decision.
- Repair clear in-scope defects directly and validate affected behavior. Commit the merge and review repairs coherently so the converged candidate ends clean and fully committed. Do not ask whether routine repairs are worth doing. Ask only when a repair would materially change approved behavior, architecture, scope, or accepted risk; make that decision easy by explaining the consequences and recommending a direction.
- Treat findings as working engineering evidence, not PASS/FAIL judgments. Reassess findings against the code, reject unsupported ones, repair accepted ones, and keep unresolved material concerns visible to the human.
- Update existing documentation when the converged candidate materially changes the system model or consequential design rationale. Preserve durable understanding, not a transcript.
- Re-run only validation invalidated by the merge or repairs, plus missing proof needed to support the candidate. Translate checks into the behavior they establish and the uncertainty they leave.

Finish when the candidate is technically converged against the merged integration baseline, required validation is applicable and passing, material concerns are resolved or explicitly understood with the human, and the human has an accurate high-level understanding of the changed system.

**Endpoint:** A clean, fully committed reviewed candidate, including its merge from the integration baseline, ready for mechanical history packaging. Do not rewrite history, publish, deploy, or merge the candidate into another branch.
