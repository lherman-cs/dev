import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCapabilities } from '@earendil-works/pi-tui';
import { WorkerHub, session, register, assistant, NativeTranscript, strip } from './helpers/hub.ts';

function fixture(t) {
  const hub=new WorkerHub(),s=session(),r=register(hub,s,'a');
  const transcript=new NativeTranscript({requestRender(){}},r);
  t.after(()=>{transcript.dispose();hub.dispose();});
  return {hub,s,r,transcript};
}
const text=(tr,state={follow:true},width=80,height=1000)=>strip(tr.window(state,width,height).lines.join('\n'));

test('native rendering keeps multiline prose/code and fully expandable errors beyond old truncation limits',t=>{
  const {s,transcript:tr}=fixture(t);
  s.append(assistant('## Result\n\n```rust\nfn main() {\n  println!("hello");\n}\n```'));
  const tool={...assistant(''),content:[{type:'toolCall',id:'t',name:'bash',arguments:{command:'cargo test'}}]};
  s.append(tool);
  const failure=Array.from({length:100},(_,i)=>`error at line ${i}: ${'x'.repeat(80)}`).join('\n')+'\nEND_OF_FAILURE';
  s.append({role:'toolResult',toolName:'bash',toolCallId:'t',content:[{type:'text',text:failure}],isError:true,details:{},timestamp:Date.now()});
  tr.setExpanded(true);
  const shown=text(tr);
  assert.match(shown,/fn main/);assert.match(shown,/END_OF_FAILURE/);assert.match(shown,/error at line 99/);
  assert.match(tr.exportText(),/END_OF_FAILURE/);assert.ok(tr.exportText().length>8000);
});

test('assistant partial and live tool output appear before tool or model completion',t=>{
  const {s,r,transcript:tr}=fixture(t);
  const partial=assistant('streaming token now');
  s.emit({type:'message_update',message:partial,assistantMessageEvent:{type:'text_delta'}});
  assert.match(text(tr),/streaming token now/);
  s.append(partial);
  s.emit({type:'tool_execution_start',toolCallId:'t',toolName:'bash',args:{command:'cargo test'}});
  s.emit({type:'tool_execution_update',toolCallId:'t',toolName:'bash',partialResult:{content:[{type:'text',text:'Compiler progress NOW'}],details:{}}});
  assert.match(text(tr),/Compiler progress NOW/);
  s.append({role:'toolResult',toolCallId:'t',toolName:'bash',content:[{type:'text',text:'final result'}],details:{}});
  const shown=text(tr);assert.equal((shown.match(/streaming token now/g)||[]).length,1);assert.match(shown,/final result/);
  s.messages=[];s.emit({type:'compaction_end'});assert.match(text(tr),/final result/);assert.equal(r.messages.length,2);
});

test('scroll anchor stays at the same settled content as output streams and width changes',t=>{
  const {s,transcript:tr}=fixture(t);
  for(let i=0;i<40;i++)s.append(assistant(`Message ${i}\n\nEvidence ${i}`));
  const state={follow:true};tr.window(state,80,10);tr.scroll(state,-70);
  const before=tr.window(state,80,10);const anchor={...state.anchor};
  for(let i=40;i<55;i++)s.append(assistant(`Message ${i}`));
  const after=tr.window(state,80,10);assert.deepEqual(after.lines,before.lines);assert.deepEqual(state.anchor,anchor);
  tr.window(state,40,10);assert.equal(state.anchor.key,anchor.key);
  tr.live(state);assert.match(text(tr,state,80,10),/Message 54/);
});

test('search and copy use full text, not collapsed previews; custom renderers are reused',t=>{
  const {s,r,transcript:tr}=fixture(t);let calls=0;
  r.session.getToolDefinition=()=>({renderCall(){calls++;return {render:()=>['CUSTOM TOOL'],invalidate(){}};},renderResult(){return {render:()=>['CUSTOM RESULT'],invalidate(){}};}});
  s.append({...assistant(''),content:[{type:'toolCall',id:'x',name:'special',arguments:{scope:'deep'}}]});
  s.append({role:'toolResult',toolCallId:'x',toolName:'special',content:[{type:'text',text:'Full evidence SECRET_MATCH'}],details:{}});
  assert.match(text(tr),/CUSTOM RESULT/);assert.ok(calls>0);
  assert.equal(tr.search({follow:true},'SECRET_MATCH'),true);assert.match(tr.exportText(),/SECRET_MATCH/);
});

