---
name: dev-build
description: Implement one approved plan from plans/<project>/<NN>-*.md and verify it without redesigning or rediscovering the approved work. Use only when explicitly invoked with a project and plan number or plan path.
---

# Dev Build

Implement one approved plan. The plan owns intent; you own implementation mechanics.

1. Resolve exactly one plan from the invocation. Accept:
   - `project/NN`
   - `plans/project/NN-name.md`
2. Read the resolved plan first.
3. Reuse relevant repository and session context already established.
4. Inspect only the affected code and nearby dependencies necessary to implement and verify the plan.
5. Prefer acting on verified plan facts over re-deriving them.
6. Do not repeat broad repository investigation or reconsider architecture already resolved by the spec and plan.
7. Load the sibling `spec.md` only when:
   - the plan lacks required context; or
   - repository reality appears to materially contradict the plan.
8. Implement only the plan scope using existing repository conventions.
9. Minor mechanical deviations are allowed when repository reality requires them.
10. If a material assumption is wrong:
    - implementation or decomposition problem → stop and report that the plan needs revision;
    - destination or requirement problem → stop and report that the spec needs revision.
11. Run the plan's verification plus cheap checks directly implied by the changes.
12. Fix implementation-caused failures and rerun the relevant checks.

Finish concisely with:

- what changed;
- verification and results;
- deviations or remaining risks.

Do not expand scope.
Do not redesign the approved architecture to make implementation easier.
Do not claim success without fresh verification.

If creating a commit, add:

`Plan: plans/<project>/<NN>-<name>.md`
