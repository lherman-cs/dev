---
name: dev-build
description: Implement one approved plan from plans/<project>/<NN>-*.md in the current thread and verify it without redesigning or rediscovering the approved work. Use only when explicitly invoked with a project and plan number or plan path.
---

# Dev Build

Implement one approved plan in the current thread.

The approved plan owns intent, scope, architecture, and acceptance criteria.
You own implementation mechanics.

1. Resolve exactly one plan from the invocation. Accept:
   - `project/NN`
   - `plans/project/NN-name.md`

2. Read the resolved plan first, before inspecting implementation code.

3. Treat the plan as authoritative for:
   - intent;
   - scope;
   - architecture;
   - acceptance criteria.

4. Reuse relevant repository and session context already available.

5. Inspect only the affected code and nearby dependencies necessary to implement and verify the plan.

6. Prefer verified plan facts over re-deriving them:
   - do not repeat broad repository investigation;
   - do not reconsider architecture already resolved by the spec or plan;
   - do not rediscover decisions already recorded in the plan.

7. Load the sibling `spec.md` only when:
   - the plan lacks context required for implementation; or
   - repository reality materially contradicts the plan.

8. Implement only the approved scope using existing repository conventions.

9. Make minor mechanical deviations only when repository reality requires them and they do not change the approved design.

10. Run:
    - the verification required by the plan;
    - cheap checks directly implied by the changes.

11. Fix implementation-caused failures and rerun the relevant checks.

12. Stop rather than silently redesign when a material assumption is wrong:
    - implementation or decomposition problem → report that the plan needs revision;
    - destination, architecture, or requirement problem → report that the spec needs revision.

13. If implementation succeeds, finish concisely with:
    - what changed;
    - verification and results;
    - deviations or remaining risks.

Do not spawn subagents.
Do not expand scope.
Do not redesign the approved architecture to make implementation easier.
Do not claim success without fresh verification.
Do not use the build step to rediscover decisions already established by the approved plan.

If creating a commit, add:

`Plan: plans/<project>/<NN>-<name>.md`
