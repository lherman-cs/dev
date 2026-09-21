import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRuntime, createAgentSession, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createWorkerRunner, workerSettings } from '../lib/worker.mjs';
import { WorkerHub } from '../lib/worker-hub.mjs';
import { WorkerHistory } from '../lib/worker-history.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const msg=(model,text,reason='stop')=>({role:'assistant',content:typeof text==='string'?[{type:'text',text}]:text,stopReason:reason,provider:model.provider,model:model.id,api:model.api,timestamp:Date.now(),usage:{input:10,output:2,cacheRead:0,cacheWrite:0,totalTokens:12,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
async function fixture(t,answer,{persist=true,settingsFor}={}) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'hub-native-'));
  const oldConfig=process.env.PI_VCC_CONFIG_PATH;process.env.PI_VCC_CONFIG_PATH=path.join(cwd,'vcc.json');
  const runtime=await ModelRuntime.create();runtime.hasConfiguredAuth=()=>true;
  const parent=SessionManager.create(cwd,path.join(cwd,'parent')),history=persist?new WorkerHistory(parent):undefined;
  const hub=new WorkerHub({history}),sessions=[],calls=[],events=[];
  const run=createWorkerRunner({hub,runtime,getHistory:()=>history,settingsFor,askHuman:({ownerId,question},signal)=>hub.request({ownerId,title:question,run:ctx=>ctx.answer},signal),create:async opts=>{
    const result=await createAgentSession(opts);sessions.push(result.session);result.session.subscribe(e=>events.push(e));return result;
  }});
  hub.onRelated=run.related;
  runtime.streamSimple=(model,context,options)=>{
    const stream=createAssistantMessageEventStream();
    if(options.signal?.aborted){queueMicrotask(()=>stream.push({type:'error',reason:'aborted',error:msg(model,[],'aborted')}));return stream;}
    calls.push({model,context});
    const done=(text,reason='stop')=>{const message=typeof text==='object'&&!Array.isArray(text)?text:msg(model,text,reason);stream.push({type:'done',reason:message.stopReason,message});};
    options.signal?.addEventListener('abort',()=>stream.push({type:'error',reason:'aborted',error:{...msg(model,[],'aborted'),errorMessage:'cancelled'}}),{once:true});
    const result=answer({n:calls.length,model,context,options,stream,done,hub,sessions});
    if(result)queueMicrotask(()=>done(result));return stream;
  };
  t.after(async()=>{await run.stopAll();hub.dispose();if(oldConfig===undefined)delete process.env.PI_VCC_CONFIG_PATH;else process.env.PI_VCC_CONFIG_PATH=oldConfig;fs.rmSync(cwd,{recursive:true,force:true});});
  return {cwd,hub,history,run,sessions,calls,events};
}

test('real SDK delivers a queued human message once and keeps it in the saved child history',{timeout:10000},async t=>{
  const ready=deferred();
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    assert.equal(context.messages.filter(m=>m.role==='user'&&m.content?.[0]?.text==='Please inspect\nthe old path').length,1);
    return msg(model,'follow-up answered');
  });
  const work=f.run({cwd:f.cwd,name:'explorer',task:'first request'});const finish=await ready.promise;
  const r=f.hub.list()[0],delivery=await f.hub.send(r.id,'Please inspect\nthe old path');assert.equal(delivery.status,'queued');
  finish('initial answer');assert.equal(await work,'follow-up answered');assert.equal(delivery.status,'delivered');
  const saved=f.history.read(r.file);assert.ok(saved.messages.some(m=>m.role==='user'&&m.content[0].text==='Please inspect\nthe old path'));
  assert.equal(saved.deliveries[0].status,'delivered');assert.equal(f.run.hasActive(),false);
});

test('late input at agent_settled is rejected without reopening the agent',{timeout:10000},async t=>{
  const f=await fixture(t,({model})=>msg(model,'finished'));let late,attempted=false;
  const off=f.hub.subscribe((_rs,r)=>{if(r?.activity==='Settled'&&!attempted){attempted=true;late=f.hub.send(r.id,'late').then(()=>assert.fail('accepted late input'),e=>assert.match(e.message,/finished|accepting/i));}});
  assert.equal(await f.run({cwd:f.cwd,name:'explorer',task:'work'}),'finished');await late;off();assert.equal(f.calls.length,1);
});

