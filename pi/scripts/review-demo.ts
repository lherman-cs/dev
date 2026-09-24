// Interactive, disposable walkthrough for human assessment of the terminal review UI.
// Run in a separate terminal: node pi/scripts/review-demo.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { ReviewWorkspace } from "../lib/review-workspace.ts";
import { ReviewWorkspaceView } from "../review-workspace-ui.ts";
import { theme } from "../test/helpers/hub.ts";

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Open this walkthrough in an interactive terminal.");
const cwd = mkdtempSync(join(tmpdir(), "review-walkthrough-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
let tui: TuiAltScreen | undefined;
let view: ReviewWorkspaceView | undefined;
try {
  git("init", "-q", "-b", "main"); git("config", "user.name", "Preview"); git("config", "user.email", "preview@example.com");
  writeFileSync(join(cwd, "candidate"), "A local, clean review candidate.\n"); git("add", "."); git("commit", "-qm", "sample candidate");
  const store = new ReviewWorkspace(cwd, join(cwd, ".git", "review.json")); await store.restore();
  const sections = [
    { id: "outcome", title: "Practical outcome", kind: "outcome" as const, body: "Before: a reviewer needed the agent's execution transcript to understand the result.\nAfter: a separate, calm review surface leads with the outcome, supporting evidence, and a decision.\nTry discussing a subject. Send a request containing ‘update’ to preview an assessment change. This sample never approves or ships your project." },
    { id: "design", title: "Design rationale", kind: "design" as const, body: "Persistent assessment data is separate from the TUI. The user can close the view while the agent continues working; later updates remain pending until explicitly applied." },
    { id: "evidence", title: "Evidence and limits", kind: "evidence" as const, body: "Established: local type checking and automated tests exercise the review model and interface.\nAssumption: installed terminal key mappings behave consistently.\nUnknown: your judgment of visual quality and interaction comfort. Please inspect both a wide and a narrow terminal." },
    { id: "risk", title: "Risk / small viewport", kind: "risk" as const, body: "Actions wrap on narrow terminals. The reading pane scrolls, but very short terminals cannot provide a usable editor.\nMitigation: drafts remain intact when you resize and the editor asks you to enlarge the terminal." },
    { id: "system", title: "Architecture and ownership", kind: "system" as const, body: "ReviewWorkspace binds evidence, versions, discussion, and approval to the local candidate. ReviewWorkspaceView owns navigation, display, and input. Review controller connects the foreground agent; Ship stays separate." },
    { id: "code", title: "Relevant code", kind: "code" as const, body: "pi/lib/review-workspace.ts: candidate and approval checks.\npi/review-workspace-ui.ts: workspace interaction and rendering.\npi/lib/review-controller.ts: Pi integration and contextual replies." },
  ];
  const decisions = [{ id: "small-terminal", subject: "Very short terminal", kind: "risk" as const, recommendation: "Waive the short-terminal limitation", consequence: "Enlarge the terminal before composing at very short heights; saved drafts are retained." }];
  await store.publish({ sections, decisions, recommendation: "Assess the interface yourself; then decide whether the disclosed small-terminal limit is acceptable." });
  tui = new TuiAltScreen(new ProcessTerminal(), false, undefined, { mouse: true });
  const ui = tui;
  await new Promise<void>(resolve => {
    view = new ReviewWorkspaceView(ui, theme, store, () => resolve(), (id, _subject, text) => {
      void (async () => {
        if (/update|change/i.test(text)) await store.publish({ sections: sections.map(s => s.id === "risk" ? {
          ...s, body: `${s.body}\nUpdated: the composer is disabled at very short heights, with the saved draft preserved.`,
        } : s), decisions, recommendation: "Updated assessment: preview the changed risk before deciding." });
        await store.answer(id, `Sample agent reply: “${text}” was received. This is a local walkthrough, not real investigation.`);
      })().catch(error => { void store.fail(id, String(error)); });
    }, () => true);
    ui.addChild(view); ui.setFocus(view); ui.start();
  });
} finally {
  view?.dispose(); tui?.stop(); rmSync(cwd, { recursive: true, force: true });
}
