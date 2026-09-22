import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { SessionManager, type ExtensionContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { WorkerHub } from '../lib/worker-hub.ts';
import { createWorkerRunner, type RunWorker } from '../lib/worker.ts';
import type { WorkflowHarness } from '../lib/workflow-types.ts';
import type { AgentHubView } from '../worker-hub-ui.ts';
import type { TestSession } from './helpers/hub.ts';
import type { RegisterWorker, WorkerPatch, WorkerRecord, WorkerState } from '../lib/worker-types.ts';
import { session, register, theme, keys, tick, screen } from './helpers/hub.ts';

const extensionModule = await createJiti(import.meta.url).import('../extension.ts') as { default: (pi: unknown, dependencies: unknown) => void };
const extension = extensionModule.default;

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
type Command = { handler: (args: string, ctx: ExtensionContext) => Promise<void> };
type ExternalAdapter = {
  register(record: RegisterWorker): { update(patch: WorkerPatch): void; finish(state?: WorkerState): void };
};
type Audit = { type: string; data: { kind?: string; stdout?: string; stderr?: string; error?: string } };

function required<T>(value: T | undefined, message: string): T {
  assert.ok(value, message);
  return value;
}

function fixture(t: TestContext, workflow: (h: WorkflowHarness) => Promise<void> = async () => undefined) {
  const handlers = new Map<string, Handler[]>(), commands = new Map<string, Command>(), tools = new Map<string, ToolDefinition>(), events = new Map<string, (request: unknown) => void>();
  const hub = new WorkerHub(), audit: Audit[] = [], notifications: unknown[][] = [], dialogs: Array<{ title: string; choices: string[] }> = [];
  let overlay: AgentHubView | undefined;
  let resolveOverlay: (() => void) | undefined;
  let widget: ((tui: unknown, currentTheme: typeof theme) => { render(width: number): string[] }) | undefined;
  let ended = false;
  let ctx: ExtensionContext;
  const emit = async (name: string, event: Record<string, unknown> = {}): Promise<unknown> => {
    let result: unknown;
    for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx);
    return result;
  };
  const run = Object.assign((async (value: unknown) => {
    const { task, name, metadata = {} } = value as { task: string; name: string; metadata?: Record<string, unknown> };
    const s = session(); register(hub, s, hub.nextId(name), { label: `Explorer · ${task}`, metadata: { readOnly: true, ...metadata } });
    return { status: 'FOUND', answer: 'Scheduler evidence', evidence: [{ claim: 'Scheduler test', anchor: 'test/scheduler.test.ts:1' }] };
  }) as unknown as RunWorker, {
    hasActive: () => hub.list().some(record => record.session),
    stopAll: async () => { for (const record of hub.list().filter(record => record.session)) { await hub.abort(record.id); hub.unregister(record.id, 'aborted'); } },
    related: async (): Promise<string> => assert.fail('unexpected related call'),
  }) as ReturnType<typeof createWorkerRunner>;
  const pi = {
    on(name: string, handler: Handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    registerCommand: (name: string, command: Command) => commands.set(name, command), registerShortcut() {}, registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerEntryRenderer() {}, appendEntry: (type: string, data: Audit['data']) => audit.push({ type, data }), sendMessage() {}, sendUserMessage() {},
    exec: async (): Promise<{ code: number; stdout: string; stderr: string }> => ({ code: 0, stdout: '', stderr: '' }),
    events: { on: (name: string, handler: (request: unknown) => void) => { events.set(name, handler); return () => events.delete(name); } },
  };
  ctx = {
    cwd: process.cwd(), hasUI: true, isIdle: () => true, hasPendingMessages: () => false, sessionManager: SessionManager.inMemory(process.cwd()),
    ui: {
      notify: (...args: unknown[]) => { notifications.push(args); }, setStatus() {}, setWidget: (_key: string, factory: typeof widget) => { widget = factory; },
      async select(title: string, choices: string[]) { dialogs.push({ title, choices }); return choices[0] ?? 'Cancel'; }, editor: async () => '',
      custom(factory: (tui: unknown, currentTheme: typeof theme, keybindings: unknown, done: () => void) => typeof overlay) {
        void emit('ui_prompt_start'); return new Promise<void>(resolve => {
          resolveOverlay = () => { overlay?.dispose(); overlay = undefined; void emit('ui_prompt_end'); resolve(); };
          overlay = factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, theme, {}, resolveOverlay);
        });
      },
    },
  } as unknown as ExtensionContext;
  extension(pi, { hub, createWorkerRunner: () => run, runWorkflow: async (h: WorkflowHarness) => { await workflow(h); ended = true; } });
  t.after(async () => { resolveOverlay?.(); await emit('session_shutdown'); });
  return { pi, hub, ctx, emit, commands, tools, events, audit, notifications, dialogs,
    overlay: () => required(overlay, 'expected overlay'), ended: () => ended,
    widget: () => required(widget, 'expected widget')({}, theme).render(120).join('\n'),
    open: () => required(commands.get('dev-workers'), 'expected workers command').handler('', ctx),
    start: () => required(commands.get('dev-ship'), 'expected ship command').handler('project', ctx),
  };
}

