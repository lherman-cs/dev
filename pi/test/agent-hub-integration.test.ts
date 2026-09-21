import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { WorkerHub, session, register, theme, keys, tick, screen } from './helpers/hub.ts';
const {default:extension}=await createJiti(import.meta.url).import('../extension.ts');

function fixture(t,workflow=async()=>{}) {
  const handlers=new Map(),commands=new Map(),shortcuts=new Map(),tools=new Map(),events=new Map(),hub=new WorkerHub(),audit=[],notifications=[],dialogs=[];
  let overlay,resolveOverlay,widget,received,ended=false;
  const emit=async(name,event={})=>{let result;for(const f of handlers.get(name)||[])result=await f(event,ctx);return result;};
  const run=async ({task,name,metadata={}})=>{
    const s=session();register(hub,s,hub.nextId(name),{label:`Explorer · ${task}`,metadata:{readOnly:true,...metadata}});
    return {status:'FOUND',answer:'Scheduler evidence',evidence:[{claim:'Scheduler test',anchor:'test/scheduler.test.ts:1'}]};
  };
  run.hasActive=()=>hub.list().some(r=>r.session);run.stopAll=async()=>{for(const r of hub.list().filter(r=>r.session)){await hub.abort(r.id);hub.unregister(r.id,'aborted');}};
  run.related=async()=>assert.fail('unexpected related call');
  const pi={
    on(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},
    registerCommand:(n,c)=>commands.set(n,c),registerShortcut:(k,s)=>shortcuts.set(k,s),registerTool:t=>tools.set(t.name,t),
    registerEntryRenderer(){},appendEntry:(type,data)=>audit.push({type,data}),sendMessage(){},sendUserMessage(){},
    exec:async()=>({code:0,stdout:'',stderr:''}),
    events:{on:(name,fn)=>{events.set(name,fn);return()=>events.delete(name);}},
  };
  const ctx={cwd:process.cwd(),hasUI:true,isIdle:()=>true,hasPendingMessages:()=>false,sessionManager:SessionManager.inMemory(process.cwd()),
    ui:{notify:(...a)=>notifications.push(a),setStatus(){},setWidget:(_key,factory)=>{widget=factory;},
      async select(title,choices){dialogs.push({title,choices});return choices[0];},
      editor:async()=>'',
      custom(factory){void emit('ui_prompt_start');return new Promise(resolve=>{
        resolveOverlay=()=>{overlay?.dispose();overlay=undefined;void emit('ui_prompt_end');resolve();};
        overlay=factory({terminal:{rows:24,columns:80},requestRender(){}},theme,{},resolveOverlay);
      });},
    },
  };
  extension(pi,{hub,createWorkerRunner:()=>run,runWorkflow:async h=>{await workflow(h);ended=true;}});
  t.after(async()=>{resolveOverlay?.();await emit('session_shutdown');});
  return {pi,hub,ctx,emit,commands,shortcuts,tools,events,audit,notifications,dialogs,
    overlay:()=>overlay,ended:()=>ended,widget:()=>widget?.({},theme).render(120).join('\n'),
    open:()=>commands.get('dev-workers').handler('',ctx),
    start:()=>commands.get('dev-ship').handler('project',ctx),
  };
}

test('ordinary main-console Explorer uses the exact same hub without any controller',async t=>{
  const f=fixture(t);await f.emit('session_start');
  await f.tools.get('explore').execute('call',{task:'Inspect old scheduler'},new AbortController().signal,undefined,f.ctx);
  assert.match(f.widget(),/Inspect old scheduler/);const opened=f.open();f.overlay().handleInput(keys.enter);
  assert.match(screen(f.overlay()),/To: Explorer · Inspect old scheduler/);
  f.overlay().handleInput('Find its tests');f.overlay().handleInput(keys.enter);await tick();
  assert.deepEqual(f.hub.list()[0].session.calls,[['steer','Find its tests']]);
  f.overlay().handleInput('\x1ba');await opened;assert.equal(f.ended(),false);
});

test('human approval is not displayed or accepted by opening a thread or pressing ordinary Enter',async t=>{
  let decision;
  const f=fixture(t,async h=>{decision=await h.review('Approve HEAD abc?','# Candidate abc');});
  await f.emit('session_start');register(f.hub,session(),'other');const work=f.start();await tick();
  assert.equal(f.dialogs.length,0);const opened=f.open();f.overlay().handleInput(keys.enter);f.overlay().handleInput(keys.enter);await tick();
  assert.equal(f.dialogs.length,0);assert.equal(f.ended(),false);
  f.overlay().handleInput('\x1ba');await opened;
  await f.commands.get('dev-respond').handler('',f.ctx);await work;
  assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].choices[0],'Cancel');assert.deepEqual(decision,{action:'cancel'});
});

