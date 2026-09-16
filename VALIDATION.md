# Validation record for the full repository snapshot

Base: `lherman-cs/dev` commit `4946e2f47ffdb78572dbb4dc2175c3c3ab391d67`.

## Executed in this environment

- `python3 tests/validate_assets.py`: **PASS**, 300 structural assertions. See `validation/asset-validation.json`.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: **PASS**, 88 tests. See `validation/python-tests.log`.
- The added tests cover partial-range rejection, package tampering, required-verification declarations, candidate-bound final evidence, BLOCKED finding continuity, no-repair clarification, repair caps, recovery receipts and nonignored untracked inputs.
- The original 65 helper/installer tests also pass on the updated protocol. They use real temporary Git histories and filesystem operations, not model responses.
- All 88 upstream tracked paths are accounted for: five explicitly retired review templates are removed; every other path is present. Preserved sources were checked against Git blob hashes. Modified/additional files and hashes are listed in `ARCHIVE_MANIFEST.json`.
- All 104 distinct original questionnaire IDs are retained (the original document contains Q88 twice). The Q55 heading is renamed from dual-review to review; affected answers are amended in place.
- Role configurations and `agent.toml` are unchanged from the inspected revision; no model, effort or permission change. No CI files or CI invocation.

## Not executed

Rust/Cargo, `just`, and Codex are not installed here. `cargo test --locked`, `cargo build --locked`, the compiled-launcher test and the actual `just` invocation were **not run**. The Python commands behind `just test-fast` were run directly. No live Codex agents, PulseBeam behavioral experiment, sandbox-permission evaluation or paid model call was run.

The 52 pressure scenarios are definitions, not passing live trials. Test counts prove only the tested mechanical behavior. They do not certify honest model evidence, semantic correctness, model availability, reduced feedback loops or a particular speedup. Local evidence does not imply a no-regressions guarantee.

## Local check on your machine

With Python 3.11+, PyYAML, Rust/Cargo, Git and just installed, run `just test` from the extracted repository. Live evaluations are separate and opt-in; do not substitute fixtures for actual Codex trials. Rebuild the binary with `just install` only after the local checks pass; embedded assets are content-addressed and old sessions keep their existing snapshot.