test('ordinary main-console Explorer uses the exact same hub without any controller', async t => {
  const f = fixture(t); await f.emit('session_start');
  await required(f.tools.get('explore'), 'expected explore tool').execute('call', { task: 'Inspect old scheduler' }, new AbortController().signal, undefined, f.ctx);
  assert.match(f.widget(), /Inspect old scheduler/); const opened = f.open(); f.overlay().handleInput(keys.enter);
  assert.match(screen(f.overlay()), /To: Explorer · Inspect old scheduler/);
  f.overlay().handleInput('Find its tests'); f.overlay().handleInput(keys.enter); await tick();
  assert.deepEqual((required(f.hub.list()[0], 'expected worker').session as TestSession).calls, [['steer', 'Find its tests']]);
  f.overlay().handleInput('\x1ba'); await opened; assert.equal(f.ended(), false);
});

test('human approval is not displayed or accepted by opening a thread or pressing ordinary Enter', async t => {
  let decision: { action: 'cancel' } | undefined;
  const f = fixture(t, async h => { decision = await h.review('Approve HEAD abc?', '# Candidate abc') as { action: 'cancel' }; });
  await f.emit('session_start'); register(f.hub, session(), 'other'); const work = f.start(); await tick();
  assert.equal(f.dialogs.length, 0); const opened = f.open(); f.overlay().handleInput(keys.enter); f.overlay().handleInput(keys.enter); await tick();
  assert.equal(f.dialogs.length, 0); assert.equal(f.ended(), false); f.overlay().handleInput('\x1ba'); await opened;
  await required(f.commands.get('dev-respond'), 'expected response command').handler('', f.ctx); await work;
  assert.equal(f.dialogs.length, 1); assert.equal(required(f.dialogs[0], 'expected dialog').choices[0], 'Cancel'); assert.deepEqual(decision, { action: 'cancel' });
});

test('controller ownership blocks Main mutations and shell commands, not ordinary read tools', async t => {
  let finish!: () => void; const f = fixture(t, () => new Promise<void>(resolve => { finish = resolve; })); await f.emit('session_start'); const work = f.start(); await tick();
  assert.equal((await f.emit('tool_call', { toolName: 'edit' }) as { block: boolean }).block, true); assert.equal((await f.emit('tool_call', { toolName: 'unknown_custom_writer' }) as { block: boolean }).block, true);
  assert.equal(await f.emit('tool_call', { toolName: 'read' }), undefined); assert.equal(await f.emit('tool_call', { toolName: 'explore' }), undefined);
  assert.equal(((await f.emit('user_bash')) as { result: { exitCode: number } }).result.exitCode, 1); assert.equal(((await f.emit('session_before_switch')) as { cancel: boolean }).cancel, true);
  finish(); await work; assert.equal(await f.emit('tool_call', { toolName: 'edit' }), undefined);
  const child = register(f.hub, session(), 'writer', { metadata: { readOnly: false } }); assert.equal(((await f.emit('tool_call', { toolName: 'edit' })) as { block: boolean }).block, true);
  f.hub.unregister(child.id); assert.equal(await f.emit('tool_call', { toolName: 'edit' }), undefined);
});

