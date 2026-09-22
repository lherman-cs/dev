import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { WorkerHub, session, register, assistant, user, compactWorkerLines } from './helpers/hub.ts';

test('incremental usage distinguishes unknown data and is not double counted', () => {
  const hub=new WorkerHub(),s=session(),r=register(hub,s);
  assert.equal(r.stats.totalTokens,null); assert.equal(r.stats.cost,null);
  const base=assistant('done');
  const message: AssistantMessage={...base,content:[{type:'text',text:'done'},{type:'toolCall',id:'one',name:'read',arguments:{path:'a'}}],usage:{...base.usage,input:4,output:2,totalTokens:6,cost:{...base.usage.cost,total:0}}};
  s.append(message); s.emit({type:'message_end',message});
  assert.equal(r.stats.totalTokens,6);assert.equal(r.stats.cost,0);assert.equal(r.stats.requests,1);assert.equal(r.stats.tools,1);
  assert.ok(r.context); assert.equal(r.context.percent,4.2); hub.dispose();
});

test('live assistant and tool output are separate from settled context and survive compaction', () => {
  const hub=new WorkerHub(),s=session(),r=register(hub,s);
  const message=assistant('working'); s.emit({type:'message_update',message,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'working',partial:message}});
  assert.equal(r.partial,message);
  s.emit({type:'tool_execution_start',toolCallId:'t',toolName:'bash',args:{command:'cargo test'}});
  s.emit({type:'tool_execution_update',toolCallId:'t',toolName:'bash',args:{command:'cargo test'},partialResult:{content:[{type:'text',text:'compiling'}]}});
  const tool=r.tools.get('t'); if (!tool || tool.type !== 'tool_execution_update') assert.fail('Expected a running tool update.');
  assert.equal(tool.partialResult.content[0].text,'compiling');
  s.append(message); s.messages=[]; s.emit({type:'compaction_start',reason:'manual'}); s.emit({type:'compaction_end',reason:'manual',result:undefined,aborted:false,willRetry:false});
  assert.ok(r.messages); assert.equal(r.messages.length,1,'history is not the compacted model context'); assert.equal(r.partial,undefined);
  hub.dispose();
});

test('generic actions send exact text, track actual delivery, and reject after sealing',async()=>{
  const hub=new WorkerHub(),s=session(),r=register(hub,s);
  const d=await hub.steer(r.id,'look at tests\nnot implementation');
  assert.equal(d.status,'queued');assert.deepEqual(s.calls[0],['steer','look at tests\nnot implementation']);
  s.append(user(d.text));assert.equal(d.status,'delivered');
  await hub.followUp(r.id,'afterwards'); hub.seal(r.id);
  await assert.rejects(hub.steer(r.id,'too late'),/no longer accepting/);
  hub.unregister(r.id);assert.equal(r.deliveries[1]?.status,'failed');assert.equal(r.session,undefined);assert.equal(s.listenerCount(),0);
  hub.dispose();
});

test('completion during asynchronous queue acceptance is never reported as delivered',async()=>{
  const hub=new WorkerHub(),s=session();let resolve!: () => void;
  const r=register(hub,s,'agent:a',{actions:{send:()=>new Promise<void>(done=>{resolve=done;}),stop:()=>s.abort()}});
  const send=hub.steer(r.id,'race');const rejection=assert.rejects(send,/stopped before delivery/);
  hub.unregister(r.id);resolve();await rejection;
  assert.equal(r.deliveries[0]?.status,'failed');hub.dispose();
});

test('a faulty observer cannot break tool execution or hide other observers',()=>{
  const errors: Error[]=[],hub=new WorkerHub({onError:error=>errors.push(error)}),s=session();let updates=0;
  hub.subscribe(()=>{throw new Error('UI fault');});hub.subscribe(()=>updates++);
  const r=register(hub,s); s.append(assistant('done'));
  assert.ok(r.messages); assert.equal(r.messages.length,1);assert.ok(updates>=2);assert.ok(errors.length>=2);hub.dispose();
});

test('activity never reorders agents and completion retains an inspectable record',()=>{
  const hub=new WorkerHub(),s1=session(),s2=session();register(hub,s1,'a');register(hub,s2,'b');
  const release=hub.pin('a');hub.unregister('a');
  for(let i=0;i<30;i++){register(hub,session(),`r${i}`);hub.unregister(`r${i}`);}
  assert.deepEqual(hub.list().slice(0,2).map(r=>r.id),['a','b']);assert.ok(hub.get('a'));
  assert.match(compactWorkerLines(hub.list()).join('\n'),/Alt\+A inspect/);
  release();hub.dispose();
});

test('stop calls only owner-supplied action, failures remain visible and do not affect siblings',async()=>{
  const hub=new WorkerHub(),s=session(),other=session();register(hub,s);register(hub,other,'b');
  assert.equal(await hub.abort('agent:a'),true);assert.deepEqual(s.calls,[['abort']]);assert.deepEqual(other.calls,[]);
  assert.equal(await hub.abort('agent:a'),false);hub.dispose();
});
