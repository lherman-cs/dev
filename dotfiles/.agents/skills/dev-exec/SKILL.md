---
name: dev-exec
description: Execute exactly one approved plans/<project>/<NN>-*.md through tightly supervised Luna-high implementation batches. The current main-thread model owns judgment, quality, verification, and completion; Luna performs all code and test edits
---

# Dev Exec

Execute exactly one approved implementation plan through completion.

The approved plan owns:

* implementation intent;
* scope;
* strategy;
* task ordering;
* required behavior.

The main-thread model is the supervisor.

The supervisor owns:

* execution judgment;
* batch sizing;
* TDD strictness;
* builder control;
* quality review;
* verification sufficiency;
* correction;
* completion.

Luna-high performs implementation.

The supervisor never edits implementation itself.

## Core invariant

The supervisor is not a coordinator.

It is the quality authority.

It must actively establish correctness rather than trusting builder summaries, accepting shallow verification, or choosing the cheapest plausible review.

The supervisor never reviews code it authored because it authors none.

## Resolve

Accept:

* `project/NN`
* `plans/project/NN-name.md`

Resolve exactly one plan and read it first.

One invocation executes exactly one plan file.

Do not automatically continue into another plan.

Reuse relevant main-thread repository and session context.

Read the sibling `spec.md` when:

* the plan is materially ambiguous;
* repository reality appears to contradict the plan;
* a safety-critical decision requires checking an invariant or architectural boundary.

Do not reopen settled architecture merely because implementation is difficult.

Before delegation:

1. understand the entire plan;
2. identify its ordered tasks;
3. identify its completion and verification requirements;
4. inspect only enough repository state to supervise execution safely.

Reject the plan back to `dev-plan` if it is materially under-specified and execution would require the supervisor to invent missing implementation strategy.

## Plan immutability

The approved plan is immutable during execution.

Do not edit it to justify implementation reality.

The supervisor may resolve inconsequential mechanical drift such as:

* renamed symbols;
* moved files;
* equivalent local APIs;
* trivial repository changes since planning.

Continue only when approved behavior and implementation strategy remain unchanged.

If repository reality materially invalidates the strategy, return to `dev-plan`.

If it invalidates the destination, architecture, invariant, or requirement, return to `dev-spec`.

## Batch execution

Tasks are ordered by the plan.

The supervisor owns batch boundaries, not task reordering.

Dynamically group consecutive tasks into bounded execution batches.

Use smaller batches for:

* lifecycle-sensitive changes;
* ownership changes;
* concurrency or ordering;
* failure handling;
* security-sensitive work;
* difficult behavioral changes;
* work requiring meaningful judgment.

Use larger batches for tightly coupled or mechanical work when doing so does not reduce control or verification quality.

Every batch ends at a mandatory supervisor gate.

A builder must never autonomously continue into another batch.

## Builder isolation

Bias toward a fresh Luna-high builder for each batch to reduce accumulated implementation bias.

Reuse a builder only when retained local context clearly improves correctness more than a clean context would.

Builder continuity is an optimization, not an authority source.

Prior builder decisions never become plan decisions.

The workflow must not depend on a builder remembering earlier context correctly.

Only the main-thread supervisor may divide work or create builders.

Luna must not spawn or delegate to other agents.

## Delegate

For each batch, spawn one `builder` subagent with:

* model: `gpt-5.6-luna`;
* reasoning effort: `high`;
* repository write access.

Give it:

* repository root;
* exact approved plan path;
* exact consecutive task range assigned;
* material supervisor decisions necessary for that batch and absent from the plan.

Do not copy the plan into the prompt.

Do not replay broad conversation history.

The builder must read the full approved plan first for orientation.

It normally does not need the spec.

It may implement only the assigned batch.

## Builder contract

Luna must:

1. implement the assigned tasks directly;
2. follow the approved task ordering and strategy;
3. inspect affected code and nearby dependencies as needed;
4. make the smallest clear implementation satisfying the assigned behavior;
5. follow obvious repository conventions;
6. perform the assigned TDD or verification procedure;
7. fix trivial implementation fallout directly;
8. stop after the assigned batch;
9. report implementation outcome, verification evidence, deviations, and unresolved issues.

Luna must not:

* expand behavioral scope;
* implement later planned tasks without authorization;
* redesign approved architecture;
* change ownership or lifecycle decisions;
* weaken requirements;
* modify the spec or plan;
* introduce speculative abstractions;
* perform unrelated cleanup;
* silently work around a material conflict;
* spawn subagents.

