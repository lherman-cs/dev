import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

test('native Pi loads pinned plugins, four aliases and skills without errors', async t => {
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
  assert.deepEqual(commands.filter(name => name.startsWith('dev-')).sort(), ['dev-build', 'dev-plan', 'dev-ship', 'dev-spec']);
  const tools = loaded.extensions.flatMap(e => [...e.tools.keys()]);
  for (const tool of ['explore', 'review', 'todo', 'ask_user_question', 'lsp_diagnostics', 'lsp_fix', 'chrome_devtools_load', 'web_search', 'fetch_content', 'mcp', 'fffind', 'ffgrep']) assert.ok(tools.includes(tool), tools.join(','));
  assert.ok(!tools.includes('subagent'));
  const names = loader.getSkills().skills.map(s => s.name);
  for (const skill of ['dev-spec','dev-plan','dev-build','dev-ship','dev-review']) assert.ok(names.includes(skill), names.join(','));
  const explorer = loader.getSkills().skills.find(skill => skill.name === 'dev-explore');
  assert.equal(explorer?.disableModelInvocation, true, 'Main must not see Explorer skill metadata for automatic loading');
});
