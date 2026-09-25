import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { SpecWorkspace } from "../lib/spec-workspace.ts";
import { WorkspaceWeb } from "../lib/workspace-web.ts";

const first = "Status: DRAFT\n\n# Product\n\nIntent, scope and exclusions.\n";
async function fixture(run: (args: { cwd: string; path: string; store: SpecWorkspace; web: WorkspaceWeb; url: string; post: (payload: object, headers?: Record<string,string>) => Promise<Response> }) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "spec-web-")); const path = join(cwd, "plans/product/spec.md");
  await mkdir(join(cwd, "plans/product"), { recursive: true }); await writeFile(path, first);
  const store = new SpecWorkspace(path, join(cwd, "state.json"), cwd), web = new WorkspaceWeb();
  let active = true;
  const url = await web.open({ phase: "spec", store, project: "product", active: () => active, send: () => {} });
  const post = (payload: object, headers: Record<string,string> = {}) => fetch(url + "action", { method: "POST", headers: { Origin: new URL(url).origin, "Content-Type": "application/json", "X-Workspace-Request": url.split("/")[3]!, ...headers }, body: JSON.stringify(payload) });
  try { await run({ cwd, path, store, web, url, post }); active = false; } finally { await web.close(); await rm(cwd, { recursive: true, force: true }); }
}
const publish = async (store: SpecWorkspace, markdown = first, decisions: Array<{ id: string; subject: string; recommendation: string; consequence: string }> = []) => store.publish({ markdown, recommendation: "Proceed with a small release", sections: [{ id: "intent", title: "Intent", kind: "motivation", body: "Clarify intent" }, { id: "scope", title: "Scope", kind: "scope", body: markdown }], decisions });

test("spec flow gates decisions, revisions, external edits, status recording and restart", async () => fixture(async ({ store, path, url, post }) => {
  const original = await publish(store, first, [{ id: "tradeoff", subject: "Data storage", recommendation: "Keep local", consequence: "No remote account" }]);
  let state = await (await fetch(url + "state")).json() as { canApprove: boolean }; assert.equal(state.canApprove, false);
  assert.equal((await post({ action: "approve", version: original.version })).status, 409);
  assert.equal((await post({ action: "decide", id: "tradeoff", version: original.version })).status, 200);
  const newer = first.replace("scope and exclusions", "scope, exclusions and new behavior");
  await writeFile(path, newer); await publish(store, newer);
  assert.equal((await post({ action: "approve", version: original.version })).status, 409);
  assert.equal((await post({ action: "apply", version: original.version })).status, 200);
  assert.equal((await post({ action: "approve", version: original.version })).status, 409);
  assert.equal((await post({ action: "approve", version: store.state.current!.version })).status, 200);
  assert.match(await readFile(path, "utf8"), /^Status: APPROVED/m);
  await writeFile(path, (await readFile(path,"utf8")) + "\nExternal edit\n");
  state = await (await fetch(url + "state")).json() as { canApprove: boolean }; assert.equal(state.canApprove, false);
  const recovered = new SpecWorkspace(path, store.file, store.cwd); await recovered.restore();
  assert.equal(recovered.state.approval, undefined); assert.equal((await recovered.check()).current, false);
}));

test("request changes blocks approval until a revised spec is inspected; failed delivery unblocks", async () => fixture(async ({ store, path, post }) => {
  const original = await publish(store);
  assert.equal((await post({ action: "request_changes", version: original.version, text: "Clarify the handoff invariant" })).status, 200);
  assert.match((await store.check()).reason, /Changes requested/);
  assert.equal((await post({ action: "approve", version: original.version })).status, 409);
  const request = store.state.discussions.at(-1)!;
  assert.equal(request.subject, "general"); assert.match(request.text, /Clarify the handoff invariant/);
  await store.fail(request.id, "offline");
  assert.equal((await store.check()).current, true);
  assert.equal((await post({ action: "request_changes", version: original.version, text: "Clarify the handoff invariant" })).status, 200);
  const revised = first.replace("scope and exclusions", "scope and handoff invariant");
  await writeFile(path, revised); await publish(store, revised);
  assert.equal((await post({ action: "approve", version: original.version })).status, 409);
  assert.equal((await post({ action: "apply", version: original.version })).status, 200);
  assert.equal((await store.check()).current, true);
}));

test("spec approval adds status without changing semantics when source omitted a status line", async () => fixture(async ({ store, path, post }) => {
  const plain = "# Product\n\nIntent and scope.\n";
  await writeFile(path, plain);
  const doc = await publish(store, plain);
  assert.equal((await post({ action: "approve", version: doc.version })).status, 200);
  assert.match(await readFile(path, "utf8"), /^Status: APPROVED\n\n# Product/);
  assert.equal((await store.check()).current, true);
}));

test("local service rejects forged requests, stale URLs and untrusted content stays data",  async () => fixture(async ({ store, web, url, post, path }) => {
  await publish(store);
  const forgedHost = await new Promise<number>((resolve, reject) => { const req = request(url + "state", { headers: { Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode || 0); }); req.on("error", reject); req.end(); });
  assert.equal(forgedHost, 403);
  assert.equal((await post({ action: "approve", version: store.state.current!.version }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ action: "approve", version: store.state.current!.version }, { "X-Workspace-Request": "forged" })).status, 403);
  assert.equal((await fetch(url + "action", { method: "POST", body: JSON.stringify({ action: "approve", version: store.state.current!.version }) })).status, 403);
  const evil = first + "<img src=x onerror=alert(1)>"; await writeFile(path, evil); await publish(store, evil);
  const html = await (await fetch(url)).text(); assert.doesNotMatch(html, /onerror=alert/);
  const response = await (await fetch(url + "state")).text(); assert.match(response, /onerror=alert/);
  const cssPath = html.match(/href="(\.\/assets\/[^" ]+\.css)"/)?.[1];
  assert.ok(cssPath);
  const asset = await fetch(url + cssPath); assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") || "", /^text\/css/);
  assert.equal((await fetch(url + "assets/%2e%2e%2fstate")).status, 404);
  const other = new SpecWorkspace(path, join(store.cwd, "other.json"), store.cwd);
  await web.open({ phase: "spec", store: other, project: "other", active: () => true, send: () => {} });
  assert.equal((await fetch(url + "state")).status, 403);
}));

