import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRuntime, createAgentSession, SessionManager, SettingsManager, type AgentSession, type AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createWorkerRunner, workerSettings } from '../lib/worker.ts';
import { WorkerHub } from '../lib/worker-hub.ts';
import { WorkerHistory } from '../lib/worker-history.ts';

type StreamModel = Parameters<ModelRuntime['streamSimple']>[0];
type StreamContext = Parameters<ModelRuntime['streamSimple']>[1];
type StreamOptions = NonNullable<Parameters<ModelRuntime['streamSimple']>[2]>;
type DoneInput = string | AssistantMessage['content'] | AssistantMessage;
type Done = (input: DoneInput, reason?: AssistantMessage['stopReason']) => void;
type AnswerContext = { n: number; model: StreamModel; context: StreamContext; options: StreamOptions; stream: ReturnType<typeof createAssistantMessageEventStream>; done: Done; hub: WorkerHub; sessions: AgentSession[] };
type Answer = (context: AnswerContext) => string | AssistantMessage | void;
interface FixtureOptions { settingsFor?: typeof workerSettings }
interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(reason?: unknown): void }
const deferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};
const msg = (model: StreamModel, text: string | AssistantMessage['content'], reason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage => ({role:'assistant',content:typeof text==='string'?[{type:'text',text}]:text,stopReason:reason,provider:model.provider,model:model.id,api:model.api,timestamp:Date.now(),usage:{input:10,output:2,cacheRead:0,cacheWrite:0,totalTokens:12,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
const required = <T>(value: T | undefined, label: string): T => { assert.notEqual(value, undefined, `${label} is required`); return value as T; };
const firstText = (message: { content: string | Array<{ type: string; text?: string }> }): string | undefined => typeof message.content === 'string' ? message.content : message.content.find(part => part.type === 'text')?.text;
async function fixture(t: TestContext, answer: Answer, {settingsFor}: FixtureOptions = {}) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'hub-native-'));
  const oldConfig=process.env['PI_VCC_CONFIG_PATH'];process.env['PI_VCC_CONFIG_PATH']=path.join(cwd,'vcc.json');
  const runtime=await ModelRuntime.create();runtime.hasConfiguredAuth=()=>true;
  const parent=SessionManager.create(cwd,path.join(cwd,'parent')),history=new WorkerHistory(parent);
  const hub=new WorkerHub({history}),sessions: AgentSession[]=[],calls: Array<{model: StreamModel; context: StreamContext}>=[],events: AgentSessionEvent[]=[];
  const run=createWorkerRunner({hub,runtime,getHistory:()=>history,...(settingsFor ? { settingsFor } : {}),askHuman:({ownerId,question},signal)=>hub.request({ownerId,title:question,run:async response=>{
    if (!response || typeof response !== 'object' || !('answer' in response) || typeof response.answer !== 'string') throw new Error('Human response must contain an answer.');
    return response.answer;
  }},signal),create:async opts=>{
    const result=await createAgentSession(opts);sessions.push(result.session);result.session.subscribe(event=>events.push(event));return result;
  }});
  hub.onRelated=run.related;
  runtime.streamSimple=(model,context,options={})=>{
    const stream=createAssistantMessageEventStream();
    if(options.signal?.aborted){queueMicrotask(()=>stream.push({type:'error',reason:'aborted',error:msg(model,[],'aborted')}));return stream;}
    calls.push({model,context});
    const done: Done=(input,reason='stop')=>{
      const message=typeof input==='object'&&!Array.isArray(input)&&input !== null && 'role' in input ? input : msg(model,input,reason);
      if (message.stopReason === 'error' || message.stopReason === 'aborted') stream.push({type:'error',reason:message.stopReason,error:message});
      else if (message.stopReason === 'pending') throw new Error('A pending assistant message cannot finish a test stream.');
      else stream.push({type:'done',reason:message.stopReason,message});
    };
    options.signal?.addEventListener('abort',()=>stream.push({type:'error',reason:'aborted',error:{...msg(model,[],'aborted'),errorMessage:'cancelled'}}),{once:true});
    const result=answer({n:calls.length,model,context,options,stream,done,hub,sessions});
    if(result)queueMicrotask(()=>done(result));return stream;
  };
  t.after(async()=>{await run.stopAll();hub.dispose();if(oldConfig===undefined)delete process.env['PI_VCC_CONFIG_PATH'];else process.env['PI_VCC_CONFIG_PATH']=oldConfig;fs.rmSync(cwd,{recursive:true,force:true});});
  return {cwd,hub,history,run,sessions,calls,events};
}

test('real SDK delivers a queued human message once and keeps it in the saved child history',{timeout:10000},async t=>{
  const ready=deferred<Done>();
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    assert.equal(context.messages.filter(message=>message.role==='user'&&firstText(message)==='Please inspect\nthe old path').length,1);
    return msg(model,'follow-up answered');
  });
  const work=f.run({cwd:f.cwd,name:'explorer',task:'first request'});const finish=await ready.promise;
  const r=required(f.hub.list()[0],'worker'),delivery=await f.hub.send(r.id,'Please inspect\nthe old path');assert.equal(delivery.status,'queued');
  finish('initial answer');assert.equal(await work,'follow-up answered');assert.equal(delivery.status,'delivered');
  const saved=f.history.read(required(r.file,'worker file'));assert.ok(saved.messages?.some(message=>message.role==='user'&&firstText(message)==='Please inspect\nthe old path'));
  assert.equal(required(saved.deliveries[0],'delivery').status,'delivered');assert.equal(f.run.hasActive(),false);
});

