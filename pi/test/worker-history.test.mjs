import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkerHistory } from "../lib/worker-history.mjs";
import { WorkerHub } from "../lib/worker-hub.mjs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-history-"));
  const cwd = path.join(dir, "worktree"); fs.mkdirSync(cwd);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { cwd, sessionId: "parent-a", sessionDir: path.join(dir, "sessions"), parentFile: path.join(dir, "main.jsonl") };
  return { dir, cwd, options, history: new WorkerHistory(options) };
}
const assistant = text => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now(), provider: "test", model: "test", api: "test" });
function own(hub, manager, id) {
  const listeners = new Set();
  const session = { messages: manager.getEntries().filter(e => e.type === "message").map(e => e.message), sessionFile: manager.getSessionFile(),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  hub.register({ id, label: `Explorer · ${id}`, role: "explorer", model: "test", thinking: "low", session, metadata: { cwd: manager.getCwd(), parentId: "main" } });
}

test("native state and drafts persist before any assistant response, without fabricated turns", t => {
  const f = fixture(t), hub = new WorkerHub({ history: f.history }); t.after(() => hub.dispose());
  const manager = f.history.createSession(f.cwd);
  own(hub, manager, "pre-response"); f.history.saveDraft("pre-response", "line 1\nline 2 中文");
  const restored = new WorkerHistory(f.options);
  assert.equal(restored.records()[0].id, "pre-response"); assert.equal(restored.drafts().get("pre-response").text, "line 1\nline 2 中文");
  assert.ok(fs.existsSync(manager.getSessionFile()));
  assert.equal(SessionManager.open(manager.getSessionFile()).getEntries().filter(e => e.type === "message").length, 0);
  assert.equal(fs.statSync(manager.getSessionFile()).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.history.directory).mode & 0o777, 0o700);
});

test("over twelve finished identities remain accessible and evicted transcript bodies reload from Pi", async t => {
  const f = fixture(t), hub = new WorkerHub({ history: f.history }); t.after(() => hub.dispose());
  for (let i = 0; i < 18; i++) {
    const manager = f.history.createSession(f.cwd); manager.appendMessage(assistant(`result ${i}`));
    own(hub, manager, `agent-${i}`); hub.unregister(`agent-${i}`);
  }
  assert.equal(hub.list().length, 18);
  assert.equal(hub.get("agent-0").loaded, false);
  await hub.load("agent-0"); assert.equal(hub.get("agent-0").messages[0].content[0].text, "result 0");
  const restored = new WorkerHub({ history: new WorkerHistory(f.options) }); t.after(() => restored.dispose());
  restored.restore(restored.history.records()); assert.equal(restored.list().length, 18);
  assert.ok(restored.list().every(r => !r.session && !r.controls.send));
  await restored.load("agent-0"); assert.equal(restored.get("agent-0").messages[0].content[0].text, "result 0");
});

test("restart labels unfinished work interrupted and never executes or grants controls", t => {
  const f = fixture(t), hub = new WorkerHub({ history: f.history }); t.after(() => hub.dispose());
  own(hub, f.history.createSession(f.cwd), "in-flight");
  const restored = new WorkerHub({ history: new WorkerHistory(f.options) }); t.after(() => restored.dispose());
  restored.restore(restored.history.records());
  assert.equal(restored.get("in-flight").state, "interrupted"); assert.equal(restored.get("in-flight").session, undefined);
  assert.deepEqual(restored.get("in-flight").controls, {});
});

test("raw native history survives context compaction and preserves entry order", async t => {
  const f = fixture(t), manager = f.history.createSession(f.cwd);
  const first = manager.appendMessage(assistant("FIRST_RAW_CANARY"));
  manager.appendMessage(assistant("SECOND_RAW_CANARY"));
  manager.appendCompaction("compressed context", first, 8000);
  manager.appendMessage({ ...assistant("THIRD_RAW_CANARY"), timestamp: 1 });
  const loaded = await f.history.load({ sessionFile: manager.getSessionFile() });
  const texts = loaded.map(m => typeof m.content === "string" ? m.content : m.content[0]?.text);
  assert.equal(texts[0], "FIRST_RAW_CANARY"); assert.equal(texts[1], "SECOND_RAW_CANARY");
  assert.match(texts[2], /Context compacted/); assert.equal(texts[3], "THIRD_RAW_CANARY");
});

test("previous-session discovery is explicit, worktree-scoped, and does not revive anything", t => {
  const f = fixture(t), hub = new WorkerHub({ history: f.history }); t.after(() => hub.dispose());
  own(hub, f.history.createSession(f.cwd), "old-agent"); hub.unregister("old-agent");
  const next = new WorkerHistory({ ...f.options, sessionId: "parent-b" });
  assert.deepEqual(next.records(), []); assert.equal(next.previous()[0].id, "old-agent");
  const otherCwd = path.join(f.dir, "another-worktree"); fs.mkdirSync(otherCwd);
  const unrelated = new WorkerHistory({ ...f.options, cwd: otherCwd, sessionId: "unrelated" });
  assert.deepEqual(unrelated.previous(), []);
});

test("a transcript path outside worker storage is not opened as arbitrary local evidence", async t => {
  const f = fixture(t), outside = path.join(f.dir, "not-a-session.jsonl"); fs.writeFileSync(outside, "secret");
  await assert.rejects(f.history.load({ sessionFile: outside }), /outside/);
  const invalid = path.join(f.history.directory, "broken.jsonl"); fs.writeFileSync(invalid, "not a pi session\n");
  await assert.rejects(f.history.load({ sessionFile: invalid }), /valid|session/i);
});
