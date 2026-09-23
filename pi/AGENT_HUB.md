# Agent Hub

The main Pi conversation is home. `Alt+A` opens one hub for registered child sessions. Opening, inspecting, searching, copying, steering, and stopping are native actions and never invoke a model or restart a completed worker.

The hub is for read-only child-session evidence, not ownership or phase decisions. The main agent remains the sole writing owner of its worktree. Session changes stop active child work without blocking the owner; interrupted child history is not an obligation to resume.

Each thread keeps an independent draft and scroll position. F2 exposes child actions, including a confirmation-protected stop. Completed results stay inspectable and read-only. A related investigation is a fresh, read-only Explorer and never changes an earlier result.