test('late input at agent_settled is rejected without reopening the agent',{timeout:10000},async t=>{
  const f=await fixture(t,({model})=>msg(model,'finished'));let late,attempted=false;
  const off=f.hub.subscribe((_rs,r)=>{if(r?.activity==='Settled'&&!attempted){attempted=true;late=f.hub.send(r.id,'late').then(()=>assert.fail('accepted late input'),e=>assert.match(e.message,/finished|accepting/i));}});
  assert.equal(await f.run({cwd:f.cwd,name:'explorer',task:'work'}),'finished');await late;off();assert.equal(f.calls.length,1);
});

test('an already accepted literal send crossing a turn boundary is awaited before releasing the result',{timeout:10000},async t=>{
  const ready=deferred<Done>(),release=deferred(),settled=deferred();
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    assert.match(JSON.stringify(context.messages),/must not be lost/);
    return msg(model,'corrected answer');
  });
  const work=f.run({cwd:f.cwd,name:'explorer',task:'work'});
  const finish=await ready.promise,s=required(f.sessions[0],'session'),original=s.prompt.bind(s);
  s.prompt=async(text,options)=>{await release.promise;return original(text,options);};
  s.subscribe(e=>{if(e.type==='agent_settled')settled.resolve();});
  const r=required(f.hub.list()[0],'worker');const send=f.hub.send(r.id,'must not be lost');finish('stale answer');await settled.promise;
  assert.equal(r.closed,false);release.resolve();await send;assert.equal(await work,'corrected answer');
  assert.equal(r.state,'completed');assert.equal(required(r.deliveries[0],'delivery').status,'delivered');assert.equal(f.calls.length,2);
  assert.match(required(f.history.read(required(r.file,'worker file')).deliveries[0],'delivery').text,/must not be lost/);
});

test('human feedback invalidates a previously submitted Reviewer PASS',{timeout:10000},async t=>{
  const ready=deferred<Done>();const schema={type:'object',required:['verdict'],properties:{verdict:{enum:['pass','repairs','blocked']}}};
  const f=await fixture(t,({n,model,done})=>{
    if(n===1)return msg(model,[{type:'toolCall',id:'verdict',name:'submit_result',arguments:{verdict:'pass'}}],'toolUse');
    if(n===2){ready.resolve(done);return;}
    return msg(model,'I saw your new feedback, but did not resubmit a verdict.');
  });
  const work=f.run({cwd:f.cwd,name:'review',task:'review',schema,skill:'dev-review'});const rejection=assert.rejects(work,/no current structured result/);
  const finish=await ready.promise;await f.hub.send(required(f.hub.list()[0],'worker').id,'Missing invariant; reconsider this review');finish('old pass');
  await rejection;assert.equal(f.calls.length,3);
});

