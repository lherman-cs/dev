import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelRuntime, createAgentSession, type AgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { createWorkerRunner, exploreTool, type RunWorker } from "../lib/worker.ts";
import { WorkerHub } from "../lib/worker-hub.ts";

type StreamModel = Parameters<ModelRuntime['streamSimple']>[0];
type StreamContext = Parameters<ModelRuntime['streamSimple']>[1];
type StreamOptions = NonNullable<Parameters<ModelRuntime['streamSimple']>[2]>;
type Answer = (n: number, context: StreamContext, model: StreamModel, options: StreamOptions, stream: ReturnType<typeof createAssistantMessageEventStream>) => AssistantMessage | undefined | void;
function required<T>(value: T | undefined, label: string): T { if (value === undefined) throw new Error(`Missing ${label}.`); return value; }

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
test('worker runner requires the native session hub boundary',()=>{
  assert.throws(()=>createWorkerRunner({hub: undefined as never}),/requires a WorkerHub/);
});
function message(model: StreamModel, content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']='stop'): AssistantMessage {
  return {role:'assistant',content,stopReason,provider:model.provider,model:model.id,api:model.api,timestamp:Date.now(),
    usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
}
test('actual Pi SDK: fresh contexts, exact role, repo instructions, lazy skill, narrow Explorer', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'done'}]));
  for(let i=0;i<2;i++) assert.equal(await f.run({cwd:f.cwd,name:'build',task:`task ${i}`,skill:'dev-implement'}),'done');
  const firstSession=required(f.sessions[0],'first session'),secondSession=required(f.sessions[1],'second session');
  assert.notEqual(firstSession.sessionId,secondSession.sessionId);
  assert.equal(firstSession.sessionFile,undefined);
  for(const call of f.calls) {
    assert.equal(call.model.provider,'openai-codex'); assert.equal(call.model.id,'gpt-5.6-sol');
    assert.match(JSON.stringify(call.context),/TEST_CANARY/);
    // Pi lazy-skills: the body is absent from the resident system prompt and appears only
    // in the explicit /skill invocation turn.
    assert.ok(!String(call.context.systemPrompt || '').includes('NEEDS_REPLAN'));
    assert.match(JSON.stringify(call.context.messages),/NEEDS_REPLAN/);
    assert.equal(call.context.messages.filter(m=>m.role==='user').length,1);
    assert.ok(firstSession.getActiveToolNames().includes('explore'));
    assert.ok(!firstSession.getActiveToolNames().includes('subagent'));
    for(const name of ['web_search','source_check','fetch_content','get_search_content']) assert.ok(!firstSession.getActiveToolNames().includes(name),name);
    assert.match(JSON.stringify(call.context),/one self-contained scope/);
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
test('Explorer is fresh, read-only and cannot delegate recursively', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'Conclusion: found it'}]));
  await f.run({cwd:f.cwd,name:'explorer',task:'find it',tools:['bash','edit','explore']});
  const names=required(f.sessions[0],'session').getActiveToolNames();
  for(const name of ['explore','subagent','bash','edit','write','lsp_fix','install','git']) assert.ok(!names.includes(name),name);
  for(const name of ['web_search','source_check','fetch_content','get_search_content']) assert.ok(names.includes(name),name);
  const call=required(f.calls[0],'Explorer call');
  assert.match(JSON.stringify(call.context.messages),/Answer exactly one independently scoped factual question/);
  assert.match(JSON.stringify(call.context.messages),/FOUND/);
});
test('every non-Explorer worker role receives the bounded Explorer primitive', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'done'}]));
  const roles=['spec','plan','build','build_retry','prepare','review','ship'] as const;
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
  const schemaText=JSON.stringify(delegated.schema);
  assert.match(schemaText,/"required".*"status".*"answer".*"evidence"/);
  assert.match(schemaText,/"FOUND".*"INCONCLUSIVE".*"BLOCKED"/);
  assert.ok(text.length<=4000,String(text.length));
  assert.match(text,/^FOUND\n\nDirect answer\n\nEvidence:/);
  assert.match(text,/\[Explorer result truncated\]$/);
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
test('a native Builder can call Explorer without inheriting the Builder conversation',async t=>{
  let builderTurns=0,explorerTurns=0;
  const f=await fixture(t,(_n,context,model)=>{
    if(model.id==='gpt-5.6-luna') {
      assert.ok(!JSON.stringify(context.messages).includes('PRIVATE_PARENT_CONTEXT'));
      return ++explorerTurns===1
        ? message(model,[{type:'toolCall',id:'result',name:'submit_result',arguments:{status:'FOUND',answer:'Local evidence',evidence:[{claim:'Entry point',anchor:'src/main.ts:1'}]}}],'toolUse')
        : message(model,[{type:'text',text:'submitted'}]);
    }
    return ++builderTurns===1?message(model,[{type:'toolCall',id:'explore',name:'explore',arguments:{task:'Locate the repository entry point'}}],'toolUse'):message(model,[{type:'text',text:'done'}]);
  });
  assert.equal(await f.run({cwd:f.cwd,name:'build',task:'PRIVATE_PARENT_CONTEXT',skill:'dev-implement'}),'done');
  assert.equal(f.calls.length,4);
  assert.equal(required(f.calls[1],'Explorer call').model.id,'gpt-5.6-luna');
  assert.match(JSON.stringify(required(f.calls[3],'final call').context.messages),/FOUND\\n\\nLocal evidence\\n\\nEvidence/);
});
