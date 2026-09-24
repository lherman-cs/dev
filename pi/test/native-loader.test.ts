import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

test('native Pi loads pinned plugins, goal controls, phase aliases and skills without errors', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pi-loader-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir,
    settingsManager: SettingsManager.inMemory({ packages: [pkg] }),
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, [], JSON.stringify(loaded.errors));
  const commands = loaded.extensions.flatMap(e => [...e.commands.keys()]);
  assert.deepEqual(commands.filter(name => name.startsWith('dev-')).sort(), ['dev-build', 'dev-goal', 'dev-review', 'dev-review-view', 'dev-ship', 'dev-spec']);
  const tools = loaded.extensions.flatMap(e => [...e.tools.keys()]);
  assert.ok(tools.includes('explore'));
  assert.ok(tools.includes('review_publish'));
  assert.ok(tools.includes('review_reply'));
  assert.ok(!tools.includes('fffind'));
  assert.ok(!tools.includes('ffgrep'));
  assert.ok(!tools.includes('subagent'));
  const names = loader.getSkills().skills.map(s => s.name);
  for (const skill of ['dev-spec','dev-build','dev-ship','dev-review']) assert.ok(names.includes(skill), names.join(','));
  const explorer = loader.getSkills().skills.find(skill => skill.name === 'dev-explore');
  assert.equal(explorer?.disableModelInvocation, true, 'Main must not see Explorer skill metadata for automatic loading');
});
