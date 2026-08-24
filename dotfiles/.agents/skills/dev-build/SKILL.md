---
name: dev-build
description: Implement one approved plan from plans/<project>/<NN>-*.md through a Luna-high builder subagent and verify it without redesigning or rediscovering the approved work. Use only when explicitly invoked with a project and plan number or plan path.
---

# Dev Build

You are the coordinator. One Luna-high builder subagent performs the implementation.

The approved plan owns intent and architecture. The builder owns implementation mechanics.

1. Resolve exactly one plan from the invocation. Accept:
   - `project/NN`
   - `plans/project/NN-name.md`

2. Spawn one `builder` subagent using:
   - model: `gpt-5.6-luna`
   - reasoning effort: `high`
   - repository write access

3. Give the builder only the compact execution context it needs:
   - repository root;
   - exact resolved plan path;
   - material user decisions from the current session only when they are not already recorded in the plan.

   Do not copy the plan contents into the subagent prompt.
   Do not fork or replay unnecessary conversation history.

4. The builder must read the resolved plan directly from the repository before inspecting implementation code.

5. The builder must treat the plan as authoritative for intent, scope, architecture, and acceptance criteria.

6. The builder should:
   - reuse relevant repository context already available to it;
   - inspect only affected code and nearby dependencies needed to implement and verify the plan;
   - prefer verified plan facts over re-deriving them;
   - avoid broad repository investigation;
   - avoid reconsidering architecture already resolved by the spec or plan;
   - load the sibling `spec.md` only when:
     - the plan lacks context required for implementation; or
     - repository reality materially contradicts the plan;
   - implement only the approved scope using existing repository conventions;
   - make minor mechanical deviations only when repository reality requires them;
   - run the plan's verification plus cheap checks directly implied by the changes;
   - fix implementation-caused failures and rerun the relevant checks.

7. The builder must stop rather than silently redesign when a material assumption is wrong:
   - implementation or decomposition problem → report that the plan needs revision;
   - destination, architecture, or requirement problem → report that the spec needs revision.

8. The coordinator must not independently read the plan, repeat repository investigation, or redo implementation work already delegated to the builder.

9. Review the builder's result only for:
   - completion of the approved plan;
   - verification evidence;
   - material deviations;
   - unresolved failures or risks.

10. If the builder reports a material plan/spec conflict, return that result to the user rather than spawning additional implementation attempts that reinterpret the approved work.

11. If implementation succeeds, finish concisely with:
    - what changed;
    - verification and results;
    - deviations or remaining risks.

Do not expand scope.
Do not redesign the approved architecture to make implementation easier.
Do not claim success without fresh verification.
Do not use the build step to rediscover decisions already established by the approved plan.

If creating a commit, add:

`Plan: plans/<project>/<NN>-<name>.md`
