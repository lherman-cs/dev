import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { decode } from '@toon-format/toon';
import assert from 'node:assert/strict';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { config, role, type RoleName } from '../lib/roles.ts';

test('commented roles.toon decodes to the runtime role map', () => {
  const source = readFileSync(new URL('../roles.toon', import.meta.url), 'utf8');
  assert.match(source, /^# /m);
  assert.match(source, /^  # /m);
  assert.deepEqual(decode(source, { strict: true }), config);
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
