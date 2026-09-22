import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { WorkerHub, session, register, assistant, viewFixture, keys, screen, tick, AgentHubView, theme, type TestSession } from './helpers/hub.ts';
import type { WorkerRecord } from '../lib/worker-types.ts';

function worker(hub: WorkerHub, id: string): WorkerRecord { const record = hub.get(id); assert.ok(record, `expected worker ${id}`); return record; }
function composer(state: ReturnType<typeof viewFixture>['state'], id: string) { const value = state.composers.get(id); assert.ok(value, `expected composer ${id}`); return value; }

test('per-thread drafts cannot cross recipients when switching and submitting', async t => {
  const hub = new WorkerHub(), a = session(), b = session(); register(hub, a, 'a'); register(hub, b, 'b'); const { view: v } = viewFixture(t, { hub }); v.handleInput(keys.enter); v.handleInput('for A'); v.handleInput(keys.altDown); v.handleInput('for B'); v.handleInput(keys.enter); await tick();
  assert.deepEqual(a.calls, []); assert.deepEqual(b.calls, [['steer', 'for B']]); assert.equal(worker(hub, 'a').draft, 'for A'); assert.equal(worker(hub, 'b').draft, ''); v.handleInput(keys.altUp); assert.match(screen(v), /To: Explorer · a/); v.handleInput(keys.enter); await tick(); assert.deepEqual(a.calls, [['steer', 'for A']]);
});

test('native editing preserves cursor keys, Unicode, question marks and multiline paste', async t => {
  const hub = new WorkerHub(), s = session(); register(hub, s, 'a'); const { view: v, state } = viewFixture(t, { hub }); v.handleInput(keys.enter); v.handleInput('ac'); v.handleInput(keys.left); v.handleInput('b'); assert.equal(state.mode, 'thread'); assert.equal(worker(hub, 'a').draft, 'abc'); v.handleInput(keys.end); v.handleInput('?你好'); v.handleInput('\x1b[200~\nfn main() {\n  println!("hello");\n}\x1b[201~');
  const value = composer(state, 'a').editor.getExpandedText(); assert.match(value, /abc\?你好\nfn main\(\) \{\n  println!/); assert.equal(worker(hub, 'a').draft, value); v.handleInput(keys.enter); await tick(); assert.deepEqual(s.calls, [['steer', value]]);
});

test('agent questions are answered in-place and submitted text is recallable', async t => {
  const hub = new WorkerHub(), s = session(); register(hub, s, 'a');
  const answer = hub.request<string, { answer: string }>({ ownerId: 'a', title: 'Which target?', run: async response => response.answer });
  const { view: v, state } = viewFixture(t, { hub }); v.handleInput(keys.enter);
  assert.match(screen(v), /Question from Explorer · a: Which target/);
  v.handleInput('production'); v.handleInput(keys.enter);
  assert.equal(await answer, 'production'); await tick(); assert.deepEqual(s.calls, []); assert.equal(worker(hub, 'a').draft, '');
  v.handleInput(keys.up); assert.equal(composer(state, 'a').editor.getExpandedText(), 'production');
});

test('closing and reopening keeps draft, editor cursor, and a pending send safely bound', async t => {
  const hub = new WorkerHub(), a = session(), b = session(); let accept!: () => void; register(hub, a, 'a', { actions: { send: text => new Promise<void>(resolve => { a.calls.push(['steer', text]); accept = resolve; }) } }); register(hub, b, 'b');
  const f = viewFixture(t, { hub }), v = f.view; v.handleInput(keys.enter); v.handleInput('abcd'); v.handleInput(keys.left); v.handleInput(keys.enter); v.dispose(); const again = new AgentHubView(f.tui, theme, hub, 'Main', () => {}, f.state); t.after(() => again.dispose()); again.handleInput(keys.altDown); again.handleInput('draft B'); accept(); await tick(); assert.equal(worker(hub, 'b').draft, 'draft B'); assert.equal(worker(hub, 'a').draft, ''); again.handleInput(keys.altUp); again.handleInput('abcd'); again.handleInput(keys.left); again.dispose(); const third = new AgentHubView(f.tui, theme, hub, 'Main', () => {}, f.state); t.after(() => third.dispose()); third.handleInput('X'); assert.equal(worker(hub, 'a').draft, 'abcXd');
});

test('typing while a send is in flight never erases the newer draft', async t => {
  const hub = new WorkerHub(), s = session(); let accept!: () => void; register(hub, s, 'a', { actions: { send: () => new Promise<void>(resolve => { accept = resolve; }) } }); const { view: v } = viewFixture(t, { hub }); v.handleInput(keys.enter); v.handleInput('first'); v.handleInput(keys.enter); v.handleInput(' second'); accept(); await tick(); assert.equal(worker(hub, 'a').draft, 'first second');
});

test('failed send retains its draft and reports failure on its original recipient', async t => {
  const hub = new WorkerHub(), a = session(), b = session(); let reject!: (reason?: unknown) => void; register(hub, a, 'a', { actions: { send: () => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }) } }); register(hub, b, 'b'); const { view: v, state } = viewFixture(t, { hub }); v.handleInput(keys.enter); v.handleInput('lost?'); v.handleInput(keys.enter); v.handleInput(keys.altDown); reject(new Error('provider closed')); await tick(); assert.equal(worker(hub, 'a').draft, 'lost?'); assert.match(state.notices.get('a') ?? '', /Not sent/); assert.equal(state.notices.get('b'), undefined);
});

