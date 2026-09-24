import { Editor, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeText } from "./lib/worker-transcript.ts";
import { ReviewWorkspace, type ReviewSection } from "./lib/review-workspace.ts";

const clean = (s: string) => safeText(s).replace(/\r/g, "");
const fit = (s: string, width: number) => truncateToWidth(s, Math.max(1, width), "…");
type Screen = "assessment" | "detail" | "discussion" | "decisions" | "update" | "help" | "confirm";
type Hit = { y: number; x: number; end: number; action: () => void; body?: boolean };

/** The review's text is structured around engineering claims, never the execution transcript. */
export class ReviewWorkspaceView {
  private screen: Screen = "assessment";
  private prior: Screen = "assessment";
  private selected = 0;
  private scroll = 0;
  private hits: Hit[] = [];
  private editorBounds?: { y: number; height: number; from: number; width: number };
  private editor: Editor;
  private unsubscribe: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private focus: "content" | "composer" | "actions" = "content";
  private confirm?: { title: string; run: () => Promise<void> };
  private checking = false;
  private gate = "Checking candidate…";
  private canApprove = false;
  private decisionIndex = 0;
  private selectedAction = 0;
  private returnActionIndex = 0;
  private tabY = 2;
  private bodyBounds = { top: 4, bottom: 24 };
  private actions: Array<[string, () => void]> = [];
  private width = 80;
  private height = 24;
  private pendingSend = false;
  private tui: TUI;
  private theme: Theme;
  private store: ReviewWorkspace;
  private done: () => void;
  private send: (id: string, subject: string, text: string) => void;
  private active: () => boolean;
  constructor(tui: TUI, theme: Theme, store: ReviewWorkspace, done: () => void,
    send: (id: string, subject: string, text: string) => void, active: () => boolean) {
    this.tui = tui; this.theme = theme; this.store = store; this.done = done; this.send = send; this.active = active;
    const proxy = { terminal: tui.terminal || { rows: 24 }, requestRender: () => this.repaint() } as TUI;
    this.editor = new Editor(proxy, {
      borderColor: s => theme.fg("borderAccent", s),
      selectList: { selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s },
    }, { paddingX: 1 });
    this.editor.onChange = () => { this.store.state.drafts[this.subject()] = this.editor.getExpandedText(); void this.store.persist().catch(() => {}); };
    this.editor.onSubmit = text => { this.editor.setText(text); void this.submit(); };
    let observed = this.freshnessToken();
    this.unsubscribe = store.subscribe(() => {
      if (this.screen === "discussion" && !this.editor.getText().trim() && this.store.state.drafts[this.subject()]?.trim()) this.loadDraft();
      const next = this.freshnessToken();
      if (next !== observed) {
        observed = next; this.canApprove = false;
        this.gate = "Review paused · reassessing changed evidence";
        this.refresh();
      }
      this.repaint();
    });
    this.selected = store.state.selection === "general" ? -1 : Math.max(0, store.state.current?.sections.findIndex(s => s.id === store.state.selection) ?? 0);
    this.loadDraft(); this.refresh();
    this.timer = setInterval(() => this.refresh(), 1800); this.timer.unref();
  }
  private repaint() { if (!this.disposed) this.tui.requestRender(); }
  private freshnessToken() {
    const state = this.store.state;
    return `${state.current?.version || ""}:${state.pending?.version || ""}:${state.updates.length}:${state.current?.decisions.map(d => d.status).join(",") || ""}:${state.approval?.version || ""}`;
  }
  private refresh() {
    if (this.checking || this.disposed) return;
    if (!this.active()) for (const message of this.store.state.discussions.filter(m => m.author === "human" && m.status === "queued")) {
      void this.store.fail(message.id, "review goal no longer active").catch(() => {});
    }
    this.checking = true;
    const token = this.freshnessToken();
    void this.store.check().then(result => {
      if (token !== this.freshnessToken()) return;
      this.canApprove = result.current && !this.store.state.current?.decisions.some(d => d.status === "open");
      this.gate = result.current ? this.store.state.approval ? "Approved for this candidate · no shipping action taken" : this.canApprove ? "Current candidate · ready for explicit approval" : "Current candidate · resolve disclosed decisions before approval" : `Review paused · ${result.reason}`;
      if (this.store.state.approval && this.store.state.approval.fingerprint !== result.candidate.fingerprint) this.gate = "Candidate changed after approval · previous approval is historical";
    }).catch(error => { this.canApprove = false; this.gate = `Candidate unavailable · ${String(error)}`; }).finally(() => {
      this.checking = false;
      if (token !== this.freshnessToken()) this.refresh();
      this.repaint();
    });
  }
  private sections() { return this.store.state.current?.sections || []; }
  private subject() { return this.sections()[this.selected]?.id || "general"; }
  private section() { return this.sections()[this.selected]; }
  private loadDraft() { this.editor.setText(this.store.state.drafts[this.subject()] || ""); this.editor.focused = this.focus === "composer"; }
  private select(index: number) {
    const sections = this.sections(); if (index < -1 || index >= sections.length) return;
    this.store.state.drafts[this.subject()] = this.editor.getExpandedText(); this.selected = index;
    this.store.state.selection = this.subject(); this.scroll = this.store.state.scroll[`${this.screen}:${this.subject()}`] || 0;
    this.loadDraft(); void this.store.persist().catch(() => {});
  }
  private changeScreen(next: Screen) { this.screen = next; this.scroll = this.store.state.scroll[`${next}:${this.subject()}`] || 0; this.editor.focused = this.focus === "composer" && next === "discussion"; this.repaint(); }
  private notice(text: string) { this.store.state.notice = text; void this.store.persist().catch(() => {}); }
  private async action(run: () => Promise<void>) { try { await run(); this.refresh(); } catch (error) { this.notice(error instanceof Error ? error.message : String(error)); } this.repaint(); }
  private async submit() {
    if (this.pendingSend || !this.active()) { this.notice("Review agent unavailable. Draft retained; reopen or resume the review goal."); return; }
    const text = this.editor.getExpandedText(); if (!text.trim()) return;
    this.pendingSend = true;
    try {
      const subject = this.subject(); const message = await this.store.addHuman(subject, text);
      try { this.send(message.id, subject, text); this.editor.addToHistory(text); this.editor.setText(""); this.notice("Request submitted. Await a contextual reply here; interrupted requests are never replayed."); }
      catch (error) { await this.store.fail(message.id, String(error)); }
    } catch (error) { this.notice(`Not submitted: ${String(error)}`); }
    finally { this.pendingSend = false; this.repaint(); }
  }
  private requestApproval() {
    this.confirm = { title: "Approve the current clean, assessed local candidate and disclosed risks? This does not publish or ship.", run: () => this.store.approve() };
    this.returnActionIndex = this.selectedAction;
    this.prior = this.screen; this.changeScreen("confirm");
  }
  private decision(status: "accepted" | "waived") {
    const d = this.store.state.current?.decisions[this.decisionIndex]; if (!d || d.status !== "open") { this.notice("Select an open decision on this assessment."); return; }
    this.confirm = { title: `${status === "waived" ? "WAIVE RISK" : "Accept recommendation"}: ${d.subject}. ${d.consequence}`, run: async () => {
      await this.store.decide(d.id, status);
      const next = this.store.state.current?.decisions.findIndex(item => item.status === "open") ?? -1;
      if (next >= 0) this.decisionIndex = next;
      this.selectedAction = 2;
    } };
    this.returnActionIndex = this.selectedAction;
    this.prior = this.screen; this.changeScreen("confirm");
  }
  private dismiss() { if (this.screen === "confirm") this.selectedAction = this.returnActionIndex; if (this.screen === "confirm" || this.screen === "help") this.changeScreen(this.prior); else if (this.screen !== "assessment") this.changeScreen("assessment"); else this.done(); }
  handleInput(data: string) {
    if (matchesKey(data, "escape")) { if (this.focus === "composer") { this.focus = "content"; this.editor.focused = false; this.repaint(); } else this.dismiss(); return; }
    if (this.screen === "confirm") {
      if (matchesKey(data, "return") || matchesKey(data, "y")) { const run = this.confirm?.run; this.selectedAction = this.returnActionIndex; this.changeScreen(this.prior); if (run) void this.action(run); }
      else if (matchesKey(data, "n")) { this.selectedAction = this.returnActionIndex; this.changeScreen(this.prior); }
      return;
    }
    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      const order = ["content", "composer", "actions"] as const;
      const delta = matchesKey(data, "tab") ? 1 : 2;
      this.focus = order[(order.indexOf(this.focus) + delta) % 3]!;
      if (this.focus === "composer" && this.height < 13) { this.focus = "actions"; this.notice("Enlarge the terminal to compose a readable message."); }
      if (this.focus === "composer") this.changeScreen("discussion");
      this.editor.focused = this.focus === "composer"; this.repaint(); return;
    }
    if (this.focus === "composer" && this.screen === "discussion") {
      if (this.height < 13) { this.notice("Enlarge the terminal before editing a draft."); return; }
      if (matchesKey(data, "ctrl+return")) { void this.submit(); return; }
      this.editor.handleInput(data); this.repaint(); return;
    }
    if (this.focus === "actions" && (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "up") || matchesKey(data, "down"))) {
      this.render(this.width);
      this.selectedAction = Math.max(0, Math.min(this.actions.length - 1, this.selectedAction + (matchesKey(data, "left") || matchesKey(data, "up") ? -1 : 1)));
      this.repaint(); return;
    }
    if (this.focus === "actions" && matchesKey(data, "return")) { this.render(this.width); this.actions[this.selectedAction]?.[1](); this.repaint(); return; }
    if (matchesKey(data, "g")) { this.select(-1); this.changeScreen("discussion"); return; }
    if (matchesKey(data, "f1") || matchesKey(data, "?")) { this.prior = this.screen; this.changeScreen("help"); return; }
    if (matchesKey(data, "f2")) { this.changeScreen("discussion"); return; }
    if (matchesKey(data, "f3")) { this.changeScreen("decisions"); return; }
    if (matchesKey(data, "f4")) { if (this.store.state.pending) this.changeScreen("update"); return; }
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      const delta = matchesKey(data, "up") ? -1 : 1;
      if (this.screen === "assessment") this.select(this.selected + delta);
      else if (this.screen === "decisions") { this.decisionIndex = Math.max(0, Math.min((this.store.state.current?.decisions.length || 1) - 1, this.decisionIndex + delta)); this.scrollBy(delta); }
      else this.scrollBy(delta);
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) this.scrollBy(matchesKey(data, "pageUp") ? -8 : 8);
    else if (matchesKey(data, "return") && this.screen === "assessment") this.changeScreen("detail");
    else if (matchesKey(data, "left")) this.select(this.selected - 1);
    else if (matchesKey(data, "right")) this.select(this.selected + 1);
    this.repaint();
  }
  private scrollBy(n: number) { this.scroll = Math.max(0, this.scroll + n); this.store.state.scroll[`${this.screen}:${this.subject()}`] = this.scroll; void this.store.persist().catch(() => {}); }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      if (event.y < this.bodyBounds.top || event.y >= this.bodyBounds.bottom) return;
      this.scrollBy((event.wheelDelta || 0) * 3); this.repaint(); return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left") return;
    const b = this.editorBounds;
    if (b && event.y >= b.y && event.y < b.y + b.height) {
      this.focus = "composer"; this.editor.focused = true;
      this.editor.handleMouse?.({ ...event, y: event.y - b.y + b.from, width: b.width, height: b.height }); this.repaint(); return { handled: true, focus: true };
    }
    const hit = this.hits.find(h => h.y === event.y && event.x >= h.x && event.x < h.end);
    if (!hit) return;
    this.focus = hit.body || hit.y === this.tabY ? "content" : "actions";
    hit.action(); this.repaint(); return { handled: true, focus: true };
  }
  private button(label: string, y: number, x: number, action: () => void, available: number) {
    const text = `[${label}]`;
    if (y >= 0 && x + visibleWidth(text) <= available) this.hits.push({ y, x, end: x + visibleWidth(text), action });
    return text;
  }
  private lines(text: string, width: number) {
    return clean(text).split("\n").flatMap(line => {
      const indent = Math.min(width > 16 ? 8 : 2, line.match(/^ */)?.[0].length || 0);
      return wrapTextWithAnsi(line.slice(indent) || " ", Math.max(1, width - indent)).map(part => " ".repeat(indent) + part);
    });
  }
  private content(width: number) {
    const assessment = this.store.state.current;
    if (!assessment) return ["", this.theme.bold("  A quiet space for an engineering decision"), "", "  The review agent is preparing the outcome, evidence and risks.", "  Questions can be composed from Discussion once the review goal is active."];
    const section = this.section();
    if (this.screen === "assessment") {
      const lines = ["", ...this.lines(`  ${assessment.recommendation}`, width).map(line => this.theme.bold(line)), "", this.theme.fg("muted", "  ASSESSMENT  ·  select a subject for context and deeper evidence"), ""]; 
      for (const [i, s] of assessment.sections.entries()) {
        const flag = this.store.state.pending?.sections.some(p => p.id === s.id && p.body !== s.body) ? "  UPDATED" : "";
        const title = `  ${i === this.selected ? "›" : " "}  ${clean(s.title)}${flag}`;
        const y = lines.length;
        this.hits.push({ y, x: 0, end: width, body: true, action: () => { this.select(i); if (this.screen === "assessment") this.changeScreen("detail"); } });
        lines.push(i === this.selected ? this.theme.fg("accent", this.theme.bold(title)) : title);
        lines.push(...this.lines(`       ${clean(s.body).replace(/\n.*/s, "")}`, Math.max(1, width - 2)).slice(0, 2).map(l => this.theme.fg("muted", l)));
        lines.push("");
      }
      return lines;
    }
    if (this.screen === "detail") return ["", this.theme.fg("muted", `  ${section?.kind.toUpperCase() || "SUBJECT"}  /  ${clean(section?.title || "General")}`), "", ...this.lines(`  ${section?.body || "No detail yet."}`, width - 2), "", this.theme.fg("muted", "  Discuss this subject from the Discussion tab. Older discussion stays attached to its version.")];
    if (this.screen === "discussion") {
      const messages = this.store.state.discussions.filter(m => m.subject === this.subject());
      return ["", this.theme.bold(`  Discussion  /  ${clean(section?.title || "General")}`), this.theme.fg("muted", "  Context stays with this subject and assessment version."), "",
        ...(messages.length ? messages.flatMap(m => [this.theme.fg(m.version === assessment.version ? m.author === "human" ? "accent" : "success" : "muted", `  ${m.author === "human" ? "You" : "Review"} · ${m.version === assessment.version ? "current" : `EARLIER ASSESSMENT ${m.version.slice(0, 8)}`}${m.status ? ` · ${m.status}` : ""}`),
          ...this.lines(`  ${m.text}`, width - 2), ""]) : [this.theme.fg("muted", "  No discussion on this subject yet. Ask, challenge, or request a change below.")])];
    }
    if (this.screen === "decisions") {
      const lines = ["", this.theme.bold("  Decisions & disclosed risk"), ""];
      assessment.decisions.forEach((d, i) => {
        this.hits.push({ y: lines.length, x: 0, end: width, body: true, action: () => { this.decisionIndex = i; this.repaint(); } });
        lines.push(this.theme.fg(d.status === "open" ? "warning" : "success", `  ${i === this.decisionIndex ? "›" : " "}  ${this.gate.startsWith("Review paused") ? "HISTORICAL · " : ""}${d.status.toUpperCase()}  ${clean(d.subject)}`), ...this.lines(`  Recommendation: ${d.recommendation}`, width - 2), ...this.lines(`  Consequence: ${d.consequence}`, width - 2), "");
      });
      return [...lines, ...(assessment.decisions.length ? [] : ["  No consequential decisions outstanding."])];
    }
    if (this.screen === "update") {
      const pending = this.store.state.pending;
      return ["", this.theme.bold("  Proposed assessment update"), "", this.theme.fg("muted", `  Candidate: ${pending?.candidate.head.slice(0, 12) || "unknown"}`),
        this.theme.fg("warning", "  Applying this update resets approval and opens consequential decisions."), "",
        ...[...(pending?.sections || []).filter(next => assessment.sections.find(s => s.id === next.id)?.body !== next.body),
          ...(pending?.sections || []).filter(next => assessment.sections.find(s => s.id === next.id)?.body === next.body)].flatMap(next => {
          const old = assessment.sections.find(s => s.id === next.id);
          return [this.theme.fg(old?.body === next.body ? "muted" : "accent", `  ${old?.body === next.body ? "UNCHANGED" : old ? "CHANGED" : "NEW"}  ${clean(next.title)}`),
            ...(old?.body === next.body ? [] : [...(old ? this.lines(`    Before: ${old.body.replace(/\n/g, "\n    ")}`, width - 4) : []), ...this.lines(`    After: ${next.body.replace(/\n/g, "\n    ")}`, width - 4)]), ""];
        }), this.theme.fg("muted", `  Recommendation: ${clean(pending?.recommendation || "")}`)];
    }
    if (this.screen === "help") return ["",  this.theme.bold("  Review workspace"), "", "  Read the outcome first. Enter opens a subject; Discussion keeps", "  questions and replies with that subject and assessment version.", "", "  Tab / Shift+Tab move between reading, composing and actions.", "  ↑ ↓ select subjects or scroll; PgUp / PgDn scroll details.", "  F2 discussion  ·  F3 decisions  ·  F4 apply pending update", "  Enter sends a draft; Shift+Enter adds a line; Esc leaves it.", "  Click tabs or subjects; wheel scrolls the reading pane.", "  Approval is a confirmed action, never inferred from closing."];
    return ["", this.theme.bold("  Confirm decision"), "", ...this.lines(`  ${this.confirm?.title || ""}`, width - 2), "", "  Enter / Y confirms · N / Esc cancels"]; 
  }
  render(width: number): string[] {
    this.width = Math.max(1, width); this.height = Math.max(1, this.tui.terminal?.rows || process.stdout.rows || 24);
    this.hits = []; delete this.editorBounds;
    const narrow = width < 76;
    const row = (text: string) => fit(text, width);
    const header = [this.theme.fg("accent", this.theme.bold(row("  REVIEW  /  engineering assessment"))),
      ...this.lines(`  ${this.gate}`, width).map(line => this.theme.fg("muted", line))];
    const tabs: Array<[string, Screen]> = [["Overview", "assessment"], ["Detail", "detail"], ["Discussion", "discussion"], ["Decisions", "decisions"]];
    let tabLine = "  ";
    this.tabY = header.length;
    for (const [name, screen] of tabs) {
      const label = narrow && name === "Discussion" ? "Talk" : name;
      if (visibleWidth(tabLine) + label.length + 3 > width) break;
      const x = visibleWidth(tabLine); tabLine += this.button(label, header.length, x, () => this.changeScreen(screen), width) + " ";
    }
    header.push(row(tabLine), "");
    const footer: string[] = [];
    const footerActions: Array<[string, () => void]> = [];
    const buttonRow = (items: Array<[string, () => void]>) => {
      this.actions = items;
      this.selectedAction = Math.min(this.selectedAction, Math.max(0, items.length - 1));
      let line = "  ";
      items.forEach(([label, action], i) => {
        if (visibleWidth(line) + label.length + 4 > width && line.trim()) { footer.push(row(line)); line = "  "; }
        line += `${this.focus === "actions" && i === this.selectedAction ? "›" : ""}[${label}] `;
        footerActions.push([label, action]);
      });
      if (line.trim()) footer.push(row(line));
    };
    if (this.screen === "confirm") buttonRow([["Confirm", () => { const run = this.confirm?.run; this.selectedAction = this.returnActionIndex; this.changeScreen(this.prior); if (run) void this.action(run); }], ["Cancel", () => { this.selectedAction = this.returnActionIndex; this.changeScreen(this.prior); }]]);
    else buttonRow([["Ask / change", () => {
      this.changeScreen("discussion");
      if (this.height < 13) { this.focus = "actions"; this.notice("Enlarge the terminal before composing. Your draft is retained."); }
      else { this.focus = "composer"; this.editor.focused = true; }
    }], ["General", () => { this.select(-1); this.changeScreen("discussion"); }],
      ...(this.store.state.pending ? [[this.screen === "update" ? "Apply update" : "View update", () => this.screen === "update" ? void this.action(async () => { await this.store.applyUpdate(); this.changeScreen("assessment"); }) : this.changeScreen("update")] as [string, () => void]] : []),
      ...(this.screen === "decisions" && this.gate.startsWith("Current candidate") && this.store.state.current?.decisions[this.decisionIndex]?.status === "open" ? [["Accept", () => this.decision("accepted")], ...(this.store.state.current?.decisions[this.decisionIndex]?.kind === "risk" ? [["Waive risk", () => this.decision("waived")] as [string, () => void]] : [])] as Array<[string, () => void]> : []),
      ...(this.canApprove ? [["Approve", () => this.requestApproval()] as [string, () => void]] : []), ["Help", () => { this.prior = this.screen; this.changeScreen("help"); }], ["Close", () => this.done()]]);
    footer.push(this.theme.fg("muted", row(narrow ? "  F2 talk · F3 decide · Esc back" : "  ↑↓ select / scroll  ·  Enter detail  ·  Tab focus  ·  F2 talk  ·  F3 decisions  ·  Esc back")));
    const noticeLines = this.store.state.notice ? this.lines(`  ${this.store.state.notice}`, width) : [];
    const note = (noticeLines.length > 2 ? [noticeLines[0]!, fit(`${noticeLines[1]} …`, width)] : noticeLines).map(line => this.theme.fg("warning", line));
    const composer = this.screen === "discussion" && this.height >= 13 ? this.editor.render(Math.max(1, width - 2)).slice(0, this.height < 20 ? 2 : Math.min(5, Math.floor(this.height / 4))) : [];
    if (composer.length) footer.unshift(...composer.map(l => ` ${fit(l, width - 1)}`), this.theme.fg("muted", row("  Enter send · Shift+Enter newline · Esc keep draft")));
    const capacity = Math.max(0, this.height - header.length - footer.length - note.length);
    this.bodyBounds = { top: header.length, bottom: header.length + capacity };
    const content = this.content(width);
    this.scroll = Math.min(this.scroll, Math.max(0, content.length - capacity));
    const body = content.slice(this.scroll, this.scroll + capacity);
    while (body.length < capacity) body.push("");
    const footerY = header.length + capacity + note.length;
    for (const hit of this.hits) if (hit.body) hit.y = header.length + hit.y - this.scroll;
    for (const [label, action] of footerActions) {
      const token = `[${label}]`;
      for (let i = 0; i < footer.length; i++) {
        const x = footer[i]!.indexOf(token);
        if (x >= 0) { this.hits.push({ y: footerY + i, x, end: x + token.length, action }); break; }
      }
    }
    if (composer.length) this.editorBounds = { y: footerY, height: composer.length, from: 0, width: Math.max(1, width - 2) };
    return [...header, ...body, ...note, ...footer].slice(0, this.height).map(line => fit(line, width));
  }
  invalidate() { this.editor.invalidate(); }
  dispose() { this.disposed = true; if (this.timer) clearInterval(this.timer); this.unsubscribe(); this.editor.focused = false; void this.store.persist().catch(() => {}); }
}