test('parent-scoped external registration is explicit and works with arbitrary roles', async t => {
  const f = fixture(t); await f.emit('session_start'); let adapter: ExternalAdapter | undefined;
  required(f.events.get('dev:worker-hub'), 'expected event adapter')({ sessionId: 'wrong', receive: () => assert.fail('wrong parent') });
  required(f.events.get('dev:worker-hub'), 'expected event adapter')({ sessionId: f.ctx.sessionManager.getSessionId(), receive: (value: ExternalAdapter) => { adapter = value; } });
  const s = session(), handle = required(adapter, 'expected adapter').register({ id: 'custom', label: 'Debugger · event loop', role: 'custom-debugger', model: 'any-model', thinking: 'low', session: s, metadata: { readOnly: true } });
  assert.match(f.widget(), /Debugger/); const opened = f.open(); f.overlay().handleInput(keys.enter); assert.match(screen(f.overlay()), /Debugger/);
  handle.finish(); assert.equal(required(f.hub.get('custom'), 'expected worker').state, 'completed'); assert.equal(s.calls.length, 0); f.overlay().handleInput('\x1ba'); await opened;
});

test('pause at an unclaimed approval restores Main without making a decision', async t => {
  const f = fixture(t, async h => { await h.review('Approve?', 'Review'); }); await f.emit('session_start'); const work = f.start(); await tick(); await required(f.commands.get('dev-pause'), 'expected pause command').handler('', f.ctx); await work;
  assert.equal(f.dialogs.length, 0); assert.match(f.widget(), /paused/); assert.match(String(required(f.notifications.at(-1), 'expected notification')[0]), /resume with \/dev-ship project/);
});

test('a controller cannot begin while Main has an active turn or native question', async t => {
  const f = fixture(t); await f.emit('session_start'); f.ctx.isIdle = () => false; await f.start(); assert.equal(f.ended(), false);
  f.ctx.isIdle = () => true; await f.emit('ui_prompt_start'); await f.start(); assert.equal(f.ended(), false); await f.emit('ui_prompt_end'); await f.start(); assert.equal(f.ended(), true);
});

test('controller audit retains stdout and stderr, and records command interruption', async t => {
  const f = fixture(t, async h => { await h.exec('check', ['one']); await h.exec('check', ['two']); }); await f.emit('session_start'); let calls = 0;
  f.pi.exec = async () => { if (++calls === 1) return { code: 0, stdout: 'test evidence', stderr: 'diagnostic warning' }; throw new Error('command cancelled'); };
  await f.start(); const result = required(f.audit.find(entry => entry.data.kind === 'command end'), 'expected command audit').data;
  assert.equal(result.stdout, 'test evidence'); assert.equal(result.stderr, 'diagnostic warning'); assert.match(required(f.audit.find(entry => entry.data.kind === 'command interrupted'), 'expected interruption audit').data.error ?? '', /cancelled/);
});

test('Main waiting synchronously on a child can answer that child without aborting either conversation', async t => {
  const f = fixture(t); await f.emit('session_start'); register(f.hub, session(), 'child'); f.ctx.isIdle = () => false; const cancellation = new AbortController(); let seen = false;
  const pending = f.hub.request({ ownerId: 'child', title: 'Which API?', run: async () => { seen = true; return 'existing'; } }, cancellation.signal);
  await required(f.commands.get('dev-respond'), 'expected response command').handler(required(f.hub.questions()[0], 'expected question').id, f.ctx);
  assert.equal(await pending, 'existing'); assert.equal(seen, true); assert.equal(cancellation.signal.aborted, false);
});

test('F2 explicitly claims controller approval after releasing only the hub overlay', async t => {
  let result: boolean | undefined; const f = fixture(t, async h => { result = await h.confirm('Approve?', 'Exact candidate'); }); await f.emit('session_start'); register(f.hub, session(), 'child'); const work = f.start(); await tick();
  const opened = f.open(); f.overlay().handleInput(keys.f2); screen(f.overlay()); f.overlay().handleInput(keys.enter); await tick(); await tick(); await opened; await work;
  assert.equal(f.dialogs.length, 1); assert.equal(required(f.dialogs[0], 'expected dialog').choices[0], 'Cancel'); assert.equal(result, false);
});
