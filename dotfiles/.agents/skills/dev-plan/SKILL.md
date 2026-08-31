---
name: dev-plan
description: Turn an approved plans/<project>/spec.md into small coherent implementation plans with explicit ordered tasks that a low-context builder can execute safely. Use only when explicitly invoked after the destination has been specified.
---

# Dev Plan

Turn the approved destination into the safest concrete implementation path.

The spec owns the destination and architecture.

This phase owns implementation judgment:

* repository path;
* affected surfaces;
* sequencing;
* decomposition;
* test strategy;
* failure handling;
* concrete implementation constraints.

Spend planning judgment so the builder does not have to.

## Resolve

1. Resolve the project and read `plans/<project>/spec.md` first.
2. Reuse relevant session and repository context.
3. Investigate until the implementation path is decision-complete.

Resolve:

* ownership and data flow;
* affected files, symbols, and call sites;
* lifecycle and dependencies;
* state and failure paths affected by the change;
* relevant tests and verification boundaries;
* repository conventions;
* ordering and migration constraints.

Prefer targeted symbol, reference, and call-site investigation over broad repository reading.

Resolve repository questions from evidence.

Do not treat assumptions as facts.

Before presenting a plan, verify that named files, symbols, call sites, tests, commands, and proposed sequencing match current repository reality.

If the destination itself is insufficient, contradictory, or wrong, stop and return to `dev-spec`.

## Own implementation judgment

Resolve implementation decisions aggressively when they remain inside the approved destination.

Use repository evidence and engineering judgment to decide:

* which existing abstractions to reuse;
* concrete ownership mechanics;
* affected call sites;
* local data flow;
* test boundaries;
* sequencing;
* migration mechanics;
* the smallest sufficient implementation.

Do not ask the user to resolve ordinary implementation choices.

Escalate only when planning uncovers a consequential decision that would materially redefine:

* architecture;
* ownership boundaries;
* durable invariants;
* externally observable behavior;
* meaningful scope;
* a major tradeoff not settled by the spec.

Do not turn `dev-plan` into a second `dev-spec`.

## Decompose

Split the project into the smallest coherent ordered plans.

Each plan must produce one meaningful repository state that is:

* implementable;
* verifiable;
* reviewable and coherent;
* preferably committable.

Independent deployability is not required.

Prefer the smallest coherent plan, not the smallest possible plan.

Split when:

* the work contains independently meaningful outcomes;
* parts have materially different verification boundaries;
* parts have materially different failure or lifecycle boundaries;
* the resulting diff would be too entangled to review confidently as one unit.

Do not split merely by:

* file;
* symbol;
* compiler error;
* individual coding operation;
* arbitrary task count or LOC.

Tiny implementation steps belong inside a plan.

Preserve buildability between plans when practical.

A transitional state is acceptable when deliberate, coherent, and verifiable.

## Builder standard

Write each plan so it can be followed by an enthusiastic junior engineer with:

* little project context;
* weak taste;
* poor architectural judgment;
* an aversion to testing.

Eliminate risky judgment, not harmless mechanics.

The builder should not need to reopen:

* architecture;
* ownership boundaries;
* implementation strategy;
* affected surfaces;
* task ordering;
* verification strategy.

The plan should restate only the constraints that are necessary to execute that specific task safely.

Do not duplicate the spec wholesale.

## Task ordering

Tasks inside a plan are ordered and authoritative.

`dev-exec` may group consecutive tasks into execution batches but should not casually reorder them.

Choose the safest implementation sequence during planning.

## TDD and testing

Use true RED → GREEN when observing the failure provides meaningful evidence that new or corrected behavior is exercised.

For behavioral tasks, strongly prefer:

1. establish meaningful RED;
2. make the smallest clear change required for GREEN;
3. refactor only when the resulting code contains a real problem worth fixing.

Do not manufacture RED for work that introduces no independently observable behavior.

Use explicit `MECHANICAL` or `CLEANUP` tasks when TDD would add no useful evidence.

