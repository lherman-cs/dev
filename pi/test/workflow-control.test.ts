import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowControl, WorkflowPaused } from '../lib/workflow-control.ts';

test('pause waits for a checkpoint, stop cancels, neither implies rollback',()=>{
  const c=new WorkflowControl('ship','project');c.pause();assert.equal(c.state,'running');assert.equal(c.signal.aborted,false);
  assert.throws(()=>c.checkpoint(),WorkflowPaused);c.finish(new WorkflowPaused());assert.equal(c.state,'paused');
  assert.equal(c.resumeCommand,'/dev-ship project');
  const stop=new WorkflowControl('build','project');stop.stop();assert.equal(stop.signal.aborted,true);
  assert.throws(()=>stop.checkpoint());stop.finish(stop.signal.reason);assert.equal(stop.state,'stopped');
});

test('human decisions never open until explicitly claimed; duplicate responses are inert',async()=>{
  const c=new WorkflowControl('ship','p');let shows=0,finish;
  const answer=c.ask('Approve HEAD abc?',()=>{shows++;return new Promise(r=>finish=r);});
  assert.equal(shows,0);const response=c.pending.respond();assert.equal(shows,1);
  await c.pending.respond();assert.equal(shows,1);finish({action:'approve'});await response;
  assert.deepEqual(await answer,{action:'approve'});assert.equal(c.pending,undefined);
});

test('pause at an unclaimed human gate leaves no stranded promise or implicit approval',async()=>{
  const c=new WorkflowControl('ship','p');let shown=false;
  const answer=c.ask('approve?',()=>{shown=true;});const rejected=assert.rejects(answer,WorkflowPaused);
  c.pause();await rejected;assert.equal(shown,false);assert.equal(c.pending,undefined);
});

test('stopping while a claimed dialog remains visible cannot approve subsequent work',async()=>{
  const c=new WorkflowControl('ship','p');let finish;
  const answer=c.ask('approve?',()=>new Promise(r=>finish=r));const rejected=assert.rejects(answer,/abort/i);
  const response=c.pending.respond();c.stop();await rejected;finish({action:'approve'});await response;
  assert.equal(c.pending,undefined);assert.throws(()=>c.checkpoint());
});

test('fast continuation refuses changed worktree/contract evidence and does not mask snapshot errors',async()=>{
  const c=new WorkflowControl('ship','p');let value='before';c.snapshot=async()=>value;
  c.pause();await c.capturePause();c.finish(new WorkflowPaused());await c.verifyResume();
  value='changed';await assert.rejects(c.verifyResume(),/changed while paused/);
  c.snapshot=async()=>{throw new Error('Git unavailable');};await assert.rejects(c.verifyResume(),/Git unavailable/);
});

test('rendering failure never changes controller state transitions',()=>{
  const c=new WorkflowControl('ship','p',()=>{throw new Error('broken UI');});
  c.update('Testing');c.pause();assert.throws(()=>c.checkpoint(),WorkflowPaused);c.finish(new WorkflowPaused());assert.equal(c.state,'paused');
});
