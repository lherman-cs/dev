import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerHub } from '../lib/worker-hub.ts';

function fixture(t) {
  const stored=new Map();
  const history={saveMetadata(r){if(r.messages?.length)stored.set(r.id,[...r.messages]);},saveDraft(){},load:r=>[...stored.get(r.id)]};
  const hub=new WorkerHub({history});t.after(()=>hub.dispose());
  const add=id=>{
    const session={sessionFile:`/workers/${id}.jsonl`,messages:[{role:'user',content:`evidence ${id}`}],subscribe:()=>()=>{}};
    hub.register({id,label:id,role:'explorer',session});hub.unregister(id);return hub.get(id);
  };
  return {hub,add};
}
test('focused history stays loaded while newer attempts finish without reviving the worker',t=>{
  const {hub,add}=fixture(t),focused=add('focused'),release=hub.pin('focused');
  for(let i=0;i<40;i++)add(`new-${i}`);
  assert.equal(focused.messages[0].content,'evidence focused');assert.equal(focused.session,undefined);assert.equal(focused.actions,undefined);assert.equal(hub.list().length,41);
  release();add('after-release');assert.equal(focused.messages,undefined);
});
test('history reader pins are independently reference-counted and releases are idempotent',t=>{
  const {hub,add}=fixture(t),focused=add('focused'),first=hub.pin('focused'),second=hub.pin('focused');
  first();first();for(let i=0;i<20;i++)add(`new-${i}`);
  assert.ok(focused.messages,'second reader still holds evidence');second();second();add('released');assert.equal(focused.messages,undefined);
});
test('evicted history reloads without replacing identity or granting execution controls',t=>{
  const {hub,add}=fixture(t),original=add('original');for(let i=0;i<20;i++)add(`new-${i}`);
  assert.equal(original.messages,undefined);hub.load('original');assert.equal(hub.get('original'),original);
  assert.equal(original.messages[0].content,'evidence original');assert.equal(original.session,undefined);assert.equal(original.actions,undefined);
});