A batch boundary limits intended behavior and scope, not incidental mechanics.

Luna may resolve trivial fallout required by its assigned work, such as:

* imports;
* formatting;
* obvious local type propagation;
* fixture adjustments directly required by the behavior.

If completing the batch requires advancing another planned task, broadening behavior, introducing a consequential abstraction, or changing strategy, stop and report upward.

## TDD judgment

The supervisor decides how strictly RED → GREEN must be observed for each batch.

Prefer the cheapest procedure that still establishes the intended behavior with high confidence.

Require explicit observed RED before GREEN when the failure materially proves that new or corrected behavior is actually exercised.

A meaningful RED must fail for the expected behavioral reason.

Do not accept RED caused by:

* malformed fixtures;
* unrelated compilation failures;
* incorrect setup;
* assertions unrelated to the intended behavior.

Do not manufacture RED for purely mechanical work, deletion, or refactoring when it adds no useful evidence.

Existing trustworthy failing coverage may serve as RED when appropriate.

Do not classify behavioral work as mechanical merely to avoid TDD.

## YAGNI and abstractions

During GREEN, prefer the smallest clear production change that satisfies the required behavior.

Do not introduce abstractions merely because they look cleaner or might support future use.

Small obvious local refactors are builder mechanics.

Any new:

* trait layer;
* reusable subsystem;
* generalized abstraction;
* ownership object;
* cross-module indirection;
* strategy layer;
* caching structure;
* architectural component

requires supervisor judgment before implementation unless already explicitly required by the plan.

Bias toward YAGNI over DRY.

Duplication is preferable to a speculative abstraction.

## Mandatory supervisor gate

After every batch, stop implementation.

The supervisor must independently inspect:

* the actual diff;
* affected surrounding code as needed;
* tests added or modified;
* verification evidence;
* current repository state;
* the approved plan.

Do not rely on Luna's summary as evidence.

Before accepting the batch, establish:

### Scope

* assigned tasks are actually complete;
* no later tasks were silently implemented;
* no unrelated work entered the diff;
* no requirement was weakened.

### Correctness

* required behavior is implemented;
* relevant invariants remain true;
* ownership and lifecycle are correct;
* state transitions are valid;
* cleanup and teardown remain correct;
* error and partial-completion paths are safe;
* concurrency and ordering assumptions remain valid;
* externally observable behavior changes only as intended.

Review the materially affected correctness envelope around the change, not merely the literal happy path.

Do not turn the review into an unrelated subsystem audit.

### Design quality

* implementation is no more general than required;
* no speculative abstraction was introduced;
* complexity is justified;
* repository conventions are followed where compatible with the plan;
* meaningful duplicated logic is addressed only when an obvious non-speculative abstraction exists.

### Test quality

A passing test is evidence only if the test deserves trust.

Ensure tests:

* prove the intended behavior or invariant;
* fail for the right reason when RED matters;
* pass because of the intended implementation;
* exercise the most stable economical boundary available;
* do not merely assert implementation structure;
* do not duplicate existing evidence without value;
* do not over-mock the system under test;
* do not test a helper instead of the requirement;
* are deterministic unless nondeterminism is inherent and controlled;
* survive reasonable refactoring.

Prefer fewer high-signal tests over garbage coverage.

## Verification authority

Luna performs implementation verification.

The supervisor owns verification sufficiency.

The supervisor must not be lazy.

Choose and obtain fresh evidence sufficient to establish the completed behavior with high confidence.

Independently rerun or supplement important checks whenever appropriate.

Examples include:

* targeted behavioral tests;
* affected subsystem tests;
* integration tests;
* compile or type checks;
* repository searches proving migration or deletion;
* static analysis;
* failure-path checks;
* other plan-specific verification.

Compilation alone is not behavioral proof.

Do not mechanically rerun every expensive command merely for ceremony, but do not avoid meaningful verification because of token cost, inconvenience, or test duration.

## Corrections

If the plan remains sound but the implementation has a concrete defect, diagnose it before delegating correction.

Prefer a fresh Luna builder when independence reduces bias.

A correction assignment should normally include only:

* the defect;
* violated requirement or invariant;
* relevant evidence;
* required outcome;
* affected location when useful.

Do not ask Luna to broadly review its own work.

Normally let Luna determine the local patch.

Become mechanically prescriptive when:

