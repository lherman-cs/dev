import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { WorkerHub, session, register, assistant, user, viewFixture, keys, screen, tick, AgentHubView, theme } from './helpers/hub.ts';

test('per-thread drafts cannot cross recipients when switching and submitting',async t=>{
  const hub=new WorkerHub(),a=session(),b=session();register(hub,a,'a');register(hub,b,'b');
  const f=viewFixture(t,{hub}),v=f.view;v.handleInput(keys.enter);v.handleInput('for A');v.handleInput(keys.altDown);
  v.handleInput('for B');v.handleInput(keys.enter);await tick();
  assert.deepEqual(a.calls,[]);assert.deepEqual(b.calls,[['steer','for B']]);
  assert.equal(hub.get('a').draft,'for A');assert.equal(hub.get('b').draft,'');
  v.handleInput(keys.altUp);assert.match(screen(v),/To: Explorer · a/);v.handleInput(keys.enter);await tick();
  assert.deepEqual(a.calls,[['steer','for A']]);
});

test('native editing preserves cursor keys, Unicode, question marks and multiline paste',async t=>{
  const hub=new WorkerHub(),s=session();register(hub,s,'a');const {view:v,state}=viewFixture(t,{hub});
  v.handleInput(keys.enter);v.handleInput('ac');v.handleInput(keys.left);v.handleInput('b');
  assert.equal(state.mode,'thread');assert.equal(hub.get('a').draft,'abc');
  v.handleInput(keys.end);v.handleInput('?你好');
  v.handleInput('\x1b[200~\nfn main() {\n  println!("hello");\n}\x1b[201~');
  const text=state.composers.get('a').editor.getExpandedText();
  assert.match(text,/abc\?你好\nfn main\(\) \{\n  println!/);assert.equal(hub.get('a').draft,text);
  v.handleInput(keys.enter);await tick();assert.equal(s.calls[0][1],text);
});

test('closing and reopening keeps draft, editor cursor, and a pending send safely bound',async t=>{
  const hub=new WorkerHub(),a=session(),b=session();let accept;
  register(hub,a,'a',{actions:{send:text=>new Promise(r=>{a.calls.push(['steer',text]);accept=r;})}});register(hub,b,'b');
  const f=viewFixture(t,{hub}),v=f.view;v.handleInput(keys.enter);v.handleInput('abcd');v.handleInput(keys.left);v.handleInput(keys.enter);
  v.dispose();const again=new AgentHubView(f.tui,theme,hub,'Main',()=>{},f.state);t.after(()=>again.dispose());
  again.handleInput(keys.altDown);again.handleInput('draft B');accept();await tick();
  assert.equal(hub.get('b').draft,'draft B');assert.equal(hub.get('a').draft,'');
  again.handleInput(keys.altUp);again.handleInput('abcd');again.handleInput(keys.left);
  again.dispose();const third=new AgentHubView(f.tui,theme,hub,'Main',()=>{},f.state);t.after(()=>third.dispose());
  third.handleInput('X');assert.equal(hub.get('a').draft,'abcXd');
});

test('typing while a send is in flight never erases the newer draft',async t=>{
  const hub=new WorkerHub(),s=session();let accept;
  register(hub,s,'a',{actions:{send:()=>new Promise(r=>accept=r)}});const {view:v}=viewFixture(t,{hub});
  v.handleInput(keys.enter);v.handleInput('first');v.handleInput(keys.enter);v.handleInput(' second');
  accept();await tick();assert.equal(hub.get('a').draft,'first second');
});

test('failed send retains its draft and reports failure on its original recipient',async t=>{
  const hub=new WorkerHub(),a=session(),b=session();let reject;
  register(hub,a,'a',{actions:{send:()=>new Promise((_,r)=>reject=r)}});register(hub,b,'b');
  const {view:v,state}=viewFixture(t,{hub});v.handleInput(keys.enter);v.handleInput('lost?');v.handleInput(keys.enter);v.handleInput(keys.altDown);
  reject(new Error('provider closed'));await tick();
  assert.equal(hub.get('a').draft,'lost?');assert.match(state.notices.get('a'),/Not sent/);assert.equal(state.notices.get('b'),undefined);
});

test('finished thread never retargets draft and inspection never restarts a worker',async t=>{
  const hub=new WorkerHub(),s=session();register(hub,s,'a');const {view:v,state}=viewFixture(t,{hub});
  v.handleInput(keys.enter);v.handleInput('follow-up');hub.unregister('a');
  for(let i=0;i<25;i++){register(hub,session(),`new${i}`);hub.unregister(`new${i}`);}
  v.handleInput(keys.enter);await tick();assert.equal(state.selectedId,'a');assert.equal(hub.get('a').draft,'follow-up');
  assert.deepEqual(s.calls,[]);assert.match(screen(v),/read-only result/);
});

test('stop is explicit with Cancel selected by default; Esc only navigates',async t=>{
  const hub=new WorkerHub(),s=session();register(hub,s,'a');const {view:v}=viewFixture(t,{hub});
  v.handleInput('x');assert.match(screen(v),/Already completed[\s\S]*edits/);v.handleInput(keys.enter);await tick();assert.deepEqual(s.calls,[]);
  v.handleInput('x');screen(v);v.handleInput(keys.down);screen(v);v.handleInput(keys.enter);await tick();assert.deepEqual(s.calls,[['abort']]);
  v.handleInput(keys.enter);v.handleInput(keys.escape);assert.equal(s.calls.length,1);
});

test('search/help/actions do not steal ordinary typing and explain their effect',async t=>{
  const hub=new WorkerHub(),s=session();register(hub,s,'a');s.append(assistant('FOUND important evidence'));
  const {view:v,state}=viewFixture(t,{hub});v.handleInput(keys.enter);v.handleInput('why?');
  assert.equal(state.composers.get('a').editor.getExpandedText(),'why?');
  v.handleInput(keys.f1);assert.match(screen(v),/Navigation without changing execution/);
  v.handleInput(keys.pageDown);v.handleInput(keys.escape);assert.equal(hub.get('a').draft,'why?');
  v.handleInput(keys.f3);v.handleInput('important');v.handleInput(keys.enter);assert.match(screen(v),/Match found/);
  v.handleInput(keys.escape);v.handleInput(keys.f2);assert.match(screen(v),/Queue this draft after/);
});

test('responsive layout keeps Back and Help reachable across narrow and short terminals',t=>{
  const hub=new WorkerHub();register(hub,session(),'a');const f=viewFixture(t,{hub});
  for(const width of [20,40,80,100,160])for(const height of [6,12,24,48]) {
    f.tui.terminal.rows=height;let lines=f.view.render(width);
    assert.ok(lines.length<=height);assert.ok(lines.every(l=>visibleWidth(l)<=width),`${width}x${height}`);
    assert.match(screen(f.view,width),/Esc/);assert.match(screen(f.view,width),/F1/);
    f.view.handleInput(keys.enter);lines=f.view.render(width);
    assert.ok(lines.length<=height);assert.ok(lines.every(l=>visibleWidth(l)<=width));
    assert.match(screen(f.view,width),/Esc/);f.view.handleInput(keys.escape);
  }
});

test('help is navigable on 40x12 without truncating the only explanation of advanced actions',t=>{
  const hub=new WorkerHub();register(hub,session(),'a');const {view:v}=viewFixture(t,{rows:12,hub});
  v.handleInput(keys.f1);let observed='';for(let i=0;i<20;i++){observed+=screen(v,40);v.handleInput(keys.pageDown);}
  assert.match(observed,/approvals/);assert.match(observed,/Queued is not delivered/);assert.match(observed,/PgUp\/Dn more/);
});

test('a tiny terminal cannot silently accept input into an invisible editor',t=>{
  const hub=new WorkerHub();register(hub,session(),'a');const {view:v,tui}=viewFixture(t,{rows:6,hub});
  v.handleInput(keys.enter);screen(v,40);v.handleInput('invisible');assert.equal(hub.get('a').draft,'');
  tui.terminal.rows=24;screen(v,40);v.handleInput('visible');assert.equal(hub.get('a').draft,'visible');
});

test('clipboard failures are awaited and stay attached to the original thread',async t=>{
  const hub=new WorkerHub(),a=session(),b=session();register(hub,a,'a');register(hub,b,'b');a.append(assistant('copy me'));
  let reject;
  const f=viewFixture(t,{hub,options:{copy:()=>new Promise((_,r)=>reject=r)}}),v=f.view;
  v.handleInput(keys.enter);v.handleInput(keys.f2);screen(v);v.handleInput(keys.down);screen(v);v.handleInput(keys.enter);await tick();
  assert.equal(typeof reject,'function');v.handleInput(keys.altDown);reject(new Error('Clipboard unavailable'));await tick();
  assert.match(f.state.notices.get('a'),/Clipboard unavailable/);assert.equal(f.state.notices.get('b'),undefined);
});

test('an already-open empty roster selects the first arriving child without retargeting an existing selection',t=>{
  const f=viewFixture(t);screen(f.view);register(f.hub,session(),'first');
  assert.equal(f.state.selectedId,'first');register(f.hub,session(),'second');assert.equal(f.state.selectedId,'first');
});

test('filtering the roster cannot open or message a hidden recipient',t=>{
  const hub=new WorkerHub();register(hub,session(),'a',{label:'Alpha'});register(hub,session(),'b',{label:'Beta'});
  const {view:v,state}=viewFixture(t,{hub});v.handleInput(keys.f3);v.handleInput('Beta');v.handleInput(keys.enter);screen(v);
  v.handleInput(keys.enter);assert.equal(state.selectedId,'b');assert.equal(state.mode,'thread');
  v.handleInput(keys.escape);v.handleInput(keys.f3);v.search.setValue('no match');v.handleInput(keys.enter);v.handleInput(keys.enter);
  assert.equal(state.mode,'roster');
});

test('stop cannot execute until the selected action is visible in a rendered confirmation',async t=>{
  const hub=new WorkerHub(),s=session();register(hub,s,'a',{label:'Very long agent purpose '.repeat(30)});
  const {view:v,tui}=viewFixture(t,{hub,rows:8});v.handleInput(keys.enter);screen(v,30);v.handleInput('\x18');
  v.handleInput(keys.down);v.handleInput(keys.enter);await tick();assert.equal(s.calls.length,0);
  const rendered=screen(v,30);assert.match(rendered,/Cancel/);assert.match(rendered,/Stop/);
  v.handleInput(keys.enter);await tick();assert.deepEqual(s.calls,[['abort']]);
});