test('an already accepted literal send crossing a turn boundary is awaited before releasing the result',{timeout:10000},async t=>{
  const ready=deferred(),release=deferred(),settled=deferred();
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    assert.match(JSON.stringify(context.messages),/must not be lost/);
    return msg(model,'corrected answer');
  });
  const work=f.run({cwd:f.cwd,name:'explorer',task:'work'});
  const finish=await ready.promise,s=f.sessions[0],original=s.prompt.bind(s);
  s.prompt=async(text,options)=>{await release.promise;return original(text,options);};
  s.subscribe(e=>{if(e.type==='agent_settled')settled.resolve();});
  const r=f.hub.list()[0];const send=f.hub.send(r.id,'must not be lost');finish('stale answer');await settled.promise;
  assert.equal(r.closed,false);release.resolve();await send;assert.equal(await work,'corrected answer');
  assert.equal(r.state,'completed');assert.equal(r.deliveries[0].status,'delivered');assert.equal(f.calls.length,2);
  assert.match(f.history.read(r.file).deliveries[0].text,/must not be lost/);
});

test('human feedback invalidates a previously submitted Reviewer PASS',{timeout:10000},async t=>{
  const ready=deferred();const schema={type:'object',required:['verdict'],properties:{verdict:{enum:['pass','repairs','blocked']}}};
  const f=await fixture(t,({n,model,done})=>{
    if(n===1)return msg(model,[{type:'toolCall',id:'verdict',name:'submit_result',arguments:{verdict:'pass'}}],'toolUse');
    if(n===2){ready.resolve(done);return;}
    return msg(model,'I saw your new feedback, but did not resubmit a verdict.');
  });
  const work=f.run({cwd:f.cwd,name:'review',task:'review',schema,skill:'dev-review'});const rejection=assert.rejects(work,/no current structured result/);
  const finish=await ready.promise;await f.hub.send(f.hub.list()[0].id,'Missing invariant; reconsider this review');finish('old pass');
  await rejection;assert.equal(f.calls.length,3);
});

test('Reviewer cannot silently submit PASS after receiving human feedback',{timeout:10000},async t=>{
  const ready=deferred();const schema={type:'object',required:['verdict'],properties:{verdict:{enum:['pass','repairs','blocked']}}};
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    if(n===2)return msg(model,[{type:'toolCall',id:'bad',name:'submit_result',arguments:{verdict:'pass'}}],'toolUse');
    if(n===3){assert.match(JSON.stringify(context.messages),/never silent PASS/);return msg(model,[{type:'toolCall',id:'good',name:'submit_result',arguments:{verdict:'blocked'}}],'toolUse');}
    return msg(model,'blocked pending clarification');
  });
  const work=f.run({cwd:f.cwd,name:'review',task:'review',schema,skill:'dev-review'});const finish=await ready.promise;
  await f.hub.send(f.hub.list()[0].id,'A requirement is missing');finish('checking');
  assert.deepEqual(await work,{verdict:'blocked'});
});

test('a rejected native input pipeline keeps its message recoverable without invalidating earlier work',{timeout:10000},async t=>{
  const ready=deferred();const f=await fixture(t,({model,n,done})=>{if(n===1){ready.resolve(done);return;}return msg(model,'done');});
  const work=f.run({cwd:f.cwd,name:'explorer',task:'research'});const finish=await ready.promise;
  f.sessions[0].prompt=async()=>{throw new Error('Native input rejected');};
  await assert.rejects(f.hub.send(f.hub.list()[0].id,'Preserve this instruction'),/Native input rejected/);finish('done');
  assert.equal(await work,'done');assert.equal(f.calls.length,1);
});

