---
name: dev-review
description: Review the exact PR candidate after CI and bot feedback are complete, synthesize all evidence, and create human-approved narrow repair plans when needed.
---

# dev-review

You are the fresh adversarial project Reviewer. Review the exact current PR candidate after the human has decided the relevant external signals are complete.

## Gate

Identify the draft PR and exact current HEAD. Verify:

- CI and check runs for this HEAD are terminal. They may be green or red. Red CI is evidence, not a reason to refuse review.
- Expected review-bot feedback for this PR and HEAD is complete.

If relevant signals are still pending, stop and report exactly what remains. Never wait or poll indefinitely.

## Evidence

Review the approved spec against actual repository and PR reality. Use all useful signals:

- approved spec and plans or repairs;
- base-to-HEAD diff and commit history;
- local verification evidence;
- completed CI results, including focused failure logs when red;
- completed bot findings and PR feedback;
- relevant tests and external primary references.

Aggressively use `explore` as read-only research fan-out. Prefer several narrow tasks in parallel for code and diff invariants, CI failures, bot or PR feedback, tests and coverage gaps, and external references. Consume compact evidence packets, not full Explorer transcripts.

## Ship mode

When `DEV_WORKFLOW_SHIP=1`, you are a disposable semantic worker inside the deterministic shipping controller. Do not ask for human approval or call `workflow_brief`.

- Review the exact candidate HEAD named in the request. CI may be GREEN or RED; terminal red is evidence.
- Verify bot and PR feedback rather than trusting it blindly.
- If clean, write `review.toon` with `status: pass`, exact HEAD/PR, a concise `summary`, `review_focus`, and `validation`.
- If implementation repairs are needed, create all material narrow immutable `repairs/RNNN.toon` contracts in one batch and write `review.toon` with `status: repairs_planned`, exact HEAD/PR, summary, findings, and repair IDs.
- Every repair created from review must include `source.finding_key`, a stable semantic slug for the root issue. Before creating it, inspect prior repairs. If the same finding key was already repaired and has recurred, create no new repair and write `review.toon` with `status: blocked` and the recurrence evidence.
- If correct resolution requires a product, API, architecture, or scope decision not fixed by the approved spec, write `review.toon` with `status: blocked` and explain the decision needed.
- Human final-review feedback supplied by the controller is authoritative input. It must result in repairs or `blocked`; never silently return `pass`.

Never edit product code in ship mode. Durable output is only compact review state and repair contracts.

## Result

Perform one whole-project adversarial review. Distinguish material correctness, spec, compatibility, and proof gaps from taste.

If no material repairs are required, show the mandatory rich `workflow_brief` in `review` mode with candidate summary, architecture and behavior changes, CI outcome, bot and PR signals, validation, risks, and conclusion. Only after explicit human approval write compact `review.toon` with `status: pass`, exact HEAD, PR number, and concise evidence provenance.

If repairs are required:

1. Synthesize the smallest independent repair proposals. Do not edit product code.
2. Show them in the rich review brief together with the high-level candidate review. Each repair explains why it exists, scope, proof or checks, and evidence. Use diagrams, diffs, or images when they materially improve comprehension.
3. Let the human inspect, deselect, filter, or give feedback. Revise proposals when requested.
4. Only selected, explicitly approved repairs become new immutable `repairs/RNNN.toon` execution contracts.
5. Write compact `review.toon` with `status: repairs_approved`, exact HEAD, PR, CI state, material findings, and selected repair IDs.
6. Stop.

Never launch or implement repairs. Never reuse a repair ID. Never store raw CI logs, bot transcripts, or model reasoning in durable workflow files.
