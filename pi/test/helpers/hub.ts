import type { TestContext } from 'node:test';
import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { TUI } from '@earendil-works/pi-tui';
import { WorkerHub } from '../../lib/worker-hub.ts';
import type { RegisterWorker, WorkerEvent, WorkerMessage, WorkerSession } from '../../lib/worker-types.ts';
import { AgentHubView, compactWorkerLines, createHubViewState, type HubViewState } from '../../worker-hub-ui.ts';
import { NativeTranscript } from '../../lib/worker-transcript.ts';

const themeModule = await import(new URL('./modes/interactive/theme/theme.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href) as { theme: Theme };
export const { theme } = themeModule;
export { AgentHubView, compactWorkerLines, createHubViewState, NativeTranscript, WorkerHub };
initTheme('dark', false);

export const keys = { enter:'\r', escape:'\x1b', left:'\x1b[D', right:'\x1b[C', up:'\x1b[A', down:'\x1b[B', altUp:'\x1b[1;3A', altDown:'\x1b[1;3B', pageUp:'\x1b[5~', pageDown:'\x1b[6~', home:'\x1b[H', end:'\x1b[F', f1:'\x1bOP', f2:'\x1bOQ', f3:'\x1bOR', f4:'\x1bOS' } as const;
export const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
export const strip = (text: string): string => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b_[^\x07]*\x07/g,'').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'');
export const screen = (view: Pick<AgentHubView, 'render'>, width = 80): string => strip(view.render(width).join('\n'));
export const user = (text: string): UserMessage => ({role:'user',content:[{type:'text',text}],timestamp:Date.now()});
export const assistant = (text: string): AssistantMessage => ({role:'assistant',content:[{type:'text',text}],api:'openai-responses',provider:'openai-codex',model:'gpt-5.6-luna',stopReason:'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});

export type SessionCall = ['steer' | 'followUp', string] | ['abort'];
export interface TestSession extends WorkerSession {
  messages: WorkerMessage[];
  calls: SessionCall[];
  emit(event: WorkerEvent): void;
  append(message: WorkerMessage): void;
  listenerCount(): number;
}
export function session(): TestSession {
  const listeners = new Set<(event: WorkerEvent) => void>();
  const calls: SessionCall[] = [];
  const value: TestSession = {
    messages:[], calls, isStreaming:true,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(event) { for (const fn of [...listeners]) fn(event); },
    append(message) { this.emit({type:'message_start',message}); this.messages.push(message); this.emit({type:'message_end',message}); },
    async steer(text) { calls.push(['steer',text]); },
    async followUp(text) { calls.push(['followUp',text]); },
    async abort() { calls.push(['abort']); this.isStreaming=false; },
    listenerCount: () => listeners.size,
    getContextUsage: () => ({tokens:42,percent:4.2,contextWindow:1000}),
  };
  return value;
}

type RegisterExtra = Partial<Omit<RegisterWorker, 'id' | 'role' | 'model' | 'thinking' | 'session'>>;
export function register(hub: WorkerHub, workerSession: WorkerSession, id = 'agent:a', extra: RegisterExtra = {}) {
  hub.register({id,label:`Explorer · ${id}`,role:'explorer',model:'gpt-5.6-luna',thinking:'medium',session:workerSession,metadata:{task:'Inspect tests',readOnly:true},...extra});
  const record = hub.get(id);
  if (!record) throw new Error(`Worker ${id} was not registered`);
  return record;
}

interface ViewFixtureOptions {
  rows?: number;
  hub?: WorkerHub;
  state?: HubViewState;
  options?: ConstructorParameters<typeof AgentHubView>[6];
}
export function viewFixture(t: TestContext, {rows=24,hub=new WorkerHub(),state=createHubViewState(),options={}}: ViewFixtureOptions = {}) {
  let renders=0,closed=0;
  const terminal={rows,columns:80};
  const tui = {terminal, requestRender(){renders++;}} as TUI;
  const view=new AgentHubView(tui,theme,hub,'Main session',()=>{closed++;},state,options);
  t.after(()=>{view.dispose();hub.dispose();});
  return {view,hub,tui,state,setSize:(nextRows: number,nextColumns = terminal.columns): void=>{terminal.rows=nextRows;terminal.columns=nextColumns;},closed:()=>closed,renders:()=>renders};
}
