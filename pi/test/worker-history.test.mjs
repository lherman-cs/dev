import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { WorkerHistory, WORKER_ENTRY } from '../lib/worker-history.mjs';
import { WorkerHub } from '../lib/worker-hub.mjs';
import { session, register, assistant } from './helpers/hub.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const parent=SessionManager.create(root,path.join(root,'parents'));
  const errors=[],history=new WorkerHistory(parent,e=>errors.push(String(e)));
  return {root,parent,history,errors};
}

test('native Pi child history and drafts survive completion, cache eviction and parent reopen',async t=>{
  const {root,parent,history}=fixture(t),hub=new WorkerHub({history});t.after(()=>hub.dispose());
  for(let i=0;i<18;i++){
    const manager=history.create(root,{id:`a${i}`,label:`Research ${i}`,metadata:{readOnly:true}});
    const s=session();s.sessionManager=manager;s.sessionFile=manager.getSessionFile();
    register(hub,s,`a${i}`);const m=assistant(`Evidence ${i}`);s.append(m);manager.appendMessage(m);
    hub.setDraft(`a${i}`,`Follow up ${i}\n第二行`);hub.unregister(`a${i}`);
  }
  assert.equal(hub.list().filter(r=>r.messages).length,12);
  assert.equal(hub.load('a0').messages[0].content[0].text,'Evidence 0');
  const restored=new WorkerHub({history:new WorkerHistory(parent)});t.after(()=>restored.dispose());
  await history.restore(restored);
  assert.equal(restored.list().length,18);assert.equal(restored.get('a0').state,'completed');
  assert.equal(restored.get('a0').session,undefined);assert.equal(restored.get('a0').draft,'Follow up 0\n第二行');
  assert.equal(restored.load('a0').messages[0].content[0].text,'Evidence 0');
  assert.equal(restored.canSend('a0'),false);assert.equal(fs.statSync(restored.get('a0').file).mode&0o777,0o600);
});

test('first-request crash is recoverable without pretending the worker is still alive',async t=>{
  const {root,history}=fixture(t);const manager=history.create(root,{id:'crash',label:'Interrupted research',metadata:{}});
  manager.appendCustomEntry(WORKER_ENTRY,{id:'crash',label:'Interrupted research',state:'working',deliveries:[{text:'did it arrive?',status:'queued'}]});
  const hub=new WorkerHub({history});t.after(()=>hub.dispose());await history.restore(hub);
  const r=hub.get('crash');assert.equal(r.state,'interrupted');assert.equal(r.deliveries[0].status,'failed');assert.ok(r.endedAt);
  assert.equal(hub.canSend(r.id),false);
});

test('metadata snapshots are immutable and outside-path/symlink reads are rejected',t=>{
  const {root,history}=fixture(t),manager=history.create(root,{id:'a'});
  const record={id:'a',file:manager.getSessionFile(),session:{sessionManager:manager},metadata:{task:'original'},stats:{tools:1}};
  history.saveMetadata(record);record.stats.tools=9;record.metadata.task='changed';
  const saved=manager.getEntries().filter(e=>e.customType===WORKER_ENTRY).at(-1).data;
  assert.equal(saved.stats.tools,1);assert.equal(saved.metadata.task,'original');
  const other=path.join(root,'outside.jsonl');fs.writeFileSync(other,'{}');
  const link=path.join(history.root,'link.jsonl');fs.symlinkSync(other,link);
  assert.throws(()=>history.open(link),/outside this parent/);
  assert.throws(()=>history.open(other),/outside this parent/);
});

test('damaged files do not hide intact histories; restoration is cancellable',async t=>{
  const {root,history,errors}=fixture(t);history.create(root,{id:'intact'});
  fs.writeFileSync(path.join(history.root,'broken.jsonl'),'not json');
  const hub=new WorkerHub({history});t.after(()=>hub.dispose());await history.restore(hub);
  assert.ok(hub.get('intact'));assert.ok(errors.length);
  const empty=new WorkerHub({history});t.after(()=>empty.dispose());const c=new AbortController();c.abort();
  await history.restore(empty,c.signal);assert.equal(empty.list().length,0);
});