test('stop a Builder cancels nested Explorer; no child outlives its owner or retries',{timeout:10000},async t=>{
  const ready=deferred();let builders=0;
  const f=await fixture(t,({model})=>{
    if(model.id==='gpt-5.6-luna'){ready.resolve();return;}
    if(++builders===1)return msg(model,[{type:'toolCall',id:'explore',name:'explore',arguments:{task:'Find an API'}}],'toolUse');
    return msg(model,'should not reach this');
  });
  const work=f.run({cwd:f.cwd,name:'build',task:'build',skill:'dev-implement'});const rejection=assert.rejects(work,/abort|cancel/i);await ready.promise;
  const parent=f.hub.list().find(r=>r.role==='build'),child=f.hub.list().find(r=>r.role==='explorer');
  assert.equal(child.metadata.parentId,parent.id);await f.hub.abort(parent.id);await rejection;
  assert.ok(f.hub.list().every(r=>r.state==='aborted'));assert.ok(f.sessions.every(s=>!s.isStreaming));assert.equal(builders,1);
});

test('related question starts a NEW read-only Explorer without changing the old outcome',{timeout:10000},async t=>{
  const f=await fixture(t,({model})=>msg(model,'research result'));
  await f.run({cwd:f.cwd,name:'build',task:'original',skill:'dev-implement'});
  const old=f.hub.list()[0],oldMessages=JSON.stringify(old.messages),id=await f.hub.related(old.id,'What did the old code do?');
  // Allow the already-started related run to settle; there is no controller or
  // original parent continuation triggered by opening/asking this thread.
  while(f.run.hasActive())await new Promise(r=>setImmediate(r));
  const fresh=f.hub.get(id);assert.notEqual(fresh.id,old.id);assert.equal(fresh.metadata.readOnly,true);assert.equal(fresh.metadata.relatedTo,old.id);
  assert.equal(JSON.stringify(old.messages),oldMessages);assert.equal(old.state,'completed');assert.equal(f.calls.length,2);
});

test('pinned VCC recall accesses this child session, not a sibling',{timeout:10000},async t=>{
  let round=0;
  const f=await fixture(t,({model,context})=>{
    if(++round===1)return msg(model,'Sibling-only PRIVATE_SIBLING_SENTINEL');
    if(round===2)return msg(model,[{type:'toolCall',id:'recall',name:'vcc_recall',arguments:{query:'SECOND_CHILD_CANARY',scope:'all'}}],'toolUse');
    assert.match(JSON.stringify(context.messages),/SECOND_CHILD_CANARY/);assert.ok(!JSON.stringify(context.messages).includes('PRIVATE_SIBLING_SENTINEL'));
    const result=context.messages.find(m=>m.role==='toolResult'&&m.toolName==='vcc_recall');assert.ok(result);assert.ok(!result.isError,JSON.stringify(result));
    return msg(model,'recall complete');
  });
  await f.run({cwd:f.cwd,name:'explorer',task:'first'});
  await f.run({cwd:f.cwd,name:'explorer',task:'SECOND_CHILD_CANARY'});
  assert.ok(f.sessions.every(s=>s.getActiveToolNames().includes('vcc_recall')));assert.ok(f.hub.list().every(r=>r.metadata.vcc));
});

test('pinned VCC performs actual auto-compaction while retaining full child audit history',{timeout:10000},async t=>{
  const ready=deferred();
  const f=await fixture(t,({n,model,done})=>{
    if(n===1){ready.resolve(done);return;}
    return {...msg(model,'Final answer retained after compaction'),usage:{input:260000,output:2,cacheRead:0,cacheWrite:0,totalTokens:260002,cost:{total:0}}};
  },{settingsFor:()=>SettingsManager.inMemory({compaction:{enabled:true,reserveTokens:16384,keepRecentTokens:1}})});
  fs.writeFileSync(process.env.PI_VCC_CONFIG_PATH,JSON.stringify({overrideDefaultCompaction:true,smartKeepTail:false}));
  const work=f.run({cwd:f.cwd,name:'explorer',task:'Analyze this trace: '+Array.from({length:1500},(_,i)=>`Important trace entry ${i}.`).join('\n')});
  const finish=await ready.promise;await f.hub.followUp(f.hub.list()[0].id,'Now conclude');finish('initial analysis');await work;
  assert.ok(f.events.some(e=>e.type==='compaction_end'&&e.result),JSON.stringify({types:f.events.map(e=>e.type),usage:f.sessions[0].messages.filter(m=>m.role==='assistant').map(m=>m.usage),details:f.history.open(f.hub.list()[0].file).getEntries().map(e=>e.type)}));
  const r=f.hub.list()[0],entries=f.history.open(r.file).getEntries();
  assert.ok(entries.some(e=>e.type==='compaction'&&e.details?.compactor==='pi-vcc'),JSON.stringify(entries.filter(e=>e.type==='compaction').map(e=>e.details)));
  assert.ok(r.messages.some(m=>m.role==='assistant'&&m.content[0].text==='Final answer retained after compaction'));
});

