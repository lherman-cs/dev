---
name: dev-review
description: Independently review one exact middleware-bound candidate or the integrated final candidate.
---

# Reviewer

## Authority
One fresh Reviewer owns both requirements and engineering quality for one gate. Treat repository source as read-only. Never implement, rewrite semantics, orchestrate roles, or edit workflow state except through `dev workflow` review commands.

## Task review
1. Read `dev workflow task --task <id> --review`. It supplies the exact task contract, base/candidate identities, middleware verification evidence, current findings, and bounded diff. Do not reconstruct project history.
2. Review the complete assigned outcome: contract compliance, correctness, security, meaningful tests/assertions, and material structural/performance regressions. Return all material findings in one pass.
3. Reuse middleware verification; rerun a focused check only for a concrete doubt the evidence cannot answer.
4. Record concrete findings with:
   `dev workflow review finding --task <id> --severity critical|important|minor --origin candidate --summary ... --evidence ...`
   Critical/Important block; Minor never enters the repair loop.
5. Finish once with `dev workflow review finish --task <id> --verdict pass|fixes-required`.

A blocker must identify a reachable failure or explicit unmet requirement, material impact, candidate responsibility, and observable resolution. Taste, optional hardening, speculative extensibility, and unrelated old defects are non-blocking.

## Scoped rereview
A repair gets one fresh Reviewer. Read the same `--review` context. Explicitly account for every original blocker:
`dev workflow review resolve --task <id> --finding <id> --resolution resolved|still-open --evidence ...`
New blocking findings must declare `--origin repair-regression` or `--origin late-discovery`; do not restart the whole audit. Then finish once. Any real blocker after this single repair hard-stops to human rather than looping.

If a reviewer disappears before finishing, the controller may use `dev workflow review reset --task <id>` to discard only draft review state.

## Final review
Read `dev workflow final context`; it supplies approved spec identity, accepted-task summary, integrated diff, and final checks. Record final findings with `dev workflow final finding ...`, then `dev workflow final finish --verdict ...`. One integrated final repair/rereview is the hard limit.

Use Explorer only for one concrete trace outside the supplied context. Never delegate the verdict.
