import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelRuntime, createAgentSession, type AgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { asyncExploreTool, asyncReviewTool, createWorkerRunner, exploreTool, reviewTool, type AsyncWorkerCompletion, type RunWorker } from "../lib/worker.ts";
import { WorkerHub } from "../lib/worker-hub.ts";
import { role } from "../lib/roles.ts";

type StreamModel = Parameters<ModelRuntime['streamSimple']>[0];
type StreamContext = Parameters<ModelRuntime['streamSimple']>[1];
type StreamOptions = NonNullable<Parameters<ModelRuntime['streamSimple']>[2]>;
type Answer = (n: number, context: StreamContext, model: StreamModel, options: StreamOptions, stream: ReturnType<typeof createAssistantMessageEventStream>) => AssistantMessage | undefined | void;
function required<T>(value: T | undefined, label: string): T { if (value === undefined) throw new Error(`Missing ${label}.`); return value; }
function firstText(message: { content: string | Array<{ type: string; text?: string }> }): string | undefined { return typeof message.content === 'string' ? message.content : message.content.find(part=>part.type==='text')?.text; }

async function fixture(t: TestContext, answer: Answer) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'native-worker-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  fs.writeFileSync(path.join(cwd,'AGENTS.md'),'Repository invariant: preserve the TEST_CANARY.\n');
  const runtime=await ModelRuntime.create();
  runtime.hasConfiguredAuth=()=>true;
  const sessions: AgentSession[]=[], calls: Array<{model: StreamModel; context: StreamContext; options: StreamOptions}>=[];
  runtime.streamSimple=(model,context,options={})=>{
    calls.push({model,context,options});
    const stream=createAssistantMessageEventStream();
    const result=answer(calls.length,context,model,options,stream);
    if(result) queueMicrotask(()=>{ if (result.stopReason === 'error' || result.stopReason === 'aborted') stream.push({type:'error',reason:result.stopReason,error:result}); else if (result.stopReason === 'pending') throw new Error('Pending test message cannot finish a stream.'); else stream.push({type:'done',reason:result.stopReason,message:result}); });
    return stream;
  };
  const hub=new WorkerHub();
  const run=createWorkerRunner({runtime,hub,create:async options=>{
    const result=await createAgentSession(options); sessions.push(result.session); return result;
  }});
  t.after(()=>hub.dispose());
  return {cwd,runtime,run,sessions,calls,hub};
}
test('a writing child cannot acquire its parent worktree via a nested cwd', async () => {
  const run = createWorkerRunner({ hub: new WorkerHub(), ownerCwd: () => process.cwd() });
  await assert.rejects(run({ cwd: path.join(process.cwd(), 'test'), name: 'build', task: 'write' }), /different worktree/);
});

