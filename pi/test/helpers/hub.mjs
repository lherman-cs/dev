import { createJiti } from 'jiti';
import { initTheme } from '@earendil-works/pi-coding-agent';
const { theme } = await import(new URL('./modes/interactive/theme/theme.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
import { WorkerHub } from '../../lib/worker-hub.mjs';
export { WorkerHub, theme };
initTheme('dark', false);
export const { AgentHubView, createHubViewState, compactWorkerLines } = await createJiti(import.meta.url).import('../../worker-hub-ui.ts');
export const { NativeTranscript } = await createJiti(import.meta.url).import('../../lib/worker-transcript.ts');
export const keys = { enter:'\r', escape:'\x1b', left:'\x1b[D', right:'\x1b[C', up:'\x1b[A', down:'\x1b[B', altUp:'\x1b[1;3A', altDown:'\x1b[1;3B', pageUp:'\x1b[5~', pageDown:'\x1b[6~', home:'\x1b[H', end:'\x1b[F', f1:'\x1bOP', f2:'\x1bOQ', f3:'\x1bOR', f4:'\x1bOS' };
export const tick = () => new Promise(r => setImmediate(r));
export const strip = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b_[^\x07]*\x07/g,'').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'');
export const screen = (view, width=80) => strip(view.render(width).join('\n'));
export const user = text => ({role:'user',content:[{type:'text',text}],timestamp:Date.now()});
export const assistant = text => ({role:'assistant',content:[{type:'text',text}],stopReason:'stop',timestamp:Date.now()});
export function session() {
  const listeners = new Set(), calls = [];
  return {messages:[],calls,isStreaming:true,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    emit(event){for(const fn of [...listeners]) fn(event);},
    append(message){this.emit({type:'message_start',message});this.messages.push(message);this.emit({type:'message_end',message});},
    async steer(text){calls.push(['steer',text]);}, async followUp(text){calls.push(['followUp',text]);}, async abort(){calls.push(['abort']);this.isStreaming=false;},
    listenerCount:()=>listeners.size,
    getContextUsage:()=>({tokens:42,percent:4.2,contextWindow:1000}),
  };
}
export function register(hub,s,id='agent:a',extra={}) {
  hub.register({id,label:`Explorer · ${id}`,role:'explorer',model:'gpt-5.6-luna',thinking:'medium',session:s,metadata:{task:'Inspect tests',readOnly:true},...extra});
  return hub.get(id);
}
export function viewFixture(t,{rows=24,hub=new WorkerHub(),state=createHubViewState(),options={}}={}) {
  let renders=0,closed=0;
  const tui={terminal:{rows,columns:80}, requestRender(){renders++;}};
  const view=new AgentHubView(tui,theme,hub,'Main session',()=>{closed++;},state,options);
  t.after(()=>{view.dispose();hub.dispose();});
  return {view,hub,tui,state,closed:()=>closed,renders:()=>renders};
}
