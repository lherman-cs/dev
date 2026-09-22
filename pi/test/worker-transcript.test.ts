import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setCapabilities, type TUI } from '@earendil-works/pi-tui';
import { Type, type AssistantMessage, type ToolResultMessage } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { WorkerHub, session, register, assistant, NativeTranscript, strip } from './helpers/hub.ts';
import type { Viewport } from '../lib/worker-transcript.ts';

const tuiStub = (): TUI => ({requestRender(){}} as TUI);
function fixture(t: TestContext) {
  const hub=new WorkerHub(),s=session(),r=register(hub,s,'a');
  const transcript=new NativeTranscript(tuiStub(),r);
  t.after(()=>{transcript.dispose();hub.dispose();});
  return {hub,s,r,transcript};
}
const text=(tr: NativeTranscript,state: Viewport={follow:true},width=80,height=1000): string=>strip(tr.window(state,width,height).lines.join('\n'));
const toolResult=(toolCallId: string, toolName: string, content: ToolResultMessage['content'], details: ToolResultMessage['details'] = {}): ToolResultMessage=>({role:'toolResult',toolCallId,toolName,content,details,isError:false,timestamp:Date.now()});

test('native rendering keeps multiline prose/code and fully expandable errors beyond old truncation limits',t=>{
  const {s,transcript:tr}=fixture(t);
  s.append(assistant('## Result\n\n```rust\nfn main() {\n  println!("hello");\n}\n```'));
  const tool: AssistantMessage={...assistant(''),content:[{type:'toolCall',id:'t',name:'bash',arguments:{command:'cargo test'}}]};
  s.append(tool);
  const failure=Array.from({length:100},(_,i)=>`error at line ${i}: ${'x'.repeat(80)}`).join('\n')+'\nEND_OF_FAILURE';
  s.append({...toolResult('t','bash',[{type:'text',text:failure}]),isError:true});
  tr.setExpanded(true);
  const shown=text(tr);
  assert.match(shown,/fn main/);assert.match(shown,/END_OF_FAILURE/);assert.match(shown,/error at line 99/);
  assert.match(tr.exportText(),/END_OF_FAILURE/);assert.ok(tr.exportText().length>8000);
});

test('assistant partial and live tool output appear before tool or model completion',t=>{
  const {s,r,transcript:tr}=fixture(t);
  const partial=assistant('streaming token now');
  s.emit({type:'message_update',message:partial,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'',partial}});
  assert.match(text(tr),/streaming token now/);
  s.append(partial);
  s.emit({type:'tool_execution_start',toolCallId:'t',toolName:'bash',args:{command:'cargo test'}});
  s.emit({type:'tool_execution_update',toolCallId:'t',toolName:'bash',args:{command:'cargo test'},partialResult:{content:[{type:'text',text:'Compiler progress NOW'}]}});
  assert.match(text(tr),/Compiler progress NOW/);
  s.append(toolResult('t','bash',[{type:'text',text:'final result'}]));
  const shown=text(tr);assert.equal((shown.match(/streaming token now/g)||[]).length,1);assert.match(shown,/final result/);
  s.messages=[];s.emit({type:'compaction_end',reason:'manual',result:undefined,aborted:false,willRetry:false});assert.match(text(tr),/final result/);assert.ok(r.messages);assert.equal(r.messages.length,2);
});

test('scroll anchor stays at the same settled content as output streams and width changes',t=>{
  const {s,transcript:tr}=fixture(t);
  for(let i=0;i<40;i++)s.append(assistant(`Message ${i}\n\nEvidence ${i}`));
  const state: Viewport={follow:true};tr.window(state,80,10);tr.scroll(state,-70);
  const before=tr.window(state,80,10);assert.ok(state.anchor);const anchor={...state.anchor};
  for(let i=40;i<55;i++)s.append(assistant(`Message ${i}`));
  const after=tr.window(state,80,10);assert.deepEqual(after.lines,before.lines);assert.deepEqual(state.anchor,anchor);
  tr.window(state,40,10);assert.ok(state.anchor);assert.equal(state.anchor.key,anchor.key);
  tr.live(state);assert.match(text(tr,state,80,10),/Message 54/);
});