Tests must be high-signal.

Prefer fewer strong tests over broad low-value coverage.

Test through the most stable boundary that proves the requirement economically:

1. observable or component behavior;
2. subsystem behavior;
3. focused internal invariant;
4. private implementation detail only when genuinely necessary.

Do not add tests merely to satisfy the process.

Avoid tests that:

* restate implementation structure;
* duplicate existing evidence without adding value;
* over-mock the component under test;
* test a newly introduced helper instead of the requirement;
* bake in incidental ordering or representation;
* become brittle under reasonable refactoring.

For risky changes involving lifecycle, ownership, concurrency, partial completion, state transitions, resource acquisition, external I/O, or failure recovery, explicitly state the failure semantics necessary for safe implementation.

## YAGNI and DRY

Bias strongly toward YAGNI.

Prefer direct, local implementation over speculative abstraction.

Duplication is preferable to the wrong abstraction.

Remove duplication only when it represents materially repeated knowledge or logic and the appropriate abstraction is obvious from current code.

Do not generalize for hypothetical future callers.

Small obvious local cleanup is fine.

New generalized abstractions, ownership layers, traits, reusable subsystems, or architectural indirection should exist only when justified by the approved design and current requirements.

## Plan format

Each plan should contain:

* **Objective**
* ordered **Tasks**
* **Done when**
* **Out of scope**

Add **Key facts / constraints** only when non-obvious repository evidence materially affects the whole plan.

Add **Dependencies** only when another plan must land first.

Use this compact task schema.

```text
## Task N — RED | GREEN | MECHANICAL | CLEANUP: <outcome>

Surface:
- relevant files / symbols

Prove:
- behavior or invariant to establish

Change:
- concrete implementation requirements

Constraints:
- only constraints needed to execute safely

Do not:
- only plausible bad shortcuts worth preventing

Verify:
- command or concrete evidence

Expected RED:
- why the test should fail before implementation
```

Omit sections that do not apply.

For GREEN tasks, require the smallest clear implementation satisfying the established behavior.

For task-local `Do not` constraints, include them only when a locally attractive shortcut could violate the approved strategy, safety properties, or YAGNI.

Do not prescribe inconsequential syntax or patch-level mechanics unless leaving them open would require risky judgment.

## Plan content

Include information that is expensive, risky, or unsafe for the builder to rediscover:

* relevant files and symbols;
* affected call sites;
* required ownership and data flow;
* task ordering;
* behavioral increments;
* testing boundary;
* failure semantics where material;
* task-local constraints;
* plausible dangerous shortcuts.

Do not include:

* investigation history;
* generic repository context;
* rationale for settled architecture;
* repeated spec prose;
* incidental mechanics;
* speculative abstractions;
* discussion history.

Reference the spec rather than reproducing it.

## Review output

Before writing plan files, present only a concise `DRAFT PLAN` for approval:

```text
01 <name> — <one-sentence coherent outcome>
   Surface: <important modules/symbols>
   Depends: <only if applicable>

02 <name> — <one-sentence coherent outcome>
   Surface: <important modules/symbols>
   Depends: 01
```

Include `Important choices` only for consequential implementation decisions that:

* are not already dictated by the spec;
* materially shape the implementation;
* are worth explicit user review.

Do not dump repository findings or detailed task contents into the conversation.

Ask only for approval or corrections.

## Approval and writing

After explicit approval of the decomposition and any important choices:

1. write the detailed plan files;
2. make their ordered tasks mechanically executable;
3. validate detailed instructions against repository reality;
4. do not ask for a second approval merely for task-level implementation mechanics.

Write:

`plans/<project>/01-foo.md`
`plans/<project>/02-bar.md`
...

If detailed planning exposes a new consequential architectural choice or invalidates the approved decomposition, stop and surface it rather than silently changing the approved plan.

Done when each plan can be executed primarily from the plan and affected code without broad investigation or consequential implementation judgment.
