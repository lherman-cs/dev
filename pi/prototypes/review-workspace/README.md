# Discussion-first review workspace · design preview

A standalone, clickable design exploration for `plans/dev/spec.md`. This is **sample content**, not the Spec or Review application. No requests reach the agent or the workspace; sample decisions and comment delivery remain local to this page and reset on reload.

From the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory pi/prototypes/review-workspace
```

Open `http://127.0.0.1:8765/`. Inspect in light mode first, then use the moon button for dark mode. Resize below 850px and then below 540px to try the topic-to-context drill-in and return path. The prototype has no network dependencies, aside from the local HTTP server; it bundles its font.

Suggested route: inspect the proposed revision, compare it with r03, apply it (not approval), open the choice topic, compare alternatives, record a sample choice, switch among the six evidence canvases, add a comment to review, observe the older-anchor recheck after applying r04, resolve/reopen a topic, and inspect the review submission. Native buttons, dialog and textarea support keyboard operation. Full spec is a representative reading destination rather than the real document. Nothing here asserts a real review outcome or publishes an artifact.

**Boundary:** This preview is intentionally isolated. Integration, persistence, real revision gates, and evidence publication are to be implemented only after human design-direction review.