test('search and copy use full text, not collapsed previews; custom renderers are reused',t=>{
  const {s,r,transcript:tr}=fixture(t);let calls=0;
  assert.ok(r.session);
  const customTool: ToolDefinition = {name:'special',label:'Special',description:'Test renderer',parameters:Type.Object({}),async execute(){return {content:[],details:undefined};},renderCall(){calls++;return {render:()=>['CUSTOM TOOL'],invalidate(){}};},renderResult(){return {render:()=>['CUSTOM RESULT'],invalidate(){}};}};
  r.session.getToolDefinition=()=>customTool;
  s.append({...assistant(''),content:[{type:'toolCall',id:'x',name:'special',arguments:{scope:'deep'}}]} as AssistantMessage);
  s.append(toolResult('x','special',[{type:'text',text:'Full evidence SECRET_MATCH'}]));
  assert.match(text(tr),/CUSTOM RESULT/);assert.ok(calls>0);
  assert.equal(tr.search({follow:true},'SECRET_MATCH'),true);assert.match(tr.exportText(),/SECRET_MATCH/);
});

test('native image tool results remain represented on terminals without graphics',t=>{
  setCapabilities({images:null,trueColor:true,hyperlinks:true});
  const {s,transcript:tr}=fixture(t);
  s.append(toolResult('image','read',[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ZkAAAAASUVORK5CYII='}]));
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
  tr.forEachComponent(component=>{const render=component.render.bind(component);component.render=(width: number)=>{rendered++;return render(width);};});
  for(let i=0;i<30;i++)tr.window({follow:true},80,20);
  assert.equal(rendered,0);
  s.append(assistant('new response'));
  tr.window({follow:true},80,20);
  assert.equal(rendered,0,'only the new block may render');
});

test('search expands tool evidence and lands at the matching line, not just its header',t=>{
  const {s,transcript:tr}=fixture(t);
  s.append({...assistant(''),content:[{type:'toolCall',id:'t',name:'bash',arguments:{command:'test'}}]} as AssistantMessage);
  s.append(toolResult('t','bash',[{type:'text',text:Array.from({length:80},(_,i)=>`Line ${i}`).join('\n')+'\nTARGET_AT_BOTTOM'}]));
  const state: Viewport={follow:true};tr.window(state,80,10);assert.equal(tr.search(state,'TARGET_AT_BOTTOM'),true);
  assert.match(text(tr,state,80,10),/TARGET_AT_BOTTOM/);assert.equal(state.expanded,true);
});

test('copy includes live partial output without duplicating settled tool results',t=>{
  const hub=new WorkerHub(),s=session(),r=register(hub,s,'a');
  const v=new NativeTranscript(tuiStub(),r);t.after(()=>{v.dispose();hub.dispose();});
  const live=assistant('live prose');s.emit({type:'message_update',message:live,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'',partial:live}});
  s.emit({type:'tool_execution_update',toolCallId:'cmd',toolName:'bash',args:{command:'cargo test'},partialResult:{content:[{type:'text',text:'live diagnostic'}]}});
  assert.match(v.exportText(),/live prose/);assert.match(v.exportText(),/live diagnostic/);
  s.append(toolResult('cmd','bash',[{type:'text',text:'final diagnostic'}]));
  s.emit({type:'tool_execution_end',toolCallId:'cmd',toolName:'bash',result:{content:[{type:'text',text:'final diagnostic'}]},isError:false});
  assert.equal((v.exportText().match(/final diagnostic/g)||[]).length,1);
});

test('display neutralizes terminal-control and bidi escapes without changing retained raw evidence',t=>{
  const {s,transcript:tr}=fixture(t);
  const hostile='SAFE\n\x1b[2J\x1b]52;c;Y2xpcGJvYXJk\x07VISIBLE\u202e';
  s.append({role:'user',content:hostile,timestamp:Date.now()});
  const rendered=tr.window({follow:true},80,30).lines.join('\n');
  assert.ok(!rendered.includes('\x1b[2J'));assert.ok(!rendered.includes('\x1b]52'));assert.ok(!rendered.includes('\u202e'));
  assert.match(strip(rendered),/SAFE/);assert.match(strip(rendered),/VISIBLE/);assert.ok(tr.exportText().includes(hostile));
});
