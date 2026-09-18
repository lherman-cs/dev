import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const source = path.join(root, 'dotfiles/.pi/agent/extensions/dev-workflow.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pi-test-'));
const modulePath = path.join(tmp, 'dev-workflow.mjs');
fs.copyFileSync(source, modulePath);

const checked = spawnSync(process.execPath, ['--check', modulePath], { encoding: 'utf8' });
if (checked.status !== 0) {
  process.stderr.write(checked.stderr || checked.stdout);
  process.exit(checked.status ?? 1);
}

const text = fs.readFileSync(source, 'utf8');
for (const name of ['dev-spec', 'dev-plan', 'dev-build', 'dev-prepare', 'dev-review', 'dev-ship']) {
  if (!text.includes(`registerCommand("${name}"`)) throw new Error(`missing /${name}`);
}
for (const required of ['workflow_brief', 'handleMouse(event)', 'new Image(', 'new Markdown(', 'name: "explore"', 'replacementCtx.sendUserMessage(prompt)', 'resolvedRoleProfile', 'isMermaid', 'ctx.ui.editor("Review feedback"', 'Plan-ID:', '--no-session', '--mode']) {
  if (!text.includes(required)) throw new Error(`missing extension capability: ${required}`);
}

// Stub Pi modules so the extension can be loaded without installing Pi in CI.
const modules = path.join(tmp, 'node_modules');
function pkg(name, body) {
  const dir = path.join(modules, ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), body);
}
pkg('typebox', `export const Type={Object:(x)=>x,Array:(x)=>x,Optional:(x)=>x,Union:(x)=>x,Literal:(x)=>x,String:()=>({}),Boolean:()=>({})};`);
pkg('@earendil-works/pi-coding-agent', `export const getMarkdownTheme=()=>({});`);
pkg('@earendil-works/pi-tui', `
export class Markdown { constructor(t){this.t=t||''} render(){return String(this.t).split('\\n')} invalidate(){} }
export class Image { constructor(){} render(){return ['[image]']} invalidate(){} }
export const Key={escape:'esc',tab:'tab',space:'space',left:'left',right:'right',up:'up',down:'down',ctrl:(x)=>'ctrl+'+x,shift:(x)=>'shift+'+x};
export const matchesKey=(d,k)=>d===k;
export const truncateToWidth=(s,w)=>String(s).slice(0,w);
export const wrapTextWithAnsi=(s)=>[String(s)];
`);

// Exercise the deterministic build driver with real Git and fake Pi/TOON CLIs.
const bin = path.join(tmp, 'bin');
const repo = path.join(tmp, 'repo');
const agentDir = path.join(tmp, 'agent');
fs.mkdirSync(bin); fs.mkdirSync(repo); fs.mkdirSync(agentDir, { recursive: true });
fs.copyFileSync(path.join(root, 'dotfiles/.pi/agent/dev-workflow.json'), path.join(agentDir, 'dev-workflow.json'));

const fakeToon = `#!/usr/bin/env node
const fs=require('fs'); const a=process.argv.slice(2);
if(a[0]==='--encode'){let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(s));}
else process.stdout.write(fs.readFileSync(a[0],'utf8'));
`;
fs.writeFileSync(path.join(bin, 'toon'), fakeToon, { mode: 0o755 });

const fakePi = `#!/usr/bin/env node
const fs=require('fs'),cp=require('child_process'),path=require('path');
const prompt=process.argv.at(-1); const m=/^Execution contract: (.+)$/m.exec(prompt); if(!m) process.exit(2);
const plan=JSON.parse(fs.readFileSync(m[1],'utf8'));
fs.writeFileSync(path.join(process.cwd(),\`built-\${plan.id}.txt\`),plan.id+'\\n');
cp.execFileSync('git',['add',\`built-\${plan.id}.txt\`]);
cp.execFileSync('git',['-c','user.name=Pi Test','-c','user.email=pi@test.invalid','commit','-m',\`build \${plan.id}\\n\\nPlan-ID: \${plan.id}\`],{stdio:'ignore'});
const message={role:'assistant',content:[{type:'text',text:'implemented '+plan.id}],usage:{totalTokens:1000}};
process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');
`;
fs.writeFileSync(path.join(bin, 'pi'), fakePi, { mode: 0o755 });

