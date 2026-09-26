const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createJiti } = require('jiti');

test('brief tools inspect only eligible frozen endpoint blobs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-inspect-'));
  const old = process.cwd();
  const previousTree = process.env.DEV_BRIEF_TREE;
  try {
    process.chdir(root);
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
    fs.mkdirSync('src');
    fs.writeFileSync('src/unchanged.rs', 'original\nsecond\n');
    fs.writeFileSync('.env', 'PRIVATE\n');
    git('add', '-A'); git('commit', '-qm', 'snapshot');
    process.env.DEV_BRIEF_TREE = git('rev-parse', 'HEAD^{tree}');
    fs.writeFileSync('src/unchanged.rs', 'changed after snapshot\n');
    fs.writeFileSync('new.txt', 'untracked\n');
    const tools = new Map();
    createJiti(__filename)('../brief-inspect.ts').default({ registerTool: tool => tools.set(tool.name, tool) });
    const call = (name, args) => tools.get(name).execute('test', args);
    const listed = await call('brief_files', {});
    assert.match(listed.content[0].text, /src\/unchanged.rs/);
    assert.doesNotMatch(listed.content[0].text, /\.env/);
    const read = await call('brief_read', { path: 'src/unchanged.rs', start: 1, lines: 1 });
    assert.match(read.content[0].text, /1: original/);
    assert.doesNotMatch(read.content[0].text, /changed after snapshot/);
    await assert.rejects(call('brief_read', { path: '.env' }), /eligible/);
    await assert.rejects(call('brief_read', { path: 'new.txt' }), /eligible/);
    await assert.rejects(call('brief_read', { path: '../outside' }), /eligible/);
  } finally {
    process.chdir(old);
    if (previousTree === undefined) delete process.env.DEV_BRIEF_TREE;
    else process.env.DEV_BRIEF_TREE = previousTree;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
