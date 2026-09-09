# Direct development workflow

The user works directly with four specialist roles:

- `dev a plan` — align on the next bounded slice.
- `dev a explore` — investigate one repository question read-only.
- `dev a build` — implement one user-directed slice and prove it.
- `dev a review` — independently review a supplied change.

Plan/build/review may spawn the configured read-only `explorer` with explicit
`spawn_agent(..., agent_type="explorer", fork_turns="none")` calls.

There is no autonomous project orchestrator, workflow journal, mandatory plan
format, build/review handoff protocol, acceptance ID, or workflow hook gate.
The user chooses every transition between roles.
