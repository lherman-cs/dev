import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerHub } from '../lib/worker-hub.ts';
import type { WorkerHistoryStore, WorkerMessage, WorkerRecord } from '../lib/worker-types.ts';
import { register, session, user } from './helpers/hub.ts';

function required<T>(value: T | undefined, label: string): T { if (value === undefined) throw new Error(`Missing ${label}.`); return value; }
function firstText(message: WorkerMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') return '';
  if (typeof message.content === 'string') return message.content;
  const part=message.content.find(content=>content.type==='text');
  return part?.type==='text' ? part.text : '';
}
function fixture(t: TestContext) {
  const stored=new Map<string, WorkerMessage[]>();
  const history: WorkerHistoryStore={
    saveMetadata(record: WorkerRecord) { if(record.messages?.length) stored.set(record.id,[...record.messages]); },
    saveDraft() {},
    load(record: WorkerRecord) { return [...(stored.get(record.id) ?? [])]; },
  };
  const hub=new WorkerHub({history});t.after(()=>hub.dispose());
  const add=(id: string)=>{
    const workerSession=session();workerSession.messages=[user(`evidence ${id}`)];workerSession.isStreaming=false;workerSession.sessionFile=`/tmp/${id}.jsonl`;
    register(hub,workerSession,id);hub.unregister(id);return required(hub.get(id),`worker ${id}`);
  };
  return {hub,history,add};
}
test('focused history stays loaded while newer attempts finish without reviving the worker',t=>{
  const {hub,add}=fixture(t),focused=add('focused'),release=hub.pin('focused');
  for(let i=0;i<40;i++)add(`new-${i}`);
  assert.equal(firstText(required(focused.messages?.[0],'focused evidence')),'evidence focused');assert.equal(focused.session,undefined);assert.equal(focused.actions,undefined);assert.equal(hub.list().length,41);
  release();add('after-release');assert.equal(focused.messages,undefined);
});
test('history reader pins are independently reference-counted and releases are idempotent',t=>{
  const {hub,add}=fixture(t),focused=add('focused'),first=hub.pin('focused'),second=hub.pin('focused');
  first();first();for(let i=0;i<20;i++)add(`new-${i}`);
  assert.ok(focused.messages,'second reader still holds evidence');second();second();add('released');assert.equal(focused.messages,undefined);
});
test('evicted history reloads without replacing identity or granting execution controls',t=>{
  const {hub,history,add}=fixture(t),original=add('original');for(let i=0;i<20;i++)add(`new-${i}`);
  assert.equal(original.messages,undefined);hub.load('original');assert.equal(hub.get('original'),original);
  const reloaded=required(history.load(original)[0],'original evidence');
  assert.equal(firstText(reloaded),'evidence original');assert.equal(original.session,undefined);assert.equal(original.actions,undefined);
});