test('controller ownership blocks Main mutations and shell commands, not ordinary read tools',async t=>{
  let finish;const f=fixture(t,()=>new Promise(r=>finish=r));await f.emit('session_start');const work=f.start();await tick();
  assert.equal((await f.emit('tool_call',{toolName:'edit'})).block,true);
  assert.equal((await f.emit('tool_call',{toolName:'unknown_custom_writer'})).block,true);
  assert.equal(await f.emit('tool_call',{toolName:'read'}),undefined);
  assert.equal(await f.emit('tool_call',{toolName:'explore'}),undefined);
  assert.equal((await f.emit('user_bash')).result.exitCode,1);
  assert.equal((await f.emit('session_before_switch')).cancel,true);
  finish();await work;assert.equal(await f.emit('tool_call',{toolName:'edit'}),undefined);
  const child=register(f.hub,session(),'writer',{metadata:{readOnly:false}});
  assert.equal((await f.emit('tool_call',{toolName:'edit'})).block,true);
  f.hub.unregister(child.id);assert.equal(await f.emit('tool_call',{toolName:'edit'}),undefined);
});

test('parent-scoped external registration is explicit and works with arbitrary roles',async t=>{
  const f=fixture(t);await f.emit('session_start');let adapter;
  f.events.get('dev:worker-hub')({sessionId:'wrong',receive:()=>assert.fail('wrong parent')});
  f.events.get('dev:worker-hub')({sessionId:f.ctx.sessionManager.getSessionId(),receive:value=>adapter=value});
  const s=session(),handle=adapter.register({id:'custom',label:'Debugger · event loop',role:'custom-debugger',model:'any-model',thinking:'low',session:s,metadata:{readOnly:true}});
  assert.match(f.widget(),/Debugger/);const opened=f.open();f.overlay().handleInput(keys.enter);assert.match(screen(f.overlay()),/Debugger/);
  handle.finish();assert.equal(f.hub.get('custom').state,'completed');assert.equal(s.calls.length,0);
  f.overlay().handleInput('\x1ba');await opened;
});

test('pause at an unclaimed approval restores Main without making a decision',async t=>{
  const f=fixture(t,h=>h.review('Approve?','Review'));await f.emit('session_start');const work=f.start();await tick();
  await f.commands.get('dev-pause').handler();await work;
  assert.equal(f.dialogs.length,0);assert.match(f.widget(),/paused/);assert.match(f.notifications.at(-1)[0],/resume with \/dev-ship project/);
});

test('a controller cannot begin while Main has an active turn or native question',async t=>{
  const f=fixture(t);await f.emit('session_start');f.ctx.isIdle=()=>false;await f.start();assert.equal(f.ended(),false);
  f.ctx.isIdle=()=>true;await f.emit('ui_prompt_start');await f.start();assert.equal(f.ended(),false);
  await f.emit('ui_prompt_end');await f.start();assert.equal(f.ended(),true);
});

test('controller audit retains stdout and stderr, and records command interruption',async t=>{
  const f=fixture(t,async h=>{await h.exec('check',['one']);await h.exec('check',['two']);});
  await f.emit('session_start');let calls=0;
  f.pi.exec=async()=>{if(++calls===1)return{code:0,stdout:'test evidence',stderr:'diagnostic warning'};throw new Error('command cancelled');};
  await f.start();
  const result=f.audit.find(e=>e.data.kind==='command end').data;
  assert.equal(result.stdout,'test evidence');assert.equal(result.stderr,'diagnostic warning');
  assert.match(f.audit.find(e=>e.data.kind==='command interrupted').data.error,/cancelled/);
});

test('Main waiting synchronously on a child can answer that child without aborting either conversation',async t=>{
  const f=fixture(t);await f.emit('session_start');register(f.hub,session(),'child');f.ctx.isIdle=()=>false;
  const cancellation=new AbortController();let seen=false;
  const pending=f.hub.request({ownerId:'child',title:'Which API?',run:async()=>{seen=true;return 'existing';}},cancellation.signal);
  await f.commands.get('dev-respond').handler(f.hub.questions()[0].id,f.ctx);
  assert.equal(await pending,'existing');assert.equal(seen,true);assert.equal(cancellation.signal.aborted,false);
});

test('F2 explicitly claims controller approval after releasing only the hub overlay',async t=>{
  let result;const f=fixture(t,async h=>{result=await h.confirm('Approve?','Exact candidate');});
  await f.emit('session_start');register(f.hub,session(),'child');const work=f.start();await tick();
  const opened=f.open();f.overlay().handleInput(keys.f2);screen(f.overlay());f.overlay().handleInput(keys.enter);
  await tick();await tick();await opened;await work;
  assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].choices[0],'Cancel');assert.equal(result,false);
});
