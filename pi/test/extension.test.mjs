import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { default: extension, explorerOnlyTools } = await createJiti(import.meta.url).import('../extension.ts');
test('six symmetric commands and a narrow Explorer, no work during registration', async () => {
  const commands=new Map(), handlers=new Map(), messages=[], tools=[];
  extension({registerCommand:(n,c)=>commands.set(n,c),registerTool:t=>tools.push(t),on:(n,h)=>handlers.set(n,h),sendUserMessage:(...a)=>messages.push(a),exec:async()=>({code:0,stdout:'',stderr:''})});
  for(const name of ['spec','plan','build','prepare','review','ship']) assert.ok(commands.has(`dev-${name}`));
  assert.deepEqual(tools.map(t=>t.name),['explore']); assert.equal(messages.length,0);
  assert.match(tools[0].promptGuidelines.join('\n'),/Give each explore call one explicit independent scope/);
  for(const toolName of explorerOnlyTools) assert.match(handlers.get('tool_call')({toolName}).reason,/narrowly scoped explore calls/);
  assert.equal(handlers.get('tool_call')({toolName:'read'}),undefined);
});