test('worker runner requires the native session hub boundary',()=>{
  assert.throws(()=>createWorkerRunner({hub: undefined as never}),/requires a WorkerHub/);
});
function message(model: StreamModel, content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']='stop'): AssistantMessage {
  return {role:'assistant',content,stopReason,provider:model.provider,model:model.id,api:model.api,timestamp:Date.now(),
    usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
}
test('actual Pi SDK: fresh contexts, role, repo instructions and narrow Explorer', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'done'}]));
  for(let i=0;i<2;i++) assert.equal(await f.run({cwd:f.cwd,name:'build',task:`task ${i}`,skill:'dev-build'}),'done');
  const firstSession=required(f.sessions[0],'first session'),secondSession=required(f.sessions[1],'second session');
  assert.notEqual(firstSession.sessionId,secondSession.sessionId);
  assert.equal(firstSession.sessionFile,undefined);
  for(const call of f.calls) {
    const expected = role('build');
    assert.equal(call.model.provider,expected.provider); assert.equal(call.model.id,expected.model);
    assert.match(JSON.stringify(call.context),/TEST_CANARY/);
    assert.equal(call.context.messages.filter(m=>m.role==='user').length,1);
    assert.ok(firstSession.getActiveToolNames().includes('explore'));
    assert.ok(!firstSession.getActiveToolNames().includes('subagent'));
    for(const name of ['web_search','source_check','fetch_content','get_search_content']) assert.ok(!firstSession.getActiveToolNames().includes(name),name);
  }
  assert.ok(!JSON.stringify(required(f.calls[1],'second call').context.messages).includes('task 0'));
  assert.equal(f.hub.list().filter(worker=>worker.state==='completed').length,2);
  assert.ok(f.hub.list().every(worker=>!worker.session));
});
test('native SDK validates structured result tool instead of scraping model prose', async t=>{
  const f=await fixture(t,(n,c,m)=>message(m,n===1?[{type:'toolCall',id:'result',name:'submit_result',arguments:{verdict:'pass'}}]:[{type:'text',text:'recorded'}],n===1?'toolUse':'stop'));
  const schema={type:'object',required:['verdict'],additionalProperties:false,properties:{verdict:{enum:['pass','blocked']}}};
  assert.deepEqual(await f.run({cwd:f.cwd,name:'review',task:'check',schema,skill:'dev-review'}),{verdict:'pass'});
  assert.ok(!required(f.sessions[0],'session').getActiveToolNames().some(name=>name==='edit'||name==='write'));
});
test('Reviewer is fresh, read-only, cannot ask directly, and may use bounded Explorer', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'done'}]));
  await f.run({cwd:f.cwd,name:'review',task:'candidate',skill:'dev-review',tools:['bash','edit','ask_human']});
  const names=required(f.sessions[0],'session').getActiveToolNames();
  for(const name of ['bash','edit','write','ask_human','review','git']) assert.ok(!names.includes(name),name);
  assert.ok(names.includes('explore'));
});
test('review transport rejects mismatched, inconsistent, and oversized results', async()=>{
  const base={verdict:'PASS',candidate:'abc',evidence:'proof',summary:'ok',findings:[],blocker:null};
  const invoke=async (result: unknown) => {
    const run: RunWorker=async()=>result as never;
    return reviewTool(run).execute('id',{task:'review',candidate:'abc',evidence:'proof'},undefined,undefined,{cwd:process.cwd()} as never);
  };
  await assert.rejects(invoke({...base,candidate:'other'}),/does not match/);
  await assert.rejects(invoke({...base,findings:[{key:'x'}]}),/inconsistent/);
  await assert.rejects(invoke({...base,summary:'x'.repeat(13000)}),/transport limit/);
  const ok=await invoke(base); assert.equal(required(ok.content[0],'content').type,'text');
});
test('Explorer can verify but cannot edit or delegate recursively', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'Conclusion: found it'}]));
  await f.run({cwd:f.cwd,name:'explorer',task:'find it',tools:['edit','explore']});
  const names=required(f.sessions[0],'session').getActiveToolNames();
  for(const name of ['explore','subagent','edit','write','lsp_fix','install','git']) assert.ok(!names.includes(name),name);
  for(const name of ['bash','web_search','source_check','fetch_content','get_search_content']) assert.ok(names.includes(name),name);
});
test('every non-Explorer worker role receives the bounded Explorer primitive', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'done'}]));
  const roles=['spec','plan','build','review','ship'] as const;
  for(const name of roles) await f.run({cwd:f.cwd,name,task:`${name} task`});
  assert.equal(f.sessions.length,roles.length);
  for(const session of f.sessions) {
    assert.ok(session.getActiveToolNames().includes('explore'));
    for(const name of ['web_search','source_check','fetch_content','get_search_content']) assert.ok(!session.getActiveToolNames().includes(name),name);
  }
});
test('Explorer returns only a schema-checked compact result to the parent', async()=>{
  let options: Parameters<RunWorker>[0] | undefined;
  const run: RunWorker=async value=>{options=value;return {status:'FOUND',answer:'Direct answer',evidence:[{claim:`Evidence ${'e'.repeat(5000)}`,anchor:'src/file.ts:1'}],uncertainty:'One material caveat'} as never;};
  const tool=exploreTool(run);
  const result=await tool.execute('id',{task:'one scope'},new AbortController().signal,undefined,{} as never);
  const firstContent=required(result.content[0],'result content'); if (firstContent.type !== 'text') assert.fail('Expected text result.'); const text=firstContent.text;
  const delegated=required(options,'explorer options');
  assert.ok(delegated.schema);
  assert.ok(text.length<=4000,String(text.length));
  assert.match(text,/Direct answer/);
  assert.ok(!text.includes('e'.repeat(5000)), 'oversized evidence is truncated');
});
test('Main Explorers start concurrently and publish each result as soon as it settles', async()=>{
  const pending: Array<{ resolve(value: unknown): void }> = [];
  const calls: Parameters<RunWorker>[0][] = [], completions: AsyncWorkerCompletion[] = [];
  const run = ((args: Parameters<RunWorker>[0]) => {
    calls.push(args);
    return new Promise(resolve => pending.push({ resolve }));
  }) as unknown as RunWorker;
  const tool = asyncExploreTool(run, completion => { completions.push(completion); });
  const signal = new AbortController().signal;
  const first = await tool.execute('one',{task:'scope A'},signal,undefined,{cwd:process.cwd()} as never);
  const second = await tool.execute('two',{task:'scope B'},signal,undefined,{cwd:process.cwd()} as never);
  assert.match(firstText(first) || '',/Started asynchronous Explorer/);
  assert.match(firstText(second) || '',/Started asynchronous Explorer/);
  assert.equal(calls.length,2);assert.equal(completions.length,0);
  assert.ok(calls.every(call=>call.signal===undefined),'detached work must not inherit the completed tool call signal');
  required(pending[1],'second worker').resolve({status:'FOUND',answer:'B answer',evidence:[{claim:'B claim',anchor:'b.ts:1'}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completions.length,1);assert.equal(required(completions[0],'second completion').task,'scope B');assert.match(required(completions[0],'second completion').result,/B answer/);
  required(pending[0],'first worker').resolve({status:'FOUND',answer:'A answer',evidence:[{claim:'A claim',anchor:'a.ts:1'}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(completions.map(item=>item.task),['scope B','scope A']);
  assert.ok(completions.every(item=>item.status==='completed'));
});
test('Main Reviewer failure is delivered asynchronously instead of rejecting its receipt', async()=>{
  let reject!: (error: Error) => void;const completions: AsyncWorkerCompletion[]=[];
  const run = (() => new Promise((_resolve, decline)=>{reject=decline;})) as unknown as RunWorker;
  const tool=asyncReviewTool(run,completion=>{completions.push(completion);});
  const receipt=await tool.execute('review',{task:'gate',candidate:'abc',evidence:'proof'},undefined,undefined,{cwd:process.cwd()} as never);
  assert.match(firstText(receipt) || '',/Started asynchronous Reviewer/);
  reject(new Error('review transport failed'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completions.length,1);assert.equal(required(completions[0],'completion').status,'failed');assert.match(required(completions[0],'completion').result,/transport failed/);
});
test('authentication failure occurs before session creation and never changes models', async t=>{
  const f=await fixture(t,()=>assert.fail('should not call model'));
  f.runtime.hasConfiguredAuth=()=>false;
  await assert.rejects(f.run({cwd:f.cwd,name:'build',task:'x'}),/No login for openai-codex/);
  assert.equal(f.sessions.length,0);
});
test('cancellation reaches the native Pi session and cleans it up', async t=>{
  const controller=new AbortController();
  const f=await fixture(t,(_n,_c,m,options,stream)=>{
    required(options.signal,'abort signal').addEventListener('abort',()=>stream.push({type:'error',reason:'aborted',error:{...message(m,[],'aborted'),errorMessage:'cancelled'}}),{once:true});
    setTimeout(()=>controller.abort(),5);
  });
  await assert.rejects(f.run({cwd:f.cwd,name:'build',task:'wait',signal:controller.signal}),/abort|cancel/i);
  assert.equal(required(f.sessions[0],'session').isStreaming,false);
  const worker=required(f.hub.list()[0],'worker');
  assert.equal(worker.state,'aborted');
  assert.equal(worker.session,undefined);
});
test('a native Builder receives worker-owned Explorer completion asynchronously without inheriting context',async t=>{
  let builderTurns=0,explorerTurns=0,finishExplorer: ((message: AssistantMessage) => void) | undefined;
  const f=await fixture(t,(_n,context,model,_options,stream)=>{
    if(model.id==='gpt-6-luna') {
      assert.ok(!JSON.stringify(context.messages).includes('PRIVATE_PARENT_CONTEXT'));
      if(++explorerTurns===1) { finishExplorer=done=>stream.push({type:'done',reason:'toolUse',message:done}); return; }
      return message(model,[{type:'text',text:'submitted'}]);
    }
    builderTurns++;
    if(builderTurns===1)return message(model,[{type:'toolCall',id:'explore',name:'explore',arguments:{task:'Locate the repository entry point'}}],'toolUse');
    const serialized=JSON.stringify(context.messages);
    if(builderTurns===2) { assert.match(serialized,/Started asynchronous Explorer/); return message(model,[{type:'text',text:'Independent work exhausted; awaiting delivery.'}]); }
    assert.match(serialized,/Asynchronous Explorer .* completed/);
    assert.match(serialized,/FOUND\\n\\nLocal evidence\\n\\nEvidence/);
    return message(model,[{type:'text',text:'done with Local evidence'}]);
  });
  const work=f.run({cwd:f.cwd,name:'build',task:'PRIVATE_PARENT_CONTEXT',skill:'dev-build'});
  while(!finishExplorer||builderTurns<2)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(builderTurns,2,'Builder continued after the immediate receipt');
  finishExplorer(message(required(f.calls[1],'Explorer call').model,[{type:'toolCall',id:'result',name:'submit_result',arguments:{status:'FOUND',answer:'Local evidence',evidence:[{claim:'Entry point',anchor:'src/main.ts:1'}]}}],'toolUse'));
  assert.equal(await work,'done with Local evidence');
  assert.equal(builderTurns,3);
  assert.equal(explorerTurns,2);
});