test('Reviewer cannot silently submit PASS after receiving human feedback',{timeout:10000},async t=>{
  const ready=deferred<Done>();const schema={type:'object',required:['verdict'],properties:{verdict:{enum:['pass','repairs','blocked']}}};
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    if(n===2)return msg(model,[{type:'toolCall',id:'bad',name:'submit_result',arguments:{verdict:'pass'}}],'toolUse');
    if(n===3){assert.match(JSON.stringify(context.messages),/never silent PASS/);return msg(model,[{type:'toolCall',id:'good',name:'submit_result',arguments:{verdict:'blocked'}}],'toolUse');}
    return msg(model,'blocked pending clarification');
  });
  const work=f.run({cwd:f.cwd,name:'review',task:'review',schema,skill:'dev-review'});const finish=await ready.promise;
  await f.hub.send(required(f.hub.list()[0],'worker').id,'A requirement is missing');finish('checking');
  assert.deepEqual(await work,{verdict:'blocked'});
});

test('a rejected native input pipeline keeps its message recoverable without invalidating earlier work',{timeout:10000},async t=>{
  const ready=deferred<Done>();const f=await fixture(t,({model,n,done})=>{if(n===1){ready.resolve(done);return;}return msg(model,'done');});
  const work=f.run({cwd:f.cwd,name:'explorer',task:'research'});const finish=await ready.promise;
  required(f.sessions[0],'session').prompt=async()=>{throw new Error('Native input rejected');};
  await assert.rejects(f.hub.send(required(f.hub.list()[0],'worker').id,'Preserve this instruction'),/Native input rejected/);finish('done');
  assert.equal(await work,'done');assert.equal(f.calls.length,1);
});

test('stop a Builder cancels nested Explorer; no child outlives its owner or retries',{timeout:10000},async t=>{
  const ready=deferred();let builders=0;
  const f=await fixture(t,({model})=>{
    if(model.id==='gpt-5.6-luna'){ready.resolve();return;}
    if(++builders===1)return msg(model,[{type:'toolCall',id:'explore',name:'explore',arguments:{task:'Find an API'}}],'toolUse');
    return msg(model,'should not reach this');
  });
  const work=f.run({cwd:f.cwd,name:'build',task:'build',skill:'dev-build'});const rejection=assert.rejects(work,/abort|cancel/i);await ready.promise;
  const parent=required(f.hub.list().find(record=>record.role==='build'),'builder'),child=required(f.hub.list().find(record=>record.role==='explorer'),'explorer');
  assert.equal(child.metadata['parentId'],parent.id);assert.equal(builders,2,'Builder continued after the asynchronous Explorer receipt');await f.hub.abort(parent.id);await rejection;
  assert.ok(f.hub.list().every(r=>r.state==='aborted'));assert.ok(f.sessions.every(s=>!s.isStreaming));assert.equal(builders,2);
});

