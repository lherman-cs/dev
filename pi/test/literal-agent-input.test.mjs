import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createWorkerRunner } from '../lib/worker.mjs';
import { WorkerHub } from '../lib/worker-hub.mjs';

test('literal child messages do not execute slash commands or expand even the assigned skill',{timeout:15000},async t=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'literal-agent-input-')),old=process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR=path.join(cwd,'.pi');
  const hub=new WorkerHub(),runtime=await ModelRuntime.create();runtime.hasConfiguredAuth=()=>true;
  const run=createWorkerRunner({hub,runtime});
  t.after(async()=>{await run.stopAll();hub.dispose();fs.rmSync(cwd,{recursive:true,force:true});if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;});
  let ready,release,calls=0;const started=new Promise(r=>ready=r);
  const literal='/skill:dev-explore this is a literal message\nPreserve this second line.';
  runtime.streamSimple=(model,context,options)=>{
    const stream=createAssistantMessageEventStream();
    const response=text=>({role:'assistant',content:[{type:'text',text}],stopReason:'stop',timestamp:Date.now(),provider:model.provider,model:model.id,api:model.api,usage:{input:1,output:1,totalTokens:2,cacheRead:0,cacheWrite:0,cost:{total:0}}});
    const finish=text=>stream.push({type:'done',reason:'stop',message:response(text)});
    options.signal.addEventListener('abort',()=>stream.push({type:'error',reason:'aborted',error:{...response('cancelled'),stopReason:'aborted'}}),{once:true});
    if(++calls===1){release=()=>finish('initial response');ready();}
    else{
      const last=[...context.messages].reverse().find(m=>m.role==='user');
      const text=typeof last.content==='string'?last.content:last.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
      assert.equal(text,literal);queueMicrotask(()=>finish('Literal message delivered'));
    }
    return stream;
  };
  const pending=run({cwd,name:'explorer',task:'Investigate one thing'});await started;
  const receipt=await hub.send(hub.list()[0].id,literal);release();
  assert.equal(await pending,'Literal message delivered');assert.equal(calls,2);assert.equal(receipt.text,literal);assert.equal(receipt.status,'delivered');
});
