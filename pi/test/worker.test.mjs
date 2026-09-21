import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelRuntime, createAgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createWorkerRunner, exploreTool } from "../lib/worker.mjs";
import { WorkerHub } from "../lib/worker-hub.mjs";

async function fixture(t, answer) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'native-worker-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  fs.writeFileSync(path.join(cwd,'AGENTS.md'),'Repository invariant: preserve the TEST_CANARY.\n');
  const runtime=await ModelRuntime.create();
  runtime.hasConfiguredAuth=()=>true;
  const sessions=[], calls=[];
  runtime.streamSimple=(model,context,options)=>{
    calls.push({model,context,options});
    const stream=createAssistantMessageEventStream();
    const result=answer(calls.length,context,model,options,stream);
    if(result) queueMicrotask(()=>stream.push({type:'done',reason:result.stopReason,message:result}));
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
  assert.throws(()=>createWorkerRunner(),/requires a WorkerHub/);
});
function message(model,content,stopReason='stop') {
  return {role:'assistant',content,stopReason,provider:model.provider,model:model.id,api:model.api,timestamp:Date.now(),
    usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
}
test('actual Pi SDK: fresh contexts, exact role, repo instructions, lazy skill, narrow Explorer', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'done'}]));
  for(let i=0;i<2;i++) assert.equal(await f.run({cwd:f.cwd,name:'build',task:`task ${i}`,skill:'dev-implement'}),'done');
  assert.notEqual(f.sessions[0].sessionId,f.sessions[1].sessionId);
  assert.equal(f.sessions[0].sessionFile,undefined);
  for(const call of f.calls) {
    assert.equal(call.model.provider,'openai-codex'); assert.equal(call.model.id,'gpt-5.6-sol');
    assert.match(JSON.stringify(call.context),/TEST_CANARY/);
    // Pi lazy-skills: the body is absent from the resident system prompt and appears only
    // in the explicit /skill invocation turn.
    assert.ok(!String(call.context.systemPrompt || '').includes('NEEDS_REPLAN'));
    assert.match(JSON.stringify(call.context.messages),/NEEDS_REPLAN/);
    assert.equal(call.context.messages.filter(m=>m.role==='user').length,1);
    assert.ok(f.sessions[0].getActiveToolNames().includes('explore'));
    assert.ok(!f.sessions[0].getActiveToolNames().includes('subagent'));
    for(const name of ['web_search','source_check','fetch_content','get_search_content']) assert.ok(!f.sessions[0].getActiveToolNames().includes(name),name);
    assert.match(JSON.stringify(call.context),/Use explore for every open-ended or input-heavy codebase investigation/);
  }
  assert.ok(!JSON.stringify(f.calls[1].context.messages).includes('task 0'));
  assert.equal(f.hub.list().filter(worker=>worker.state==='completed').length,2);
  assert.ok(f.hub.list().every(worker=>!worker.session));
});
test('native SDK validates structured result tool instead of scraping model prose', async t=>{
  const f=await fixture(t,(n,c,m)=>message(m,n===1?[{type:'toolCall',id:'result',name:'submit_result',arguments:{verdict:'pass'}}]:[{type:'text',text:'recorded'}],n===1?'toolUse':'stop'));
  const schema={type:'object',required:['verdict'],additionalProperties:false,properties:{verdict:{enum:['pass','blocked']}}};
  assert.deepEqual(await f.run({cwd:f.cwd,name:'review',task:'check',schema,skill:'dev-review'}),{verdict:'pass'});
  assert.ok(!f.sessions[0].getActiveToolNames().some(n=>n==='edit'||n==='write'));
});
test('Explorer is fresh, read-only and cannot delegate recursively', async t=>{
  const f=await fixture(t,(_n,_c,m)=>message(m,[{type:'text',text:'Conclusion: found it'}]));
  await f.run({cwd:f.cwd,name:'explorer',task:'find it'});
  const names=f.sessions[0].getActiveToolNames();
  for(const name of ['explore','subagent','bash','edit','write','lsp_fix']) assert.ok(!names.includes(name),name);
  for(const name of ['web_search','source_check','fetch_content','get_search_content']) assert.ok(names.includes(name),name);
  assert.match(JSON.stringify(f.calls[0].context.messages),/Answer exactly one independently scoped factual question/);
  assert.match(JSON.stringify(f.calls[0].context.messages),/FOUND/);
});
test('Explorer returns only a compact result to the main agent', async()=>{
  const tool=exploreTool(async()=>`FOUND\n${'e'.repeat(5000)}`);
  const result=await tool.execute('id',{task:'one scope'},new AbortController().signal,undefined,{cwd:process.cwd()});
  const text=result.content[0].text;
  assert.ok(text.length<4100,text.length);
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
    options.signal.addEventListener('abort',()=>stream.push({type:'error',reason:'aborted',error:{...message(m,[],'aborted'),errorMessage:'cancelled'}}),{once:true});
    setTimeout(()=>controller.abort(),5);
  });
  await assert.rejects(f.run({cwd:f.cwd,name:'build',task:'wait',signal:controller.signal}),/abort|cancel/i);
  assert.equal(f.sessions[0].isStreaming,false);
  assert.equal(f.hub.list()[0].state,'aborted');
  assert.equal(f.hub.list()[0].session,undefined);
});
test('a native Builder can call Explorer without inheriting the Builder conversation',async t=>{
  let builderTurns=0;
  const f=await fixture(t,(_n,context,model)=>{
    if(model.id==='gpt-5.6-luna') {
      assert.ok(!JSON.stringify(context.messages).includes('PRIVATE_PARENT_CONTEXT'));
      return message(model,[{type:'text',text:'Conclusion: local evidence'}]);
    }
    return ++builderTurns===1?message(model,[{type:'toolCall',id:'explore',name:'explore',arguments:{task:'Locate the repository entry point'}}],'toolUse'):message(model,[{type:'text',text:'done'}]);
  });
  assert.equal(await f.run({cwd:f.cwd,name:'build',task:'PRIVATE_PARENT_CONTEXT',skill:'dev-implement'}),'done');
  assert.equal(f.calls.length,3);
  assert.equal(f.calls[1].model.id,'gpt-5.6-luna');
});