test('native image tool results remain represented on terminals without graphics',t=>{
  setCapabilities({images:null,trueColor:true,hyperlinks:true});
  const {s,transcript:tr}=fixture(t);
  s.append({role:'toolResult',toolCallId:'image',toolName:'read',content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ZkAAAAASUVORK5CYII='}],details:{}});
  assert.match(tr.exportText(),/image: image\/png/);
  assert.match(text(tr),/image|png/i);
});

test('cached native blocks are not re-rendered on every unchanged frame',t=>{
  const {s,transcript:tr}=fixture(t);
  for(let i=0;i<500;i++)s.append(assistant(`Response ${i} ${'evidence '.repeat(30)}`));
  tr.window({follow:true},80,20);
  let rendered=0;
  // Runtime JS private fields are only test instrumentation here; the assertion
  // checks native render calls, not a flaky wall-clock threshold.
  for(const block of tr.blocks){const render=block.component.render.bind(block.component);block.component.render=(width)=>{rendered++;return render(width);};}
  for(let i=0;i<30;i++)tr.window({follow:true},80,20);
  assert.equal(rendered,0);
  s.append(assistant('new response'));
  tr.window({follow:true},80,20);
  assert.equal(rendered,0,'only the new block may render');
});

test('search expands tool evidence and lands at the matching line, not just its header',t=>{
  const {s,transcript:tr}=fixture(t);
  s.append({...assistant(''),content:[{type:'toolCall',id:'t',name:'bash',arguments:{command:'test'}}]});
  s.append({role:'toolResult',toolCallId:'t',toolName:'bash',content:[{type:'text',text:Array.from({length:80},(_,i)=>`Line ${i}`).join('\n')+'\nTARGET_AT_BOTTOM'}],details:{}});
  const state={follow:true};tr.window(state,80,10);assert.equal(tr.search(state,'TARGET_AT_BOTTOM'),true);
  assert.match(text(tr,state,80,10),/TARGET_AT_BOTTOM/);assert.equal(state.expanded,true);
});

test('copy includes live partial output without duplicating settled tool results',t=>{
  const hub=new WorkerHub(),s=session(),r=register(hub,s,'a');
  const v=new NativeTranscript({requestRender(){}},r);t.after(()=>{v.dispose();hub.dispose();});
  s.emit({type:'message_update',message:assistant('live prose')});
  s.emit({type:'tool_execution_update',toolCallId:'cmd',toolName:'bash',args:{command:'cargo test'},partialResult:{content:[{type:'text',text:'live diagnostic'}]}});
  assert.match(v.exportText(),/live prose/);assert.match(v.exportText(),/live diagnostic/);
  s.append({role:'toolResult',toolCallId:'cmd',toolName:'bash',content:[{type:'text',text:'final diagnostic'}]});
  s.emit({type:'tool_execution_end',toolCallId:'cmd',toolName:'bash',result:{content:[{type:'text',text:'final diagnostic'}]}});
  assert.equal((v.exportText().match(/final diagnostic/g)||[]).length,1);
});

test('display neutralizes terminal-control and bidi escapes without changing retained raw evidence',t=>{
  const {s,transcript:tr}=fixture(t);
  const hostile='SAFE\n\x1b[2J\x1b]52;c;Y2xpcGJvYXJk\x07VISIBLE\u202e';
  s.append({role:'user',content:hostile});
  const rendered=tr.window({follow:true},80,30).lines.join('\n');
  assert.ok(!rendered.includes('\x1b[2J'));assert.ok(!rendered.includes('\x1b]52'));assert.ok(!rendered.includes('\u202e'));
  assert.match(strip(rendered),/SAFE/);assert.match(strip(rendered),/VISIBLE/);assert.ok(tr.exportText().includes(hostile));
});