test("semantic attention data survives publication, revision and restoration without changing approval gates", async () => fixture(async ({ store, path, post, url }) => {
  const item = { id: "handoff", subject: "New owner may start too soon", recommendation: "Wait for acknowledgement; slower recovery is safer", consequence: "Two owners could write concurrently",
    context: { mentalModel: "Placement is intent; ownership is fact", explanation: "A timeout is not proof the old owner stopped", evidence: ["handoff timeout test"], code: ["src/handoff.ts:31"] },
    visual: { type: "sequence_flow" as const, steps: ["Old owner active", "Timeout", "New owner starts"] } };
  const doc = await publish(store, first, [item]);
  const state = await (await fetch(url + "state")).json() as { state: { current: { decisions: typeof doc.decisions } } };
  assert.deepEqual(state.state.current.decisions[0]?.visual, item.visual);
  assert.deepEqual(doc.decisions[0]?.context, item.context);
  assert.deepEqual(doc.decisions[0]?.visual, item.visual);
  assert.equal((await post({ action: "approve", version: doc.version })).status, 409);
  const revised = first.replace("scope and exclusions", "scope and a timeout invariant");
  await writeFile(path, revised); await publish(store, revised, [item]);
  assert.deepEqual(store.state.pending?.decisions[0]?.visual, item.visual);
  const restored = new SpecWorkspace(store.path, store.file, store.cwd); await restored.restore();
  assert.deepEqual(restored.state.pending?.decisions[0]?.context, item.context);
  assert.equal((await restored.check()).current, false);
}));

test("focused decision metadata and subject-bound alternatives survive revisions", async () => fixture(async ({ store, path, post, url }) => {
  const choice = { id: "storage", subject: "Where should data live?", title: "Choose local storage", summary: "Keep the handoff history on this device", recommendation: "Keep data local", recommendationReason: "No remote identity is required", recommendedOptionId: "local", options: [{ id: "local", label: "Local", summary: "No sync" }, { id: "cloud", label: "Cloud", summary: "Requires account ownership" }], consequence: "Local history is not shared", context: { evidence: [{ label: "Trial", summary: "Offline handoffs succeeded", source: "trial log" }], code: [{ path: "handoff.ts", lines: "20-31", summary: "Writes locally" }] }, visual: { type: "sequence_flow" as const, nodes: [{ id: "browser", label: "Browser" }, { id: "disk", label: "Disk" }], edges: [{ from: "browser", to: "disk" }] } };
  const original = await publish(store, first, [choice]);
  const response = await (await fetch(url + "state")).json() as { state: { current: { decisions: typeof original.decisions } } };
  assert.equal(response.state.current.decisions[0]?.recommendedOptionId, "local");
  assert.deepEqual(response.state.current.decisions[0]?.visual, choice.visual);
  assert.equal((await post({ action: "request_changes", version: original.version, subject: "storage", text: "Choose alternative: Cloud" })).status, 200);
  assert.equal(store.state.discussions.at(-1)?.subject, "storage");
  assert.equal((await post({ action: "approve", version: original.version })).status, 409);
  const revised = first.replace("scope and exclusions", "scope and cloud ownership");
  await writeFile(path, revised); await publish(store, revised, [choice]);
  assert.deepEqual(store.state.pending?.decisions[0]?.options, choice.options);
  const restored = new SpecWorkspace(store.path, store.file, store.cwd); await restored.restore();
  assert.deepEqual(restored.state.pending?.decisions[0]?.context, choice.context);
  assert.equal(restored.state.discussions.at(-1)?.subject, "storage");
}));

test("discussion retains version, failed delivery and draft on restart without replay", async () => fixture(async ({ store, post, url }) => {
  const doc = await publish(store); const version = doc.version;
  const msg = await store.addHuman("intent", "Could we change this?");
  assert.equal((await (await fetch(url + "state")).json() as { canApprove: boolean }).canApprove, false);
  assert.equal((await post({ action: "approve", version })).status, 409);
  await store.fail(msg.id, "offline");
  assert.equal((await post({ action: "draft", version, subject: "intent", text: "unsent" })).status, 200);
  const restored = new SpecWorkspace(store.path, store.file, store.cwd); await restored.restore();
  assert.equal(restored.state.discussions[0]?.status, "failed"); assert.equal(restored.state.drafts['intent'], "unsent"); assert.equal(restored.state.approval, undefined);
  assert.match(restored.state.notice || "", /reconciliation/);
}));