test('result tool already generated before a queued instruction cannot certify a new input epoch',{timeout:10000},async t=>{
  const ready=deferred();const schema={type:'object',required:['title'],properties:{title:{type:'string'}}};
  const f=await fixture(t,({n,model,context,done})=>{
    if(n===1){ready.resolve(done);return;}
    assert.match(JSON.stringify(context.messages),/Read the pending human instruction/);
    return msg(model,'Acknowledged the correction but forgot to submit a new title.');
  });
  const work=f.run({cwd:f.cwd,name:'ship',task:'title',schema,tools:['read']});const rejection=assert.rejects(work,/no current structured result/);
  const finish=await ready.promise;await f.hub.send(f.hub.list()[0].id,'Please change the title');
  finish([{type:'toolCall',id:'old-title',name:'submit_result',arguments:{title:'Generated before your correction'}}],'toolUse');
  await rejection;
});

test('child questions wait for explicit human response and cancellation releases the wait',{timeout:10000},async t=>{
  const f=await fixture(t,({n,model,context})=>n===1?msg(model,[{type:'toolCall',id:'ask',name:'ask_human',arguments:{question:'Which implementation should I inspect?'}}],'toolUse'):msg(model,'Human answered: '+JSON.stringify(context.messages.at(-1).content)));
  const work=f.run({cwd:f.cwd,name:'explorer',task:'ask a question'});
  while(!f.hub.questions().length)await new Promise(r=>setImmediate(r));
  const question=f.hub.questions()[0];assert.equal(f.calls.length,1);await question.answer({answer:'Existing implementation'});
  assert.match(await work,/Existing implementation/);assert.equal(f.hub.questions().length,0);
});

test('stopping a questioning child cancels the question without implicitly answering',{timeout:10000},async t=>{
  const f=await fixture(t,({model})=>msg(model,[{type:'toolCall',id:'ask',name:'ask_human',arguments:{question:'Need help'}}],'toolUse'));
  const work=f.run({cwd:f.cwd,name:'explorer',task:'ask'});const rejected=assert.rejects(work,/abort|cancel/i);
  while(!f.hub.questions().length)await new Promise(r=>setImmediate(r));
  await f.hub.abort(f.hub.list()[0].id);await rejected;assert.equal(f.hub.questions().length,0);assert.equal(f.calls.length,1);
});

test('cancelled queued feedback does not become delivered feedback or poison a new review result',{timeout:10000},async t=>{
  const ready=deferred();const schema={type:'object',required:['verdict'],properties:{verdict:{enum:['pass','repairs','blocked']}}};
  const f=await fixture(t,({n,model,done})=>{if(n===1){ready.resolve(done);return;}return msg(model,'done');});
  const work=f.run({cwd:f.cwd,name:'review',task:'review',schema,skill:'dev-review'});const finish=await ready.promise;
  const r=f.hub.list()[0];await f.hub.send(r.id,'Never mind, cancel this');assert.equal(await f.hub.cancelQueued(r.id),1);
  assert.equal(r.deliveries[0].status,'cancelled');
  finish([{type:'toolCall',id:'new-verdict',name:'submit_result',arguments:{verdict:'pass'}}],'toolUse');
  assert.deepEqual(await work,{verdict:'pass'});assert.equal(r.deliveries[0].status,'cancelled');
});
