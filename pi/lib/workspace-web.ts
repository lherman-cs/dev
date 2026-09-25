import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import type { ReviewWorkspace } from "./review-workspace.ts";
import type { SpecWorkspace } from "./spec-workspace.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Target = { phase: "spec"; store: SpecWorkspace; active: () => boolean; send: (id: string, subject: string, text: string, version: string) => void; project: string } |
  { phase: "review"; store: ReviewWorkspace; active: () => boolean; send: (id: string, subject: string, text: string, version: string) => void; project: string };
const assets = join(import.meta.dirname, "../web/dist");
/** One loopback-only service per Pi instance. Session switches rotate the unguessable URL. */
export class WorkspaceWeb {
  private server?: Server;
  private token = randomBytes(32).toString("hex");
  private port = 0;
  private target?: Target;
  private work: Promise<unknown> = Promise.resolve();
  async open(target: Target): Promise<string> {
    if (this.target?.store !== target.store) this.token = randomBytes(32).toString("hex");
    this.target = target;
    if (!this.server) {
      const server = createServer((req, res) => { void this.handle(req, res).catch(error => {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: String(error) })); }
        else res.end();
      }); });
      try {
        await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => { server.off("error", fail); ok(); }); });
        this.server = server;
        this.port = (server.address() as { port: number }).port;
      } catch (error) { server.close(); throw error; }
    }
    return this.url();
  }
  url() { return `http://127.0.0.1:${this.port}/${this.token}/`; }
  invalidate() { delete this.target; this.token = randomBytes(32).toString("hex"); }
  private async handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
    const origin = `http://127.0.0.1:${this.port}`;
    const path = req.url || "";
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };
    const deny = (code: number, message: string) => { res.writeHead(code, { ...headers, "Content-Type": "application/json" }); res.end(JSON.stringify({ error: message })); };
    if (req.headers.host !== `127.0.0.1:${this.port}` || !this.target || !path.startsWith(`/${this.token}/`)) return deny(403, "Workspace unavailable");
    const route = path.slice(this.token.length + 2).split("?")[0] || "";
    if (req.method === "GET") {
      if (route === "" || route === "app.js" || /^assets\/[\w.-]+\.(?:js|css|woff2?)$/.test(route)) {
        const name = route || "index.html";
        let content: Buffer;
        try { content = await readFile(join(assets, name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return deny(503, "Web assets are not built; run npm --prefix web run build in pi/"); throw error; }
        const mime = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".woff2") ? "font/woff2" : name.endsWith(".woff") ? "font/woff" : "text/html";
        res.writeHead(200, { ...headers, "Content-Type": `${mime}; charset=utf-8`,
          "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
        return res.end(content);
      }
      if (route !== "state") return deny(404, "Not found");
      const target = this.target;
      const check = await target.store.check();
      const promptVersions = target.phase === "spec" ? target.store.state.promptVersions : undefined;
      res.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ phase: target.phase, project: target.project, path: target.phase === "spec" ? target.store.path : target.store.cwd, workspace: target.store.file,
        state: target.store.state, gate: check.reason, canApprove: check.current && !target.store.state.current?.decisions.some(d => d.status === "open") && !target.store.state.discussions.some(m => m.author === "human" && m.status === "queued" && (m.version === target.store.state.current?.version || target.phase === "spec" && (m.version === "unassessed" || promptVersions?.includes(m.version)))), active: target.active() }));
    }
    if (req.method !== "POST" || route !== "action") return deny(404, "Not found");
    if (req.headers.origin !== origin || req.headers["content-type"]?.split(";")[0] !== "application/json" || req.headers["x-workspace-request"] !== this.token) return deny(403, "Unauthorized origin or request");
    let raw = "";
    for await (const part of req) { raw += part; if (raw.length > 128_000) return deny(413, "Request too large"); }
    let payload: { action?: string; version?: string; id?: string; status?: "accepted" | "waived"; subject?: string; text?: string };
    try { payload = JSON.parse(raw); } catch { return deny(400, "Invalid JSON"); }
    const target = this.target;
    const execute = async () => {
      if (target !== this.target) throw new Error("Workspace changed; reopen its URL");
      const store = target.store;
      const version = store.state.current?.version || (target.phase === "spec" ? target.store.state.prompt?.decision.version : undefined) || "unassessed";
      if (payload.version !== version) throw new Error("Displayed revision is stale; inspect the update first");
      if (payload.action === "draft") {
        if (typeof payload.subject !== "string" || typeof payload.text !== "string" || payload.text.length > 20000) throw new Error("Invalid draft");
        store.state.drafts[payload.subject] = payload.text; await store.persist();
      } else if (payload.action === "submit") {
        if (!target.active()) throw new Error("Agent unavailable; draft retained. Resume the goal to submit.");
        if (typeof payload.subject !== "string" || typeof payload.text !== "string" || !payload.text.trim()) throw new Error("Write a request first");
        const message = await store.addHuman(payload.subject, payload.text);
        try { target.send(message.id, payload.subject, payload.text, version); store.state.drafts[payload.subject] = ""; await store.persist(); }
        catch (error) { await store.fail(message.id, String(error)); throw error; }
      } else if (payload.action === "request_changes") {
        if (!target.active()) throw new Error("Agent unavailable; draft retained. Resume the goal to request changes.");
        if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 20000) throw new Error("Summarize the requested changes first");
        const subject = typeof payload.subject === "string" && store.state.current?.decisions.some(d => d.id === payload.subject) ? payload.subject : "general";
        const message = await store.addHuman(subject, `Changes requested: ${payload.text}`);
        try {
          await store.requestChanges(message.id);
          target.send(message.id, subject, message.text, version);
          store.state.drafts["general"] = ""; await store.persist();
        } catch (error) { await store.fail(message.id, String(error)); throw error; }
      } else if (payload.action === "apply") await store.applyUpdate();
      else if (payload.action === "decide") {
        if (!target.active()) throw new Error("Agent unavailable; resume the goal before deciding");
        if (!payload.id) throw new Error("Choose a decision");
        if (target.phase === "spec") {
          if (payload.status !== "accepted") throw new Error("Invalid Spec decision");
          const prompt = !target.store.state.current ? target.store.state.prompt?.decision : undefined;
          const decision = prompt || target.store.state.current?.decisions.find(d => d.id === payload.id);
          if (!decision || decision.id !== payload.id || decision.status !== "open") throw new Error("Decision not open on displayed revision");
          if (!prompt) {
            const check = await target.store.check();
            if (!["Current spec", "Resolve consequential decisions"].includes(check.reason)) throw new Error(`${check.reason}. Displayed revision may be stale.`);
          }
          const message = await target.store.addHuman(payload.id, `Accepted recommendation: ${decision.recommendation}. Reflect this consequential decision in the durable spec before approval.`);
          try { target.send(message.id, message.subject, message.text, version); }
          catch (error) { await target.store.fail(message.id, String(error)); throw error; }
          if (prompt) { prompt.status = "accepted"; await target.store.persist(); }
          else await target.store.decide(payload.id, payload.version);
        } else if (payload.status === "accepted" || payload.status === "waived") await target.store.decide(payload.id, payload.status, payload.version);
        else throw new Error("Invalid decision");
      } else if (payload.action === "approve") {
        if (!target.active()) throw new Error("Goal unavailable; approval requires an active phase");
        await store.approve(payload.version);
      } else throw new Error("Unknown action");
    };
    const result = this.work.then(execute);
    this.work = result.catch(() => {});
    try { await result; res.writeHead(200, { ...headers, "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); }
    catch (error) { deny(409, error instanceof Error ? error.message : String(error)); }
  }
  launch(url: string): Promise<void> { return new Promise((ok, fail) => {
    execFile("xdg-open", [url], { timeout: 5000 }, error => error ? fail(error) : ok());
  }); }
  async close() {
    this.invalidate();
    if (this.server) { const server = this.server; delete this.server; await new Promise<void>(ok => server.close(() => ok())); }
  }
}