test('controller-only Main is natively resumable before any assistant turn; later messages append normally',t=>{
  const {root,parent,history}=fixture(t),id=parent.getSessionId();
  parent.appendCustomEntry('controller-start',{phase:'ship'});const leaf=parent.getLeafId();
  assert.equal(fs.existsSync(parent.getSessionFile()),false);
  history.ensureParent();
  assert.equal(parent.getSessionId(),id);assert.equal(parent.getLeafId(),leaf);
  assert.ok(!parent.getEntries().some(e=>e.type==='message'&&e.message.role==='assistant'));
  parent.appendMessage(assistant('A real later reply'));
  const restored=SessionManager.open(parent.getSessionFile());
  assert.equal(restored.getSessionId(),id);assert.equal(restored.getEntries().filter(e=>e.type==='message').length,1);
  history.create(root,{id:'first-child'});assert.equal(parent.getEntries().filter(e=>e.type==='message').length,1);
});

test('earlier PR native child journal and drafts remain inspectable without crossing parent boundaries',async t=>{
  const {root,parent,history}=fixture(t);history.ensureParent();
  fs.mkdirSync(history.legacyRoot,{recursive:true});
  const seed=file=>{const s=SessionManager.inMemory(root);fs.writeFileSync(file,JSON.stringify(s.getHeader())+'\n');return SessionManager.open(file);};
  const child=seed(path.join(history.legacyRoot,'child.jsonl'));
  child.appendMessage(assistant('Legacy evidence'));
  const journal=seed(path.join(history.legacyRoot,'hub-state.jsonl'));
  journal.appendCustomEntry('dev-worker',{id:'legacy',label:'Old Explorer',role:'explorer',state:'working',sessionFile:child.getSessionFile(),receipts:[{id:'msg',text:'uncertain delivery',state:'queued'}]});
  journal.appendCustomEntry('dev-draft',{id:'legacy',text:'Preserved draft\n中文'});
  const hub=new WorkerHub({history});t.after(()=>hub.dispose());await history.restore(hub);
  assert.equal(hub.get('legacy').state,'interrupted');assert.equal(hub.get('legacy').draft,'Preserved draft\n中文');
  assert.equal(hub.get('legacy').deliveries[0].status,'failed');assert.match(hub.load('legacy').messages[0].content[0].text,/Legacy evidence/);
  hub.setDraft('legacy','new draft');hub.flush();
  const again=new WorkerHub({history});t.after(()=>again.dispose());await history.restore(again);assert.equal(again.get('legacy').draft,'new draft');
  const other=path.join(parent.getSessionDir(),'.workers','different-parent');fs.mkdirSync(other);const outside=seed(path.join(other,'other.jsonl'));
  assert.throws(()=>history.open(outside.getSessionFile()),/outside this parent/);
  assert.ok(fs.existsSync(journal.getSessionFile()),'migration never deletes original history');
});


test('early parent persistence accepts a Pi-compatible manager from a different module identity',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-history-foreign-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const parent=SessionManager.create(root,path.join(root,'parents'));
  parent.appendCustomEntry('controller-start',{phase:'ship'});
  const methods=['getSessionFile','getSessionDir','getSessionId','getCwd','getHeader','getEntries','getLeafId','setSessionFile','branch'];
  const foreign=Object.create(null);
  for(const name of methods) foreign[name]=parent[name].bind(parent);
  assert.equal(foreign instanceof SessionManager,false,'regression requires a different nominal identity');
  const history=new WorkerHistory(foreign);
  history.ensureParent();
  assert.ok(fs.existsSync(parent.getSessionFile()));
  parent.appendMessage(assistant('Later real reply'));
  const restored=SessionManager.open(parent.getSessionFile());
  assert.equal(restored.getSessionId(),parent.getSessionId());
  assert.equal(restored.getEntries().filter(e=>e.type==='message').length,1);
});
