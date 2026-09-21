import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const skill = name => fs.readFileSync(new URL(`../skills/dev-${name}/SKILL.md`,import.meta.url),'utf8');

test('94d10a6 semantic contracts retain authority, outputs and stop conditions at skill scope',()=>{
  const requirements={
    spec:['non-goals','acceptance evidence','manages any extra worktrees','Do not design implementation tasks','Only explicit human approval','Stop after the approved spec'],
    plan:['independently testable','Dispatched plans are immutable','not ordinary debugging','supersedes','Do not duplicate','Stop after approved'],
    implement:['exactly the assigned','Conventional Commit','On retry, amend','Never edit workflow artifacts','NEEDS_REPLAN'],
    prepare:['Operational candidate preparation only','clean worktree','mechanical/minimal','draft','Then stop','wait/poll'],
    review:['exact HEAD','Red CI is evidence','bounded/adversarial but conservative','stable root-cause key','BLOCKED is only','Never edit product code','Do not rerun passing tests'],
    explore:['one independently scoped factual question','Remain read-only','Do not delegate','Stop when the assigned scope is answered','FOUND','path:line'],
  };
  for(const [name,terms] of Object.entries(requirements)) {
    const text=skill(name);for(const term of terms)assert.ok(text.includes(term),`${name}: ${term}`);
    assert.ok(!text.includes('workflow_brief'),'retired renderer');
    assert.ok(Buffer.byteLength(text)<2000,'keep semantic skills compact');
  }
});
test('instruction invariants and original user preferences are retained, without stale plugin authority',()=>{
  const agents=fs.readFileSync(new URL('../../AGENTS.md',import.meta.url),'utf8');
  for(const term of ['No duplication or contradiction','Least-privilege scope','Do not teach defaults','Explorer-first context economy','must use Explorer heavily','independent scopes in parallel','raw exploration stays out of the main context','must not duplicate skill semantics','do not add precedence prose']) assert.ok(agents.includes(term),term);
  const preferences=fs.readFileSync(new URL('../preferences.md',import.meta.url),'utf8');
  for(const term of ['Do not use em dashes','unresolved semantics','never discard unrelated changes']) assert.ok(preferences.includes(term));
  assert.ok(!agents.includes('pi-subagents'));
});