test('finished thread never retargets draft and inspection never restarts a worker', async t => {
  const hub = new WorkerHub(), s = session(); register(hub, s, 'a'); const { view: v, state } = viewFixture(t, { hub }); v.handleInput(keys.enter); v.handleInput('follow-up'); hub.unregister('a'); for (let i = 0; i < 25; i++) { register(hub, session(), `new${i}`); hub.unregister(`new${i}`); } v.handleInput(keys.enter); await tick(); assert.equal(state.selectedId, 'a'); assert.equal(worker(hub, 'a').draft, 'follow-up'); assert.deepEqual(s.calls, []); assert.match(screen(v), /read-only result/);
});

test('stop is explicit with Cancel selected by default; Esc only navigates', async t => {
  const hub = new WorkerHub(), s = session(); register(hub, s, 'a'); const { view: v } = viewFixture(t, { hub }); v.handleInput('x'); assert.match(screen(v), /Already completed[\s\S]*edits/); v.handleInput(keys.enter); await tick(); assert.deepEqual(s.calls, []); v.handleInput('x'); screen(v); v.handleInput(keys.down); screen(v); v.handleInput(keys.enter); await tick(); assert.deepEqual(s.calls, [['abort']]); v.handleInput(keys.enter); v.handleInput(keys.escape); assert.equal(s.calls.length, 1);
});

test('search/help/actions do not steal ordinary typing and explain their effect', t => {
  const hub = new WorkerHub(), s = session(); register(hub, s, 'a'); s.append(assistant('FOUND important evidence')); const { view: v, state } = viewFixture(t, { hub }); v.handleInput(keys.enter); v.handleInput('why?'); assert.equal(composer(state, 'a').editor.getExpandedText(), 'why?'); v.handleInput(keys.f1); assert.match(screen(v), /Navigation without changing execution/); v.handleInput(keys.pageDown); v.handleInput(keys.escape); assert.equal(worker(hub, 'a').draft, 'why?'); v.handleInput(keys.f3); v.handleInput('important'); v.handleInput(keys.enter); assert.match(screen(v), /Match found/); v.handleInput(keys.escape); v.handleInput(keys.f2); assert.match(screen(v), /Queue this draft after/);
});

