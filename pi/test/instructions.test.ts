import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const skill = (name: string): string => fs.readFileSync(new URL(`../skills/dev-${name}/SKILL.md`,import.meta.url),'utf8');

test('94d10a6 semantic contracts retain authority, outputs and stop conditions at skill scope',()=>{
  const requirements={
    spec:['speculative requirements','callers/callees','data ownership','failure paths','acceptance evidence','manages any extra worktrees','Do not design implementation tasks','Only explicit human approval','Stop after the approved spec'],
    plan:['independently testable','simplest durable design','robustness','scalability','deterministic proof','Avoid unrelated cleanup','Delete before adding','standard/native facilities','speculative abstraction','Do not duplicate','Stop after the approved'],
    build:['approved plan to completion','one independently testable','Fix root causes','fast, deterministic','Do not weaken, delete, or bypass','data safety','accessibility','necessary observability','Conventional Commit','NEEDS_REPLAN'],
    ship:['fixed-purpose ship action tool','clean, HEAD-bound handoff','Builder, failed-CI, and Reviewer payloads unchanged','Never merge','two-round limit','approval of its hash'],
    'ship-builder':['technical preparation and repair','consequential ambiguity','repository-defined format, lint, test','Conventional Commits','PREPARED','FAILED','NEEDS_HUMAN'],

    review:['exact HEAD','Red CI is evidence','verified Explorer findings','bounded/adversarial but conservative','stable root-cause key','BLOCKED is only','Never edit product code','Do not rerun passing tests'],
    explore:['one independently scoped factual question','boundaries and sibling exclusions','parent conversation context is unavailable','Do not edit source','targeted tests, builds, lints, benchmarks, CI/check inspection, and log-analysis commands','make project decisions','Do not delegate, invoke, or spawn another agent','primary sources for external facts','Repository and tool evidence outrank summaries','Stop when the assigned scope is answered','FOUND','path:line','submit_result'],
  };
  for(const [name,terms] of Object.entries(requirements)) {
    const text=skill(name);for(const term of terms)assert.ok(text.includes(term),`${name}: ${term}`);
    assert.ok(!text.includes('workflow_brief'),'retired renderer');
    assert.ok(Buffer.byteLength(text)<2000,'keep semantic skills compact');
  }
});
test('all role skills require explicit invocation',()=>{
  const skillsDir=new URL('../skills/',import.meta.url);
  const names=fs.readdirSync(skillsDir).filter(name=>fs.statSync(new URL(`${name}/SKILL.md`,skillsDir)).isFile());
  for(const name of names) {
    const text=fs.readFileSync(new URL(`${name}/SKILL.md`,skillsDir),'utf8');
    assert.match(text,/^disable-model-invocation: true$/m,name);
  }
});
test('instruction invariants and user-wide preferences are retained, without stale plugin authority',()=>{
  const agents=fs.readFileSync(new URL('../../AGENTS.md',import.meta.url),'utf8');
  for(const term of ['No duplication or contradiction','Least-privilege scope','Do not teach defaults','Explorer-first context economy','Pi lazy-skills','explicit `/skill:<name>` invocation','must use Explorer heavily','independent scopes in parallel','raw exploration stays out of the main context','must not duplicate skill semantics','do not add precedence prose','only foreground coordinator is the fixed-purpose, typed `/dev-ship` runtime']) assert.ok(agents.includes(term),term);
  const preferences=fs.readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8');
  for(const term of ['Do not use em dashes','consequential decision remains unresolved','Preserve user work']) assert.ok(preferences.includes(term),term);
  assert.ok(!agents.includes('pi-subagents'));
  const workflow=fs.readFileSync(new URL('../../WORKFLOW.md',import.meta.url),'utf8');
  for(const term of ['Runtime allowlists enforce isolation','semantic parent responsibilities','rather than misrepresented as mechanically provable','fixed-purpose typed runtime']) assert.ok(workflow.includes(term),term);
  assert.ok(!workflow.includes('There is no controller'));
});
