import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { default: extension } = await createJiti(import.meta.url).import('../extension.ts');
test('six symmetric commands and a narrow Explorer, no work during registration', async () => {
  const commands=new Map(), messages=[], tools=[];
  extension({registerCommand:(n,c)=>commands.set(n,c),registerTool:t=>tools.push(t.name),on:()=>{},sendUserMessage:(...a)=>messages.push(a),exec:async()=>({code:0,stdout:'',stderr:''})});
  for(const name of ['spec','plan','build','prepare','review','ship']) assert.ok(commands.has(`dev-${name}`));
  assert.deepEqual(tools,['explore']); assert.equal(messages.length,0);
});