test('parallel Explorers keep distinct contexts, identities and sibling failures isolated',{timeout:10000},async t=>{
  const pending: Array<Pick<AnswerContext, 'model' | 'context' | 'done'>>=[];
  const f=await fixture(t,({model,context,done})=>{pending.push({model,context,done});});
  const first=f.run({cwd:f.cwd,name:'explorer',task:'Inspect subsystem A; exclude B'});
  const second=f.run({cwd:f.cwd,name:'explorer',task:'Inspect subsystem B; exclude A'});
  while(pending.length<2)await new Promise(r=>setImmediate(r));
  const active=f.hub.list().filter(r=>r.session);
  assert.equal(active.length,2);const activeA=required(active[0],'first explorer'),activeB=required(active[1],'second explorer');assert.notEqual(activeA.id,activeB.id);assert.notEqual(activeA.file,activeB.file);
  const pendingA=required(pending[0],'first pending call'),pendingB=required(pending[1],'second pending call');
  assert.ok(!JSON.stringify(pendingA.context.messages).includes('subsystem B'));
  assert.ok(!JSON.stringify(pendingB.context.messages).includes('subsystem A'));
  pendingA.done({...msg(pendingA.model,[],'error'),errorMessage:'A unavailable'});
  pendingB.done('B evidence');
  const results=await Promise.allSettled([first,second]);
  const failed=required(results[0],'failed result'),succeeded=required(results[1],'successful result');
  assert.equal(failed.status,'rejected');if(failed.status==='rejected')assert.match(String(failed.reason),/A unavailable/);
  assert.deepEqual(succeeded,{status:'fulfilled',value:'B evidence'});
  const records=f.hub.list();assert.equal(records.filter(r=>r.role==='explorer').length,2);
  assert.equal(required(records.find(record=>String(record.metadata['task']).includes('subsystem A')),'failed explorer').state,'failed');
  assert.equal(required(records.find(record=>String(record.metadata['task']).includes('subsystem B')),'completed explorer').state,'completed');
});

test('one parent cancellation stops all of its parallel Explorers',{timeout:10000},async t=>{
  const started=deferred();let count=0;const controller=new AbortController();
  const f=await fixture(t,()=>{if(++count===2)started.resolve();});
  const work=[
    f.run({cwd:f.cwd,name:'explorer',task:'scope A',signal:controller.signal}),
    f.run({cwd:f.cwd,name:'explorer',task:'scope B',signal:controller.signal}),
  ];
  await started.promise;controller.abort();
  const results=await Promise.allSettled(work);
  assert.ok(results.every(result=>result.status==='rejected'&&/abort|cancel/i.test(String(result.reason))));
  assert.ok(f.hub.list().every(r=>r.state==='aborted'));
  assert.ok(f.sessions.every(s=>!s.isStreaming));
});

test('related question starts a NEW read-only Explorer without changing the old outcome',{timeout:10000},async t=>{
  const f=await fixture(t,({model})=>msg(model,'research result'));
  await f.run({cwd:f.cwd,name:'build',task:'original',skill:'dev-build'});
  const old=required(f.hub.list()[0],'original worker'),oldMessages=JSON.stringify(old.messages),id=await f.hub.related(old.id,'What did the old code do?');
  // Allow the already-started related run to settle; opening this thread does
  // not restart the original parent work.
  while(f.run.hasActive())await new Promise(r=>setImmediate(r));
  const fresh=required(f.hub.get(id),'related worker');assert.notEqual(fresh.id,old.id);assert.equal(fresh.metadata['readOnly'],true);assert.equal(fresh.metadata['relatedTo'],old.id);
  assert.equal(JSON.stringify(old.messages),oldMessages);assert.equal(old.state,'completed');assert.equal(f.calls.length,2);
});

test('pinned VCC recall accesses this child session, not a sibling',{timeout:10000},async t=>{
  let round=0;
  const f=await fixture(t,({model,context})=>{
    if(++round===1)return msg(model,'Sibling-only PRIVATE_SIBLING_SENTINEL');
    if(round===2)return msg(model,[{type:'toolCall',id:'recall',name:'vcc_recall',arguments:{query:'SECOND_CHILD_CANARY',scope:'all'}}],'toolUse');
    assert.match(JSON.stringify(context.messages),/SECOND_CHILD_CANARY/);assert.ok(!JSON.stringify(context.messages).includes('PRIVATE_SIBLING_SENTINEL'));
    const result=context.messages.find(message=>message.role==='toolResult'&&message.toolName==='vcc_recall');
    if (!result || result.role !== 'toolResult') assert.fail('Expected vcc_recall tool result.');
    assert.ok(!result.isError,JSON.stringify(result));
    return msg(model,'recall complete');
  });
  await f.run({cwd:f.cwd,name:'explorer',task:'first'});
  await f.run({cwd:f.cwd,name:'explorer',task:'SECOND_CHILD_CANARY'});
  assert.ok(f.sessions.every(s=>s.getActiveToolNames().includes('vcc_recall')));assert.ok(f.hub.list().every(record=>record.metadata['vcc']));
});