test('responsive layout keeps Back and Help reachable across narrow and short terminals', t => {
  const hub = new WorkerHub(); register(hub, session(), 'a'); const f = viewFixture(t, { hub }); for (const width of [20, 40, 80, 100, 160]) for (const height of [6, 12, 24, 48]) { f.setSize(height); let lines = f.view.render(width); assert.ok(lines.length <= height); assert.ok(lines.every(line => visibleWidth(line) <= width), `${width}x${height}`); assert.match(screen(f.view, width), /Esc/); assert.match(screen(f.view, width), /F1/); f.view.handleInput(keys.enter); lines = f.view.render(width); assert.ok(lines.length <= height); assert.ok(lines.every(line => visibleWidth(line) <= width)); assert.match(screen(f.view, width), /Esc/); f.view.handleInput(keys.escape); }
});

test('help is navigable on 40x12 without truncating the only explanation of advanced actions', t => { const hub = new WorkerHub(); register(hub, session(), 'a'); const { view: v } = viewFixture(t, { rows: 12, hub }); v.handleInput(keys.f1); let observed = ''; for (let i = 0; i < 20; i++) { observed += screen(v, 40); v.handleInput(keys.pageDown); } assert.match(observed, /stop with/); assert.match(observed, /Queued is not delivered/); assert.match(observed, /PgUp\/Dn more/); });

test('a tiny terminal cannot silently accept input into an invisible editor', t => { const hub = new WorkerHub(); register(hub, session(), 'a'); const f = viewFixture(t, { rows: 6, hub }); f.view.handleInput(keys.enter); screen(f.view, 40); f.view.handleInput('invisible'); assert.equal(worker(hub, 'a').draft, ''); f.setSize(24); screen(f.view, 40); f.view.handleInput('visible'); assert.equal(worker(hub, 'a').draft, 'visible'); });

test('clipboard failures are awaited and stay attached to the original thread', async t => { const hub = new WorkerHub(), a = session(), b = session(); register(hub, a, 'a'); register(hub, b, 'b'); a.append(assistant('copy me')); let reject!: (reason?: unknown) => void; const f = viewFixture(t, { hub, options: { copy: () => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }) } }), v = f.view; v.handleInput(keys.enter); v.handleInput(keys.f2); screen(v); v.handleInput(keys.down); screen(v); v.handleInput(keys.enter); await tick(); v.handleInput(keys.altDown); reject(new Error('Clipboard unavailable')); await tick(); assert.match(f.state.notices.get('a') ?? '', /Clipboard unavailable/); assert.equal(f.state.notices.get('b'), undefined); });

test('an already-open empty roster selects the first arriving child without retargeting an existing selection', t => { const f = viewFixture(t); screen(f.view); register(f.hub, session(), 'first'); assert.equal(f.state.selectedId, 'first'); register(f.hub, session(), 'second'); assert.equal(f.state.selectedId, 'first'); });

test('filtering the roster cannot open or message a hidden recipient', t => { const hub = new WorkerHub(); register(hub, session(), 'a', { label: 'Alpha' }); register(hub, session(), 'b', { label: 'Beta' }); const { view: v, state } = viewFixture(t, { hub }); v.handleInput(keys.f3); v.handleInput('Beta'); v.handleInput(keys.enter); screen(v); v.handleInput(keys.enter); assert.equal(state.selectedId, 'b'); assert.equal(state.mode, 'thread'); v.handleInput(keys.escape); v.handleInput(keys.f3); v.handleInput('no match'); v.handleInput(keys.enter); v.handleInput(keys.enter); assert.equal(state.mode, 'roster'); });

