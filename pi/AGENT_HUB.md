# Agent Hub

The main Pi conversation is home. `Alt+A` opens one hub for registered child sessions. Opening, inspecting, searching, copying, steering, and stopping are native actions and never invoke a model or restart a completed worker.

The hub is for child-session work only. Skills own phase semantics and any parent-level decisions. Main cannot modify the worktree while an active writing child owns it. Stop the child or wait for completion before editing. Parent session switches and forks are blocked while active child work exists.

Each thread keeps an independent draft and scroll position. F2 exposes child actions, including a confirmation-protected stop. Completed results stay inspectable and read-only. A related investigation is a fresh, read-only Explorer and never changes an earlier result.
