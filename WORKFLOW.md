# Native development workflow

This version removes the custom workflow gate, not the useful engineering practices.
`src/main.rs` is restored byte-for-byte to the original `dev(2).zip`: the CLI forwards
prompts to native Codex and keeps the original commands, profiles, and resume behavior.
No workflow hook is installed, no Python validator runs at launch, and no generated
journal, acceptance-ID format, plan hash, or readiness receipt blocks the command.
Python is used only for the optional repository asset tests, not for development execution.

## Keep the workflow small

1. **Plan:** grill consequential ambiguities in batches, investigate repository facts with
   scoped explorers, verify feasibility, and independently challenge the written plans.
   Approval and execution remain separate. Reuse established decisions and relevant evidence.
2. **Build/review:** work on one dependency-ready plan at a time with a retained independent
   builder/reviewer pair. Implement the simplest complete solution; verify required behavior.
   Fix or refute findings with evidence. Keep settled decisions and failed approaches.
3. **Recover/finish:** the orchestrator diagnoses stalls and chooses a useful next action.
   There is no repair-round cutoff. It may commission reviewed, contract-preserving plan
   maintenance. A fresh final reviewer verifies integration, including required manual evidence.

Markdown handoffs are readable working evidence, not an enforced schema. Existing accepted plans
and clear historical handoffs remain usable without adding IDs or rewriting their contents.
Missing real verification still matters; a missing preferred heading does not.

## Update from dev-readiness-compat-fix.zip

Apply `dev-kiss.patch` from that version's dev source directory. The patch does not change
models, effort, permissions, Cargo dependencies, explorer configuration, or installation scripts.
Check the patch first, especially when local files have changed:

```sh
git apply --check dev-kiss.patch
git apply dev-kiss.patch
just workflow-test
cargo install --path . --locked
```

Deploy the updated four skill directories, including their references, and the builder,
reviewer, and planner TOMLs using your existing dotfile process. Updating the binary alone
will not replace old installed instructions. The supplied full ZIP contains all changed files.
If those paths are copies rather than symlinks, copy them from this source checkout; preserve
any locally edited model settings. Do not run machine-provisioning install.sh for this update.

Start a fresh project session rather than resuming a session configured with the removed gate:

```sh
dev a pr ./plans/meet-migration/ "start from 03-complete-meet-app"
```

For the reported Meet migration, preserve accepted Plans 01 and 02 and inspect their existing
evidence. Do not restart their builds merely because the old gate could not parse it. Keep
archived Plan 03 inactive. Continue current Plan 03 after confirming its actual prerequisites.
This package contains the dev workflow, not the Meet source or its private acceptance evidence.

The removed hooks were injected by the launcher. This version does not inject them. If you
also saved their definitions in your own Codex configuration, use `/hooks` to disable only
entries invoking `dev agent _workflow-hook` (or its alias), not unrelated or managed hooks.
Old `.workflow.json` and lock artifacts can be left in place: this version never reads them.
Do not delete source, accepted plans, reviews, or progress notes to restart execution.

## Enforcement tradeoff

This intentionally supersedes the earlier runner-enforced metadata requirement. Agents check
readiness, dependency ordering, current evidence, and final acceptance; the CLI no longer tries
to certify their reasoning. This improves flexibility by removing document-parser lockouts,
not by waiving tests, required manual evidence, security policy, or approved behavior.
It does not guarantee correctness or eventual completion. Runtime/resource failures remain real.

## Validation

The release check is `just verify`; `just install` installs the binary only.
`just workflow-test` runs lightweight source/configuration tests, not a model or parser for plans.
The old gate's tests were removed with that implementation; their previous pass count is not a
claim about this version. See the delivery summary for executed checks and measured preservation.
Rust/Cargo, Just, and Codex are not available in the authoring environment. This version adds
no new Rust code, but compilation and live-agent execution have not been performed here.

Native hook controls are documented at https://learn.chatgpt.com/docs/hooks.
