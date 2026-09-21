import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TuiMainScreen, TuiAltScreen, Editor, visibleWidth } from '@earendil-works/pi-tui';
import { WorkerHub, session, register, AgentHubView, createHubViewState, keys, theme } from './helpers/hub.mjs';
const pause=()=>new Promise(r=>setTimeout(r,50));
class MemoryTerminal {
  rows=24;columns=80;kittyProtocolActive=false;output='';
  start(input,resize){this.input=input;this.resize=resize;}
  stop(){} drainInput(){return Promise.resolve();} write(data){this.output+=data;}
  moveBy(){} hideCursor(){} showCursor(){} clearLine(){} clearFromCursor(){} clearScreen(){} setTitle(){} setProgress(){}
}
for(const Renderer of [TuiMainScreen,TuiAltScreen])test(`native ${Renderer.name}: focus, editing, sending, resize and return to untouched Main`,async t=>{
  const terminal=new MemoryTerminal(),tui=new Renderer(terminal),hub=new WorkerHub();
  const editorTheme={borderColor:s=>s,selectList:{selectedPrefix:s=>s,selectedText:s=>s,description:s=>s,scrollInfo:s=>s,noMatch:s=>s}};
  const main=new Editor(tui,editorTheme);main.disableSubmit=true;main.setText('Main draft stays here');
  tui.addChild(main);tui.setFocus(main);
  const a=session(),b=session();register(hub,a,'a');register(hub,b,'b');const state=createHubViewState();let overlay;
  const view=new AgentHubView(tui,theme,hub,'Main',()=>{overlay.hide();tui.setFocus(main);},state);
  t.after(()=>{overlay?.hide();view.dispose();hub.dispose();tui.stop();});
  tui.start();overlay=tui.showOverlay(view,{width:'100%',maxHeight:'100%',margin:0});tui.setFocus(view);await pause();
  terminal.input(keys.enter);terminal.input('abc');terminal.input(keys.left);terminal.input('?');
  terminal.input(keys.altDown);terminal.input('for B');terminal.input(keys.enter);await pause();
  assert.deepEqual(a.calls,[]);assert.deepEqual(b.calls,[['steer','for B']]);
  assert.equal(state.composers.get('a').editor.getExpandedText(),'ab?c');assert.equal(main.getExpandedText(),'Main draft stays here');
  terminal.rows=12;terminal.columns=40;terminal.resize();await pause();assert.ok(view.render(40).every(l=>visibleWidth(l)<=40));
  assert.match(terminal.output,/Agent Hub/);terminal.input('\x1ba');await pause();terminal.input('!');
  assert.equal(main.getExpandedText(),'Main draft stays here!');assert.equal(state.composers.get('a').editor.getExpandedText(),'ab?c');
});