test('roster preserves identity during live changes and rebuilds explicit scope without hidden activation', t => {
  const hub = new WorkerHub(); register(hub, session(), 'a', { label: 'Alpha' }); register(hub, session(), 'b', { label: 'Beta' });
  const { view: v, state } = viewFixture(t, { hub });
  assert.deepEqual(state.order, ['a', 'b']);
  v.handleInput(keys.down); assert.equal(state.selectedId, 'b');
  hub.unregister('a'); assert.deepEqual(state.order, ['a', 'b']);
  register(hub, session(), 'c', { label: 'Gamma' }); assert.deepEqual(state.order, ['a', 'b', 'c']);
  v.handleInput('o'); assert.equal(state.sort, 'newest'); assert.equal(state.selectedId, 'b');
  v.handleInput(keys.f3); v.handleInput('unmatched'); v.handleInput(keys.enter);
  assert.deepEqual(state.order, []); assert.equal(state.selectedId, undefined); v.handleInput(keys.enter); assert.equal(state.mode, 'roster');
  assert.match(screen(v), /No matching agents/);
  v.handleInput('0'); assert.equal(state.filter, ''); assert.equal(state.selectedId, state.order[0]);
  v.handleInput('s'); assert.equal(state.status, 'active');
  assert.ok(state.order.every(id => hub.get(id)?.closed === false));
});

test('mouse roster selection does not open or send, and wheel retains keyboard navigation', t => {
  const hub = new WorkerHub(), a = session(), b = session(); register(hub, a, 'a'); register(hub, b, 'b');
  const { view: v, state } = viewFixture(t, { hub }); v.render(80);
  const event = { type: 'click', button: 'left', x: 5, y: 7, screenX: 5, screenY: 7, width: 80, height: 24, shift: false, alt: false, ctrl: false } as const;
  v.handleMouse(event); assert.equal(state.selectedId, 'b'); assert.equal(state.mode, 'roster');
  assert.deepEqual(a.calls, []); assert.deepEqual(b.calls, []);
  v.handleMouse({ ...event, type: 'wheel', button: 'none', wheelDelta: -1 }); assert.equal(state.selectedId, 'a');
});

test('mouse double-click opens without sending and short viewport keeps transcript navigation', t => {
  const hub = new WorkerHub(), s = session(); register(hub, s, 'a'); s.append(assistant('visible evidence'));
  const { view: v, state, setSize } = viewFixture(t, { hub }); v.render(80);
  const event = { type: 'click', button: 'left', x: 4, y: 4, screenX: 4, screenY: 4, width: 80, height: 24, shift: false, alt: false, ctrl: false, clickCount: 2 } as const;
  v.handleMouse(event); assert.equal(state.mode, 'thread'); assert.deepEqual(s.calls, []);
  setSize(8); assert.match(screen(v, 40), /Input paused/); assert.match(screen(v, 40), /visible evidence/);
  v.handleInput('not typed'); assert.equal(hub.get('a')?.draft, '');
});

test('fullscreen mouse footer opens actions without sending and confirmation defaults to Cancel', t => {
  const hub = new WorkerHub(), s = session(); register(hub, s, 'a'); const { view: v } = viewFixture(t, { hub });
  const lines = v.render(100).map(line => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''));
  const y = lines.findIndex(line => line.includes('F2 actions')); const x = lines[y]!.indexOf('F2 actions');
  assert.ok(y >= 0 && x >= 0);
  v.handleMouse({ type: 'click', button: 'left', x, y, screenX: x, screenY: y, width: 100, height: 24, shift: false, alt: false, ctrl: false });
  assert.match(screen(v, 100), /Actions/); assert.deepEqual(s.calls, []);
});

test('stop cannot execute until the selected action is visible in a rendered confirmation', async t => { const hub = new WorkerHub(), s = session(); register(hub, s, 'a', { label: 'Very long agent purpose '.repeat(30) }); const { view: v } = viewFixture(t, { hub, rows: 8 }); v.handleInput(keys.enter); screen(v, 30); v.handleInput('\x18'); v.handleInput(keys.down); v.handleInput(keys.enter); await tick(); assert.equal(s.calls.length, 0); const rendered = screen(v, 30); assert.match(rendered, /Cancel/); assert.match(rendered, /Stop/); v.handleInput(keys.enter); await tick(); assert.deepEqual(s.calls, [['abort']]); });
