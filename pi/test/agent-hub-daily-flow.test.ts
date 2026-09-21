import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { WorkerHub, session, register, assistant, viewFixture, AgentHubView, theme, keys, screen, tick, NativeTranscript } from './helpers/hub.ts';
import { visibleWidth } from '@earendil-works/pi-tui';

test('daily flow: every surface preserves exit/help on narrow and short viewports',t=>{
  const hub=new WorkerHub();register(hub,session(),'a',{label:'Explorer · 中文 👩🏽‍💻 '+ 'purpose '.repeat(30)});
  const f=viewFixture(t,{hub});
  for(const [width,height] of [[120,40],[80,24],[40,12],[22,8],[12,4]]) {
    f.tui.terminal.rows=height;
    for(const input of [null,keys.enter,keys.f1,keys.escape,keys.f2,keys.escape]) {
      if(input)f.view.handleInput(input);const lines=f.view.render(width);
      assert.ok(lines.length<=height);assert.ok(lines.every(l=>visibleWidth(l)<=width));
      assert.match(screen(f.view,width),/Esc/);assert.match(screen(f.view,width),/F1/);
    }
    f.view.handleInput(keys.escape);
  }
});

test('daily flow: a too-narrow thread cannot accept invisible typing',t=>{
  const hub=new WorkerHub();register(hub,session(),'a');const f=viewFixture(t,{hub});
  f.view.handleInput(keys.enter);screen(f.view,12);f.view.handleInput('invisible');assert.equal(hub.get('a').draft,'');
});

test('daily flow: a long multiline paste keeps all 30 Unicode lines',async t=>{
  const hub=new WorkerHub(),s=session();register(hub,s,'a');const f=viewFixture(t,{hub});
  const text=Array.from({length:30},(_,i)=>`line ${i} 中文`).join('\n');
  f.view.handleInput(keys.enter);f.view.handleInput(`\x1b[200~${text}\x1b[201~`);f.view.handleInput(keys.enter);await tick();
  assert.equal(s.calls[0][1],text);
});

test('daily flow: coalesced updates and repeated views retain one observer and bounded repaint',async t=>{
  const hub=new WorkerHub(),s=session();register(hub,s,'a');const f=viewFixture(t,{hub});f.view.handleInput(keys.enter);
  const before=f.renders(),start=performance.now();
  for(let i=0;i<3000;i++)s.emit({type:'message_update',message:assistant(`stream ${i}`)});
  assert.ok(performance.now()-start<5000);await new Promise(r=>setTimeout(r,70));assert.ok(f.renders()-before<10);
  f.view.dispose();for(let i=0;i<30;i++)new AgentHubView(f.tui,theme,hub,'Main',()=>{},f.state).dispose();
  assert.equal(s.listenerCount(),1);assert.equal(hub.get('a').partial.content[0].text,'stream 2999');
});

test('daily flow: native edit diff is inspectable without executing a tool',t=>{
  const hub=new WorkerHub(),s=session(),record=register(hub,s,'a');
  s.append({role:'assistant',content:[{type:'toolCall',id:'edit',name:'edit',arguments:{path:'not-a-real-file.rs',edits:[{oldText:'old',newText:'NEW_DIFF_CANARY'}]}}]});
  s.append({role:'toolResult',toolCallId:'edit',toolName:'edit',content:[{type:'text',text:'Updated'}],details:{diff:'-1 old\n+1 NEW_DIFF_CANARY',patch:'-old\n+NEW_DIFF_CANARY',firstChangedLine:1}});
  const renderer=new NativeTranscript({requestRender(){}},record);renderer.setExpanded(true);t.after(()=>{renderer.dispose();hub.dispose();});
  const result=renderer.window({follow:false},80,40).lines.join('\n');assert.match(result,/NEW_DIFF_CANARY/);assert.doesNotMatch(result,/Renderer error/);assert.deepEqual(s.calls,[]);
});
