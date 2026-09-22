import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager, type CustomEntry, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { WorkerHistory, WORKER_ENTRY } from '../lib/worker-history.ts';
import { WorkerHub } from '../lib/worker-hub.ts';
import type { WorkerMessage, WorkerRecord } from '../lib/worker-types.ts';
import { session, register, assistant } from './helpers/hub.ts';

function worker(hub: WorkerHub, id: string): WorkerRecord {
  const record = hub.get(id); assert.ok(record, `expected worker ${id}`); return record;
}
function text(messages: readonly WorkerMessage[]): string {
  const message = messages[0]; assert.ok(message && 'content' in message && Array.isArray(message.content), 'expected text message');
  const part = message.content[0]; assert.ok(part?.type === 'text', 'expected text content'); return part.text;
}
function pathOf(value: string | undefined, message = 'expected session path'): string { assert.ok(value, message); return value; }
type Saved = { stats: { tools: number }; metadata: { task: string } };
function isSaved(entry: SessionEntry): entry is CustomEntry<Saved> {
  return entry.type === 'custom' && entry.customType === WORKER_ENTRY && entry.data !== undefined;
}

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-history-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parent = SessionManager.create(root, path.join(root, 'parents'));
  const errors: string[] = [], history = new WorkerHistory(parent, (error: unknown) => errors.push(String(error)));
  return { root, parent, history, errors };
}

test('native Pi child history and drafts survive completion, cache eviction and parent reopen', async t => {
  const { root, parent, history } = fixture(t), hub = new WorkerHub({ history }); t.after(() => hub.dispose());
  for (let i = 0; i < 18; i++) {
    const manager = history.create(root, { id: `a${i}`, label: `Research ${i}`, metadata: { readOnly: true } });
    const s = session(); s.sessionManager = manager; const file = manager.getSessionFile(); if (file) s.sessionFile = file;
    register(hub, s, `a${i}`); const message = assistant(`Evidence ${i}`); s.append(message); manager.appendMessage(message);
    hub.setDraft(`a${i}`, `Follow up ${i}\n第二行`); hub.unregister(`a${i}`);
  }
  assert.equal(hub.list().filter(record => record.messages).length, 12); assert.equal(text(hub.load('a0').messages ?? []), 'Evidence 0');
  const restored = new WorkerHub({ history: new WorkerHistory(parent) }); t.after(() => restored.dispose()); await history.restore(restored);
  assert.equal(restored.list().length, 18); assert.equal(worker(restored, 'a0').state, 'completed'); assert.equal(worker(restored, 'a0').session, undefined); assert.equal(worker(restored, 'a0').draft, 'Follow up 0\n第二行');
  assert.equal(text(restored.load('a0').messages ?? []), 'Evidence 0'); assert.equal(restored.canSend('a0'), false); assert.equal(fs.statSync(worker(restored, 'a0').file!).mode & 0o777, 0o600);
});

test('first-request crash is recoverable without pretending the worker is still alive', async t => {
  const { root, history } = fixture(t), manager = history.create(root, { id: 'crash', label: 'Interrupted research', metadata: {} });
  manager.appendCustomEntry(WORKER_ENTRY, { id: 'crash', label: 'Interrupted research', state: 'working', deliveries: [{ text: 'did it arrive?', status: 'queued' }] });
  const hub = new WorkerHub({ history }); t.after(() => hub.dispose()); await history.restore(hub); const record = worker(hub, 'crash');
  assert.equal(record.state, 'interrupted'); assert.equal(record.deliveries[0]?.status, 'failed'); assert.ok(record.endedAt); assert.equal(hub.canSend(record.id), false);
});

test('metadata snapshots are immutable and outside-path/symlink reads are rejected', t => {
  const { root, history } = fixture(t), manager = history.create(root, { id: 'a' }), hub = new WorkerHub({ history }); t.after(() => hub.dispose());
  const s = session(); s.sessionManager = manager; const record = register(hub, s, 'a', { metadata: { task: 'original' } }); record.stats.tools = 1;
  history.saveMetadata(record); record.stats.tools = 9; record.metadata['task'] = 'changed';
  const saved = manager.getEntries().filter(isSaved).at(-1); assert.ok(saved?.data, 'expected saved metadata'); assert.equal(saved.data.stats.tools, 1); assert.equal(saved.data.metadata['task'], 'original');
  const other = path.join(root, 'outside.jsonl'); fs.writeFileSync(other, '{}'); const link = path.join(pathOf(history.root), 'link.jsonl'); fs.symlinkSync(other, link);
  assert.throws(() => history.open(link), /outside this parent/); assert.throws(() => history.open(other), /outside this parent/);
});

