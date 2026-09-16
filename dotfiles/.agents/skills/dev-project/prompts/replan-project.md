# Repair a material execution-plan defect
Dispatch `planner` with `fork_turns="none"` only for a recorded dependency/interface/strategy contradiction.

Read [SPEC_FILE], [PLAN_FILE], the affected rows of [PROGRESS_FILE], and [DEFECT_EVIDENCE]. Worktree/HEAD: [REPO] / [HEAD_SHA]. Affected task IDs: [TASK_IDS].

Resolve this defect from current source truth, preserving unaffected text and still-valid accepted work. Do not restart repository discovery or rewrite the whole project. A command correction or size-only issue is not a material replan: return it to its owner. Never change semantics or reset repair history. Return READY with the plan path, or the precise missing decision.