test('pinned VCC performs actual auto-compaction while retaining full child audit history',{timeout:10000},async t=>{
  const ready=deferred<Done>();
  const f=await fixture(t,({n,model,done})=>{
    if(n===1){ready.resolve(done);return;}
    const message=msg(model,'Final answer retained after compaction');
    return {...message,usage:{...message.usage,input:260000,totalTokens:260002}};
  },{settingsFor:()=>SettingsManager.inMemory({compaction:{enabled:true,reserveTokens:16384,keepRecentTokens:1}})});
  fs.writeFileSync(required(process.env['PI_VCC_CONFIG_PATH'],'VCC config path'),JSON.stringify({overrideDefaultCompaction:true,smartKeepTail:false}));
  const work=f.run({cwd:f.cwd,name:'explorer',task:'Analyze this trace: '+Array.from({length:1500},(_,i)=>`Important trace entry ${i}.`).join('\n')});
  const finish=await ready.promise;await f.hub.followUp(required(f.hub.list()[0],'worker').id,'Now conclude');finish('initial analysis');await work;
  const session=required(f.sessions[0],'session'),record=required(f.hub.list()[0],'worker'),file=required(record.file,'worker file');
  assert.ok(f.events.some(event=>event.type==='compaction_end'&&event.result),JSON.stringify({types:f.events.map(event=>event.type),usage:session.messages.filter(message=>message.role==='assistant').map(message=>message.usage),details:f.history.open(file).getEntries().map(entry=>entry.type)}));
  const entries=f.history.open(file).getEntries();
  assert.ok(entries.some(entry=>entry.type==='compaction'&&JSON.stringify(entry.details).includes('pi-vcc')),JSON.stringify(entries.filter(entry=>entry.type==='compaction').map(entry=>entry.details)));
  assert.ok(record.messages?.some(message=>message.role==='assistant'&&firstText(message)==='Final answer retained after compaction')); 
});

test('result tool already generated before a queued instruction cannot certify a new input epoch',{timeout:10000},async t=>{
  const ready=deferred<Done>();const schema={type:'object',required:['title'],properties:{title:{type:'string'}}};
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    assert.match(JSON.stringify(context.messages),/Read the pending human instruction/);
    return msg(model,'Acknowledged the correction but forgot to submit a new title.');
  });
  const work=f.run({cwd:f.cwd,name:'ship',task:'title',schema,tools:['read']});const rejection=assert.rejects(work,/no current structured result/);
  const finish=await ready.promise;await f.hub.send(required(f.hub.list()[0],'worker').id,'Please change the title');
  finish([{type:'toolCall',id:'old-title',name:'submit_result',arguments:{title:'Generated before your correction'}}],'toolUse');
  await rejection;
});

test('cancelled queued feedback does not become delivered feedback or poison a new review result',{timeout:10000},async t=>{
  const ready=deferred<Done>();const schema={type:'object',required:['verdict'],properties:{verdict:{enum:['pass','repairs','blocked']}}};
  const f=await fixture(t,({n,model,done})=>{if(n===1){ready.resolve(done);return;}return msg(model,'done');});
  const work=f.run({cwd:f.cwd,name:'review',task:'review',schema,skill:'dev-review'});const finish=await ready.promise;
  const r=required(f.hub.list()[0],'worker');await f.hub.send(r.id,'Never mind, cancel this');assert.equal(await f.hub.cancelQueued(r.id),1);
  assert.equal(required(r.deliveries[0],'delivery').status,'cancelled');
  finish([{type:'toolCall',id:'new-verdict',name:'submit_result',arguments:{verdict:'pass'}}],'toolUse');
  assert.deepEqual(await work,{verdict:'pass'});assert.equal(required(r.deliveries[0],'delivery').status,'cancelled');
});
