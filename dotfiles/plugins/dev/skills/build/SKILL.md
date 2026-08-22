---
name: plan
description: Develop a precise implementation plan through a Sol high planner subagent while the Luna parent coordinates the conversation. Use when the user invokes $dev:plan or asks to investigate and plan a code change without editing files.
---

# Plan

You are the Luna-medium coordinator. Keep the user in this parent thread. Delegate repository investigation and implementation design to one Sol-high planner.

The goal is not merely to suggest an approach. Produce an approved implementation specification precise enough that a smaller builder model can execute it without making consequential design decisions.

## Planning cycle

1. Collect:

   * the original request;
   * explicit user decisions and constraints;
   * repository path;
   * requested scope;
   * relevant prior approved decisions from this conversation.

2. For a new planning cycle, spawn one `planner` subagent:

   * model: `gpt-5.6-sol`;
   * reasoning: `high`;
   * read-only;
   * compact brief;
   * no full-history fork.

   Keep the same planner handle for the entire planning cycle.

3. The planner must investigate the repository before proposing the plan.

4. Present the planner's `DRAFT PLAN` to the user.

5. Forward material user answers, corrections, and requested changes to the same planner.

6. Repeat until no consequential ambiguity remains.

7. Only after the user explicitly says `Approve the plan`, request or produce the final `APPROVED PLAN`.

The planner is read-only. Do not edit, build, test, commit, or review implementation.

Do not ask the user to copy context between agents.

## Planner standard

Require the planner to distinguish repository evidence from assumptions.

The planner must inspect enough of the current implementation to identify:

* existing architecture and ownership;
* relevant types and symbols;
* current data flow;
* behavior that will remain;
* behavior that will change;
* obsolete machinery that should be removed;
* tests and validation affected by the change.

Do not allow the planner to invent architectural intent merely to make the plan complete.

If a consequential choice cannot be established from repository evidence or the user's request, surface it as an explicit question rather than silently choosing.

## Precision requirement

The plan must be implementation-ready.

For every material change, identify as applicable:

* exact file paths;
* existing symbols being changed or removed;
* new symbols or responsibilities being introduced;
* ownership and lifecycle;
* input/output or call flow;
* data structures and state transitions;
* API or type-shape changes;
* concurrency or synchronization behavior;
* error and failure behavior;
* migration from the current implementation;
* code that becomes dead and should be deleted;
* tests that must be added, changed, or removed;
* verification commands or observable success conditions.

Use concrete names from the repository whenever they already exist.

Do not prescribe incidental line-by-line implementation details unless they are required for correctness or to prevent ambiguity.

## Resolve design before approval

The approved plan must not leave consequential design decisions to the builder.

Before approval, resolve questions involving:

* architecture;
* ownership;
* API shape;
* state representation;
* concurrency;
* synchronization;
* lifecycle;
* protocol semantics;
* compatibility;
* performance-sensitive behavior;
* scope boundaries.

Routine implementation choices may remain to the builder when multiple choices are semantically equivalent.

For each unresolved question, explain:

1. what repository evidence was found;
2. what remains ambiguous;
3. the meaningful options;
4. the consequences of each option;
5. the planner's recommendation, if evidence supports one.

Do not hide unresolved questions inside plan steps.

## Draft plan format

Require the planner's `DRAFT PLAN` to use this structure:

### Goal

State the intended end state and the problem being solved.

### Current state

Describe only the relevant existing architecture, using concrete files and symbols.

### Decisions

List the material decisions already established by the user or repository evidence.

Clearly distinguish fixed decisions from planner recommendations.

### Invariants

List behavior and constraints that must remain true throughout and after the implementation.

### Non-goals

State nearby work that is intentionally out of scope.

### Implementation

Give ordered implementation checkpoints.

For each checkpoint include:

* objective;
* files and symbols;
* exact behavioral or structural changes;
* deletions or migrations;
* invariants that must still hold;
* tests or validation;
* resulting coherent repository state.

Each checkpoint should be independently understandable and suitable for one focused implementation commit where practical.

### Final verification

Specify the checks required to establish that the complete implementation matches the plan.

### Open questions

List only unresolved decisions that require user input.

If there are none, say `None`.

## Approved plan

After the user says `Approve the plan`, produce a self-contained `APPROVED PLAN`.

It must include:

* goal;
* acceptance criteria;
* fixed decisions;
* invariants;
* non-goals;
* affected files and symbols;
* ordered implementation checkpoints;
* required removals and migrations;
* risks or fragile areas;
* verification.

The `APPROVED PLAN` must contain all information necessary for the build phase.

Do not rely on hidden planner context, prior draft wording, or unstated reasoning.

A builder receiving only the approved plan plus the repository should be able to implement the requested change without making a new consequential design decision.

If that is not true, the plan is not ready for approval.
