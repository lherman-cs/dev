# Agent Hub

The main Pi conversation is home. `Alt+A` opens one hub for registered child sessions and Verifier runs. Opening, inspecting, searching, copying, and stopping are native actions; steering applies only to agents. These actions never invoke a model or restart a completed worker.

The hub is for child-session evidence and read-only Verifier runs, not ownership or phase decisions. Verifier threads show commands and live output, with full retained log and evidence paths in the details. They can be stopped, searched, copied, and inspected after completion or session restoration, but not steered. The main agent remains the sole writing owner of its worktree. Session changes stop active work without blocking the owner; interrupted history is not an obligation to resume.

Each thread keeps an independent draft and scroll position. F2 exposes child actions, including a confirmation-protected stop. Completed results stay inspectable and read-only. A related investigation is a fresh, read-only Explorer and never changes an earlier result.
