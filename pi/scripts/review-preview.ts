// Representative terminal views for the human visual assessment of dev-review.
// Run: node pi/scripts/review-preview.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { type TUI } from "@earendil-works/pi-tui";
import { ReviewWorkspace } from "../lib/review-workspace.ts";
import { ReviewWorkspaceView } from "../review-workspace-ui.ts";
import { theme } from "../test/helpers/hub.ts";

const cwd = mkdtempSync(join(tmpdir(), "dev-review-preview-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const strip = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const terminal = { rows: 28, columns: 100 };
try {
  git("init", "-q", "-b", "main"); git("config", "user.name", "Preview"); git("config", "user.email", "preview@example.com");
  writeFileSync(join(cwd, "candidate"), "A reviewed local change.\n"); git("add", "."); git("commit", "-qm", "local candidate");
  const store = new ReviewWorkspace(cwd, join(cwd, ".git", "review.json")); await store.restore();
  const sections = [
    { id: "outcome", title: "Outcome / practical use", kind: "outcome" as const, body: "Before: a reviewer followed the agent's execution transcript to decide whether to accept a change.\nAfter: a separate local review surface starts with the decision, the evidence, and what remains uncertain.\nThe change is usable for a single engineering reviewer without reading the tool log." },
    { id: "rationale", title: "Why this design", kind: "design" as const, body: "The review state is anchored to the committed candidate and persisted independently of the terminal overlay. Closing the view never approves or stops the review.\nA pending update is previewed before applying, so new evidence cannot silently replace text while somebody is reading." },
    { id: "evidence", title: "Evidence and limits", kind: "evidence" as const, body: "Established: type checking and local tests pass for this candidate.\nAssumption: terminal key decoding is consistent with the installed Pi TUI.\nUnknown: whether this visual rhythm is comfortable in the reviewer's preferred terminal; human assessment is required." },
    { id: "risk", title: "Risk / narrow terminal", kind: "risk" as const, body: "At narrow widths the actions wrap and the reading area scrolls. Very short terminals cannot display a usable composer.\nMitigation: preserve drafts on resize and ask the reviewer to enlarge before composing." },
    { id: "architecture", title: "Architecture and ownership", kind: "system" as const, body: "ReviewWorkspace owns durable assessments, version-bound discussions and approval. ReviewWorkspaceView owns presentation, draft editing, keyboard and mouse navigation. The foreground review agent publishes contextual replies; Ship remains a separate local packaging operation." },
    { id: "code", title: "Relevant implementation", kind: "code" as const, body: "pi/lib/review-workspace.ts  /  compare the clean committed candidate against assessment fingerprint before approval.\npi/review-workspace-ui.ts  /  show update preview and explicit decision controls.\npi/lib/review-controller.ts  /  preserve foreground execution and route replies into the workspace." },
  ];
  await store.publish({ recommendation: "Approve only after inspecting the narrow-terminal tradeoff and assessing this interface yourself.", sections,
    decisions: [{ id: "terminal", subject: "Narrow terminal tradeoff", kind: "risk", recommendation: "Waive the short-terminal limitation", consequence: "At very short heights, enlarge the terminal to compose; existing drafts remain intact." }] });
  const tui = { terminal, requestRender() {} } as TUI;
  const view = new ReviewWorkspaceView(tui, theme, store, () => {}, () => {}, () => true);
  const ready = async (label = "Current candidate") => { for (let i = 0; i < 150 && !view.render(100).some(line => strip(line).includes(label)); i++) await new Promise(resolve => setTimeout(resolve, 20)); };
  const show = (name: string, width: number, height: number) => {
    terminal.rows = height; terminal.columns = width;
    console.log(`\n${"=".repeat(width)}\n${name} (${width} x ${height})\n${"=".repeat(width)}`);
    console.log(view.render(width).map(strip).join("\n"));
  };
  await ready();
  show("Opening assessment", 100, 28); show("Opening assessment / narrow", 42, 18);
  view.handleInput("\r"); show("Selected subject / deep detail", 100, 28);
  view.handleInput("\x1bOP"); // F1 help
  view.handleInput("\x1b");
  view.handleInput("\x1bOQ"); // F2 discussion
  store.state.discussions.push({ id: "human", author: "human", subject: "outcome", version: store.state.current!.version, text: "What if the candidate changes during approval?", status: "answered" });
  store.state.discussions.push({ id: "agent", author: "agent", subject: "outcome", version: store.state.current!.version, text: "Approval rechecks the committed candidate and rejects a mismatch." });
  show("Contextual discussion", 100, 28); show("Contextual discussion / narrow", 42, 18);
  await store.publish({ recommendation: "Revised assessment: keep the same review candidate but clarify the terminal limitation.", sections: sections.map(s => s.id === "risk" ? { ...s, body: `${s.body}\nUpdate: the composer stays disabled below a safe height; the saved draft is unaffected.` } : s),
    decisions: [{ id: "terminal", subject: "Narrow terminal tradeoff", kind: "risk", recommendation: "Waive the short-terminal limitation", consequence: "Enlarge the terminal to compose at very short heights." }] });
  view.handleInput("\x1bOS"); // F4 update preview
  show("Pending material update", 100, 28); show("Pending update / narrow", 42, 18);
  await store.applyUpdate(); await store.decide("terminal", "waived"); await ready("[Approve]");
  view.handleInput("\x1bOR"); // F3 decisions
  show("Disclosed waiver and approval gate", 100, 28); show("Decision / narrow", 42, 18);
  view.dispose();
} finally { rmSync(cwd, { recursive: true, force: true }); }
