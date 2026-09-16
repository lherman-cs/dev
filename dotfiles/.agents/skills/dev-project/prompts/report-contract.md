# Project review report contract

Write ONE JSON report, with no surrounding Markdown fences. Copy full base/candidate IDs and `contract_sha256` from the immutable diff package. Do not guess them. All fields below are required; empty arrays are valid where shown. Schema validation checks provenance and structure, not whether your review is correct.

```json
{
  "schema": 1,
  "mode": "task",
  "base": "FULL_BASE_SHA",
  "candidate": "FULL_CANDIDATE_SHA",
  "contract_sha256": "SHA256_FROM_PACKAGE",
  "verdict": "PASS",
  "findings": [],
  "resolutions": [],
  "checked": ["path:symbol — decisive requirement or risk checked"],
  "blocker": ""
}
```

Modes are `task`, `repair`, `final`, `final-repair`. `PASS` has no blocking findings, unresolved old IDs or missing proof. `FIXES_REQUIRED` has at least one concrete Critical/Important finding and an empty `blocker`. `BLOCKED` uses `blocker` for a precise evidence/authority gap; it is never acceptance.

Each NEW finding has exactly these fields:
```json
{
  "id": "R1",
  "severity": "Important",
  "origin": "candidate",
  "location": "path:symbol or line",
  "failure": "Trigger; expected versus actual behavior; violated contract",
  "impact": "Material consequence and why this candidate is responsible",
  "resolution": "Observable evidence that the failure is corrected; mechanism optional"
}
```

Use `R1`, `R2`, ... without reusing historical IDs. Existing `S1`/`Q1` IDs from interrupted projects are preserved. Severity is Critical, Important or Minor. Initial review origins are `candidate`; new rereview findings use `repair` with causal evidence, or `late-discovery` for a serious earlier miss. A filename outside the diff does not disqualify a repair-caused bug. Minor findings stay out of repair packets. Never use a mere format error or optional improvement as a code blocker.

On scoped rereview, `resolutions` covers EVERY prior packet ID exactly once:
```json
{"id": "R1", "status": "RESOLVED", "evidence": "path:symbol — why the specific failure no longer occurs"}
```
Use `UNRESOLVED` when necessary; do not reprint it as a new finding or reuse a resolved ID. Initial reviews have an empty resolutions array. The validator carries unresolved findings verbatim from the previous packet. Report checked evidence briefly; full logs stay in their existing files. Return only verdict, report path and blocking IDs to the controller.
