import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TuiMainScreen, TuiAltScreen, Editor, visibleWidth, type OverlayHandle, type Terminal } from '@earendil-works/pi-tui';
import { WorkerHub, session, register, AgentHubView, createHubViewState, keys, theme } from './helpers/hub.ts';
const pause=(): Promise<void>=>new Promise(resolve=>setTimeout(resolve,50));
function required<T>(value: T | undefined, name: string): T { assert.ok(value,`Missing ${name}`); return value; }
class MemoryTerminal implements Terminal {
  rows=24;columns=80;kittyProtocolActive=false;output='';
  input: (data: string) => void = () => undefined;
  resize: () => void = () => undefined;
  start(input: (data: string) => void, resize: () => void): void {this.input=input;this.resize=resize;}
  stop(): void {} drainInput(): Promise<void> {return Promise.resolve();} write(data: string): void {this.output+=data;}
  moveBy(_lines: number): void {} hideCursor(): void {} showCursor(): void {} clearLine(): void {} clearFromCursor(): void {} clearScreen(): void {} setTitle(_title: string): void {} setProgress(_active: boolean): void {}
}
for(const Renderer of [TuiMainScreen,TuiAltScreen])test(`native ${Renderer.name}: focus, editing, sending, resize and return to untouched Main`,async t=>{
  const terminal=new MemoryTerminal(),tui=new Renderer(terminal),hub=new WorkerHub();
  const editorTheme={borderColor:(s: string)=>s,selectList:{selectedPrefix:(s: string)=>s,selectedText:(s: string)=>s,description:(s: string)=>s,scrollInfo:(s: string)=>s,noMatch:(s: string)=>s}};
  const main=new Editor(tui,editorTheme);main.disableSubmit=true;main.setText('Main draft stays here');
  tui.addChild(main);tui.setFocus(main);
  const a=session(),b=session();register(hub,a,'a');register(hub,b,'b');const state=createHubViewState();let overlay: OverlayHandle;
  const view=new AgentHubView(tui,theme,hub,'Main',()=>{overlay.hide();tui.setFocus(main);},state);
  t.after(()=>{overlay?.hide();view.dispose();hub.dispose();tui.stop();});
  tui.start();overlay=tui.showOverlay(view,{width:'100%',maxHeight:'100%',margin:0});tui.setFocus(view);await pause();
  terminal.input(keys.enter);terminal.input('abc');terminal.input(keys.left);terminal.input('?');
  terminal.input(keys.altDown);terminal.input('for B');terminal.input(keys.enter);await pause();
  assert.deepEqual(a.calls,[]);assert.deepEqual(b.calls,[['steer','for B']]);
  assert.equal(required(state.composers.get('a'),'composer a').editor.getExpandedText(),'ab?c');assert.equal(main.getExpandedText(),'Main draft stays here');
  terminal.rows=12;terminal.columns=40;terminal.resize();await pause();assert.ok(view.render(40).every(l=>visibleWidth(l)<=40));
  assert.match(terminal.output,/Agent Hub/);terminal.input('\x1ba');await pause();terminal.input('!');
  assert.equal(main.getExpandedText(),'Main draft stays here!');assert.equal(required(state.composers.get('a'),'composer a').editor.getExpandedText(),'ab?c');
});