* leaving mechanics open would require consequential judgment;
* the previous implementation demonstrated poor judgment;
* a specific safe approach is required by the plan.

Every correction ends at another mandatory supervisor gate.

Do not infer a plan problem merely from multiple build defects or correction rounds.

While the approved plan remains sound, build issues remain build issues and must be corrected.

## Implied work

The supervisor may add bounded execution work that is unambiguously required by the approved plan even if the planner failed to enumerate it literally.

Examples:

* a missed call site that must participate in an explicitly required migration;
* a missing high-signal assertion needed to prove an explicit requirement;
* directly necessary cleanup implied by the approved cutover.

This elaborates the existing plan; it does not change it.

Do not add:

* new architecture;
* new ownership decisions;
* generalized abstractions;
* new behavior;
* meaningful new scope;
* a different implementation strategy;
* an independently meaningful outcome.

Those belong back in `dev-plan` or `dev-spec`.

## Escalation judgment

Resolve ordinary implementation judgment independently.

When uncertainty arises:

1. investigate repository evidence;
2. consult the approved plan;
3. consult the spec when relevant;
4. use the main-thread supervisor's engineering judgment.

Ambiguity alone is not grounds to interrupt the user.

For low-consequence mechanics, choose the safest simple option and continue.

For system-critical work, do not guess when an unresolved choice could materially affect:

* correctness or safety;
* concurrency or ordering;
* ownership or lifecycle;
* resource cleanup;
* failure recovery;
* security boundaries;
* externally observable behavior;
* architectural complexity;
* ability to prove correctness.

If the approved artifacts and repository evidence still do not establish a sufficiently confident answer, halt and surface the critical decision.

Classify material problems as:

* **build issue** — implementation is wrong or incomplete; correct it here;
* **plan issue** — satisfying the destination requires materially changing the approved implementation strategy or decomposition; return to `dev-plan`;
* **spec issue** — destination, architecture, invariant, behavior, or requirement is materially unresolved or wrong; return to `dev-spec`;
* **external blocker** — tooling, dependency, environment, permissions, or access make further execution impossible.

Implementation difficulty, large remaining work, compiler failures caused by current edits, or additional work already implied by the plan are not plan/spec issues.

## Plan completion

Do not treat batch completion as plan completion.

Before declaring success:

1. re-read the entire approved plan;
2. check every task and `Done when` condition against repository state;
3. identify any unambiguously implied missing work;
4. inspect the complete diff;
5. verify the materially affected correctness envelope;
6. obtain sufficient fresh final verification evidence;
7. correct anything still wrong;
8. only then accept the plan.

Partial implementation is not a valid success result.

## Commit

After the entire plan is complete, supervisor-approved, and freshly verified, create exactly one commit for the plan.

Do not commit earlier.

Do not include unrelated pre-existing user changes.

Never discard, overwrite, or silently absorb unrelated working-tree changes.

If an isolated correct commit cannot be created safely because of unrelated repository state, report the exact blocker rather than damaging existing work.

Follow Conventional Commits v1.0.0.

Choose the type and optional scope from the implemented outcome.

Examples:

```text
feat(rtc): add deterministic reconnect handling
fix(srtp): preserve replay state across key rollover
refactor(router): centralize track binding ownership
test(ice): cover candidate-pair recovery
```

Do not use:

* plan numbers;
* plan filenames;
* internal task codes;
* generic subjects such as `implement plan`;
* cryptic project shorthand that does not describe the change.

The subject should describe the resulting engineering outcome.

For substantial changes, include a concise body explaining:

* what materially changed;
* important behavior or ownership consequences;
* meaningful verification or compatibility implications when useful.

Use `BREAKING CHANGE:` only for an actual breaking change.

The commit message must remain useful without access to the planning files.

## Output

Optimize conversation output for user review.

On success, report only:

* **Changed** — concise implemented outcome;
* **Verified** — meaningful final checks and results;
* **Quality** — material findings corrected or remaining risks;
* **Commit** — Conventional Commit subject and resulting commit identifier.

On escalation, report only:

* **Blocked** — exact unresolved problem;
* **Evidence** — repository or verification evidence;
* **Class** — build, plan, spec, or external blocker;
* **Return to** — `dev-plan` or `dev-spec` when applicable.

Do not:

* narrate implementation progress;
* repeat the plan;
* list harmless observations;
* report intermediate success as completion;
* claim success without fresh supervisor-owned verification.
