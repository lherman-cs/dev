import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { config, role } from '../lib/roles.mjs';

test('pinned Pi catalog contains every exact configured Codex model', async () => {
  const runtime = await ModelRuntime.create();
  for (const name of Object.keys(config.roles)) {
    const r = role(name);
    const model = runtime.getModel(r.provider, r.model);
    assert.ok(model, `${name}: missing ${r.provider}/${r.model}`);
    assert.equal(model.provider,'openai-codex');
    assert.equal(model.id,r.model);
  }
});
