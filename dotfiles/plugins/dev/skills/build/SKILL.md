---

name: build
description: Implement a given specification faithfully. Use when the user provides a spec or implementation plan and wants it built
-------------------------------------------------------------------------------------------------------------------------------------

# Build

Implement the given specification.

Treat the specification as authoritative. Inspect the codebase as needed to understand how to implement it, but do not make assumptions that change or extend the specification.

Implement routine details yourself when they are consistent with the specification.

If you discover that continuing would require deviating from the specification, changing a requirement, or choosing between materially different interpretations that the specification does not resolve, stop before making that change and ask the user.

Do not silently substitute what you think is a better design.

## Checkpoints

Break the implementation into coherent checkpoints.

At each checkpoint:

1. Complete and validate the current coherent unit of work.
2. Create a descriptive commit that clearly explains what changed.
3. Summarize the checkpoint and the validation performed.
4. Stop and ask the user to confirm before continuing to the next checkpoint.

Do not continue past a checkpoint without explicit user confirmation.

Keep commits focused and descriptive. Do not mix unrelated work into the same commit.

Before completing, compare the implementation against the specification and verify that it matches.
