import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import assert from 'node:assert/strict';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { config, role, type RoleName } from '../lib/roles.ts';

test('commented roles.toml parses to the runtime role map', () => {
  const source = readFileSync(new URL('../roles.toml', import.meta.url), 'utf8');
  assert.match(source, /^# /m);
  assert.match(source, /^\[roles\]$/m);
  assert.deepEqual(parse(source), config);
  assert.equal(role('spec').thinking, 'medium');
  assert.equal(role('assessor').thinking, 'high');
});

test('Pi catalog contains every configured role model', async () => {
  const runtime = await ModelRuntime.create();
  for (const name of Object.keys(config.roles) as RoleName[]) {
    const r = role(name);
    const model = runtime.getModel(r.provider, r.model);
    assert.ok(model, `${name}: missing ${r.provider}/${r.model}`);
    assert.equal(model.id,r.model);
  }
});