execFileSync('git', ['init', '-q'], { cwd: repo });
fs.writeFileSync(path.join(repo, '.gitignore'), 'plans/\n');
fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
execFileSync('git', ['add', '.gitignore', 'seed.txt'], { cwd: repo });
execFileSync('git', ['-c', 'user.name=Pi Test', '-c', 'user.email=pi@test.invalid', 'commit', '-qm', 'seed'], { cwd: repo });
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const projectDir = path.join(repo, 'plans', 'demo');
const planDir = path.join(projectDir, 'plans');
const repairDir = path.join(projectDir, 'repairs');
fs.mkdirSync(planDir, { recursive: true }); fs.mkdirSync(repairDir, { recursive: true });
fs.writeFileSync(path.join(projectDir, 'spec.md'), 'Status: APPROVED\n');
fs.writeFileSync(path.join(projectDir, 'project.toon'), JSON.stringify({ version: 1, name: 'demo', status: 'ready', base, depends_on: [], final_checks: [] }));
fs.writeFileSync(path.join(planDir, 'P001.toon'), JSON.stringify({ version: 1, id: 'P001', title: 'one', depends_on: [], checks: ['test -f built-P001.txt'] }));
fs.writeFileSync(path.join(planDir, 'P002.toon'), JSON.stringify({ version: 1, id: 'P002', title: 'two', depends_on: ['P001'], checks: ['test -f built-P002.txt'] }));

process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PATH = `${bin}:${process.env.PATH}`;
const { default: extension } = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
const commands = new Map();
const tools = new Map();
const notifications = [];
const pi = {
  registerCommand: (name, def) => commands.set(name, def),
  registerTool: (def) => tools.set(def.name, def),
  on: () => {},
};
extension(pi);
if (!tools.has('explore') || !tools.has('workflow_brief')) throw new Error('expected rich/explorer tools');
const ctx = {
  cwd: repo, hasUI: false, mode: 'print',
  modelRegistry: {
    find: () => undefined,
    getAvailable: async () => [
      { provider: 'openai', id: 'gpt-5.6-sol' },
      { provider: 'openai', id: 'gpt-5.6-luna' },
      { provider: 'openai', id: 'gpt-6-astra' },
    ],
  },
  ui: {
    select: async () => 'demo', confirm: async () => true,
    setStatus: () => {}, setWidget: () => {}, notify: (message, kind) => notifications.push({ message, kind }),
  },
};
await commands.get('dev-build').handler('', ctx);
let progress = JSON.parse(fs.readFileSync(path.join(projectDir, 'progress.toon'), 'utf8'));
if (JSON.stringify(progress.done) !== JSON.stringify(['P001', 'P002'])) throw new Error(`unexpected initial progress ${JSON.stringify(progress)}`);
if (progress.current !== null) throw new Error('current plan was not cleared');

// A human-approved repair is just another immutable execution contract.
fs.writeFileSync(path.join(repairDir, 'R001.toon'), JSON.stringify({ version: 1, id: 'R001', title: 'repair', depends_on: ['P002'], checks: ['test -f built-R001.txt'] }));
await commands.get('dev-build').handler('demo', ctx);
progress = JSON.parse(fs.readFileSync(path.join(projectDir, 'progress.toon'), 'utf8'));
if (JSON.stringify(progress.done) !== JSON.stringify(['P001', 'P002', 'R001'])) throw new Error(`repair was not driven ${JSON.stringify(progress)}`);
const commits = Number(execFileSync('git', ['rev-list', '--count', `${base}..HEAD`], { cwd: repo, encoding: 'utf8' }).trim());
if (commits !== 3) throw new Error(`expected 3 plan/repair commits, got ${commits}`);
if (!notifications.some(n => n.message.includes('Build complete'))) throw new Error('build did not report completion');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('Pi extension syntax + deterministic build/repair smoke test: PASS');