test('damaged files do not hide intact histories; restoration is cancellable', async t => {
  const { root, history, errors } = fixture(t); history.create(root, { id: 'intact' }); fs.writeFileSync(path.join(pathOf(history.root), 'broken.jsonl'), 'not json');
  const hub = new WorkerHub({ history }); t.after(() => hub.dispose()); await history.restore(hub); assert.ok(hub.get('intact')); assert.ok(errors.length);
  const empty = new WorkerHub({ history }); t.after(() => empty.dispose()); const c = new AbortController(); c.abort(); await history.restore(empty, c.signal); assert.equal(empty.list().length, 0);
});

test('Main with a custom entry is natively resumable before any assistant turn; later messages append normally', t => {
  const { root, parent, history } = fixture(t), id = parent.getSessionId(); parent.appendCustomEntry('worker-start', { phase: 'ship' }); const leaf = parent.getLeafId();
  assert.equal(fs.existsSync(pathOf(parent.getSessionFile())), false); history.ensureParent(); assert.equal(parent.getSessionId(), id); assert.equal(parent.getLeafId(), leaf);
  assert.ok(!parent.getEntries().some(entry => entry.type === 'message' && entry.message.role === 'assistant')); parent.appendMessage(assistant('A real later reply'));
  const restored = SessionManager.open(pathOf(parent.getSessionFile())); assert.equal(restored.getSessionId(), id); assert.equal(restored.getEntries().filter(entry => entry.type === 'message').length, 1);
  history.create(root, { id: 'first-child' }); assert.equal(parent.getEntries().filter(entry => entry.type === 'message').length, 1);
});

test('earlier PR native child journal and drafts remain inspectable without crossing parent boundaries', async t => {
  const { root, parent, history } = fixture(t); history.ensureParent(); fs.mkdirSync(pathOf(history.legacyRoot), { recursive: true });
  const seed = (file: string): SessionManager => { const manager = SessionManager.inMemory(root); fs.writeFileSync(file, `${JSON.stringify(manager.getHeader())}\n`); return SessionManager.open(file); };
  const child = seed(path.join(pathOf(history.legacyRoot), 'child.jsonl')); child.appendMessage(assistant('Legacy evidence')); const journal = seed(path.join(pathOf(history.legacyRoot), 'hub-state.jsonl'));
  journal.appendCustomEntry('dev-worker', { id: 'legacy', label: 'Old Explorer', role: 'explorer', state: 'working', sessionFile: pathOf(child.getSessionFile()), receipts: [{ id: 'msg', text: 'uncertain delivery', state: 'undelivered' }] }); journal.appendCustomEntry('dev-draft', { id: 'legacy', text: 'Preserved draft\n中文' });
  const hub = new WorkerHub({ history }); t.after(() => hub.dispose()); await history.restore(hub); const legacy = worker(hub, 'legacy');
  assert.equal(legacy.state, 'interrupted'); assert.equal(legacy.draft, 'Preserved draft\n中文'); assert.equal(legacy.deliveries[0]?.status, 'failed'); assert.match(text(hub.load('legacy').messages ?? []), /Legacy evidence/);
  hub.setDraft('legacy', 'new draft'); hub.flush(); const again = new WorkerHub({ history }); t.after(() => again.dispose()); await history.restore(again); assert.equal(worker(again, 'legacy').draft, 'new draft');
  const other = path.join(pathOf(parent.getSessionDir()), '.workers', 'different-parent'); fs.mkdirSync(other); const outside = seed(path.join(other, 'other.jsonl')); assert.throws(() => history.open(pathOf(outside.getSessionFile())), /outside this parent/); assert.ok(fs.existsSync(pathOf(journal.getSessionFile())), 'migration never deletes original history');
});
