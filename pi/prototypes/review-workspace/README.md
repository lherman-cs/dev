# Decision-first engineering review · isolated design preview

A clickable, **sample-only** exploration for [`plans/dev/spec.md`](../../../plans/dev/spec.md). It is not the real Spec or Review application. Nothing here publishes an artifact, contacts the agent, approves real work, or changes the workspace.

From the repository root:

```sh
npm ci --prefix pi/prototypes/review-workspace
npm run dev --prefix pi/prototypes/review-workspace -- --port 8766
```

Open **http://127.0.0.1:8766/**. This isolated React/Vite preview uses Material UI and community MUI X Charts and Data Grid. The bundled font and sample data need no remote service. The package is separate from the Pi application.

## Try the core review loop

1. Start in **Spec**. There is one current human decision, a recommendation distinguished from your choice, a minimal visual model, and a concrete finish line. Choose an alternative and **Record decision & continue**. The next unresolved item appears automatically.
2. On a decision, open **Why?**, **How does this work?**, **Show evidence**, **Show code**, or **Ask the agent**. Each deeper view returns to the same decision; an illustrative anchored reply never makes the decision for you.
3. Inspect sample r04, then explicitly apply it. Applying is not approving. The **Submit review** dialog still requires a separate exact-target outcome.
4. Switch to **Implementation review** using the small left rail. Work through the anchor-drift finding and evidence gap. A choice requesting a fix remains an approval blocker; a risk waiver needs confirmation.
5. Open **See all items** or the rail queue only when needed. The full artifact is a subordinate reference, not the default landing page. Use **J/K** to move between items and **Cmd/Ctrl+K** to search.
6. Try wide and narrow windows in light and dark modes. On narrow screens, deeper context takes focus with a clear return to the current decision.

Sample choices, revision inspection/application state and topic drafts persist in this browser's local storage; discussion and navigation reset on reload. Clear this origin's site data to restart the walkthrough.

**Boundary:** This is a direction prototype, not proof of integrated authority or acceptance. Diagrams, source excerpts, checks and agent responses are illustrative. The working app must retain its existing revision, local-origin, recovery and human-approval gates when and only when this direction is accepted.
