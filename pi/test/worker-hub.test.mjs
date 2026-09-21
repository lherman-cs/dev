import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerHub } from '../lib/worker-hub.mjs';
import { createJiti } from 'jiti';
const { WorkerViewer, compactWorkerLines, workerLines } = await createJiti(import.meta.url).import('../worker-hub-ui.ts');

function session() {
  const listeners=new Set(), calls=[];
  return {messages:[],calls,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},emit(event){for(const fn of listeners)fn(event);},
    async steer(text){calls.push(['steer',text]);},async followUp(text){calls.push(['followUp',text]);},async abort(){calls.push(['abort']);},listenerCount(){return listeners.size;}};
}
function register(hub,s,id='build:1') {hub.register({id,label:'build:P001',role:'build',model:'gpt-5.6-sol',thinking:'low',session:s,metadata:{phase:'build'}});}

test('register, live update, completion snapshot, bounded UI visibility and cleanup',()=>{
  const hub=new WorkerHub(),s=session(),states=[];hub.subscribe(records=>states.push(records.map(r=>r.state)));
  register(hub,s);s.messages.push({role:'assistant',content:[{type:'text',text:'implementing'}],usage:{input:4,output:2,totalTokens:6}});
  s.emit({type:'tool_execution_start',toolName:'edit',args:{path:'src/foo.rs'}});
  assert.match(compactWorkerLines(hub.list(),'dev-build').join('\n'),/build:P001.*working.*edit src\/foo.rs.*6 tok/);
  assert.match(workerLines(hub.get('build:1')).join('\n'),/assistant implementing/);
  hub.unregister('build:1','completed');
  assert.equal(hub.get('build:1').session,undefined);assert.equal(hub.get('build:1').state,'completed');assert.equal(s.listenerCount(),0);
  hub.dispose();assert.deepEqual(hub.list(),[]);assert.ok(states.length>=3);
});

test('steering, follow-up and abort only interact with the supplied running session',async()=>{
  const hub=new WorkerHub(),s=session();register(hub,s);
  await hub.steer('build:1','use the existing parser');await hub.followUp('build:1','also check the regression');await hub.abort('build:1');
  assert.deepEqual(s.calls.map(call=>call[0]),['steer','followUp','abort']);
  assert.match(s.calls[0][1],/current approved contract/);assert.match(s.calls[0][1],/NEEDS_REPLAN/);
  assert.equal(hub.get('build:1').state,'aborting');
  assert.deepEqual(hub.get('build:1').metadata,{phase:'build'},'UI must not acquire orchestration state');
});

test('focused viewer updates live and returns control without stopping the worker',()=>{
  const hub=new WorkerHub(),s=session();register(hub,s);
  let renders=0,action;const viewer=new WorkerViewer({requestRender(){renders++;}},hub,'build:1',value=>{action=value;});
  s.messages.push({role:'assistant',content:[{type:'toolCall',name:'bash',arguments:{command:'npm test'}}]});s.emit({type:'message_update'});
  assert.match(viewer.render(120).join('\n'),/→ bash.*npm test/);assert.ok(renders>0);
  viewer.handleInput('\u001b');assert.equal(action,'back');assert.deepEqual(s.calls,[]);
  viewer.dispose();assert.equal(s.listenerCount(),1,'only the hub lifecycle subscription remains');
});
