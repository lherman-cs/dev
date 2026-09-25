import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('native package registration preserves auth and unrelated settings', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pi-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const compaction = {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
    modelOverrides: { 'openai-codex/gpt-6-sol': { reserveTokens: 192000 } },
  };
  const settings = { theme: 'light', defaultThinkingLevel: 'high', packages: [], testUserField: 'keep', compaction };
  const auth = '{"custom-provider":{"type":"api_key","key":"NOT_A_REAL_KEY"}}\n';
  fs.writeFileSync(path.join(dir,'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir,'auth.json'), auth);
  const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
  const readSettings = () => JSON.parse(fs.readFileSync(path.join(dir,'settings.json'),'utf8'));
  execFileSync(path.join(pkg,'node_modules/.bin/pi'), ['install',pkg], {env,encoding:'utf8'});
  const first = readSettings();
  execFileSync(path.join(pkg,'node_modules/.bin/pi'), ['install',pkg], {env,encoding:'utf8'});
  const after = readSettings();
  assert.equal(after.theme,settings.theme); assert.equal(after.testUserField,'keep');
  assert.equal(after.defaultThinkingLevel,'high');
  assert.deepEqual(after.compaction,compaction,'package registration must preserve compaction overrides');
  assert.equal(after.packages.length,1,JSON.stringify(after));
  assert.deepEqual(after.packages, first.packages, 'native normalization must remain idempotent');
  assert.equal(fs.readFileSync(path.join(dir,'auth.json'),'utf8'),auth);
});

test('actual installer registers once, retires only owned plumbing and preserves user preferences', t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dev-pi-script-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const agent=path.join(home,'agent'),bin=path.join(home,'bin');fs.mkdirSync(agent);fs.mkdirSync(bin);
  // Dependencies are already installed; exercise all actual registration/backup logic offline.
  fs.writeFileSync(path.join(bin,'npm'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const auth='{"custom":{"type":"api_key","key":"NOT_A_REAL_KEY"}}\n';
  fs.writeFileSync(path.join(agent,'auth.json'),auth);fs.writeFileSync(path.join(agent,'AGENTS.md'),'User preferences, keep me.\n');
  fs.writeFileSync(path.join(agent,'settings.json'),JSON.stringify({packages:[],testUserField:'keep'}));
  fs.mkdirSync(path.join(agent,'extensions'));fs.writeFileSync(path.join(agent,'extensions/dev-workflow.ts'),'retired');
  const env={...process.env,PI_CODING_AGENT_DIR:agent,PATH:bin+path.delimiter+process.env["PATH"]};
  for(let i=0;i<2;i++)execFileSync('bash',[path.join(pkg,'../scripts/install-pi.sh')],{env,encoding:'utf8'});
  assert.equal(fs.readFileSync(path.join(agent,'auth.json'),'utf8'),auth);
  assert.equal(fs.readFileSync(path.join(agent,'AGENTS.md'),'utf8'),'User preferences, keep me.\n');
  const settings=JSON.parse(fs.readFileSync(path.join(agent,'settings.json'),'utf8'));
  assert.equal(settings.testUserField,'keep');assert.equal(settings.packages.length,1);
  assert.ok(!fs.existsSync(path.join(agent,'extensions/dev-workflow.ts')));
  assert.ok(fs.existsSync(path.join(agent,'dev-workflow-backup')));
  const installed = path.join(agent, 'dev-workflow');
  for (const reference of ['reconcile.md', 'engineering.md']) {
    assert.ok(fs.existsSync(path.join(installed, 'references', reference)), `missing installed reference ${reference}`);
  }
  for (const name of ['dev-spec', 'dev-brief', 'dev-build', 'dev-ship', 'dev-review', 'dev-explore']) {
    const skillDir = path.join(installed, 'skills', name);
    const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    for (const match of skill.matchAll(/Read `((?:\.\.\/)+references\/[^`]+)`/g)) {
      const relative = match[1]!;
      assert.ok(fs.existsSync(path.resolve(skillDir, relative)), `${name} cannot read ${relative}`);
    }
  }
});
