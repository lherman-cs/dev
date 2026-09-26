// The brief agent can inspect only blobs in the captured endpoint tree.
// No live filesystem reads, subprocess arguments from the model, or mutation tools.
import { execFileSync } from 'node:child_process';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const tree = process.env['DEV_BRIEF_TREE'] || '';
if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(tree)) throw Error('Missing captured brief tree');
function git(args: string[], limit: number): Buffer {
  return execFileSync('git', args, { encoding: 'buffer', maxBuffer: limit, timeout: 15000 });
}
function excluded(path: string): boolean {
  const name = path.split('/').pop()!.toLowerCase();
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.pem') || name.endsWith('.key') ||
    name.includes('credential') || name.includes('secret') || name === 'id_rsa' || name === 'id_ed25519' ||
    path.split('/').some(part => ['.git', 'node_modules', 'target'].includes(part));
}
function validPath(path: string): boolean {
  return !!path && !path.startsWith('/') && !/[\0\n\r\\:]/.test(path) &&
    path.split('/').every(part => part !== '.' && part !== '..' && part !== '');
}
function oidFor(path: string): string | undefined {
  if (!validPath(path) || excluded(path)) return;
  const records = git(['ls-tree', '-z', '--full-tree', tree, '--', path], 4096).toString('utf8');
  for (const record of records.split('\0')) {
    const match = /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/.exec(record);
    if (match?.[3] === path) return match[2];
  }
  return;
}
function files(prefix: string): string {
  if (prefix && !validPath(prefix.replace(/\/$/, ''))) throw Error('Invalid path prefix');
  const directory = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
  const args = ['ls-tree', '-rz', '--full-tree', tree];
  if (directory) args.push('--', directory);
  let records: string;
  try { records = git(args, 1_000_000).toString('utf8'); }
  catch {
    const roots = git(['ls-tree', '-z', tree], 64_000).toString('utf8').split('\0')
      .map(line => line.split('\t')[1]).filter((name): name is string => !!name && !excluded(name));
    return `Directory listing too large; narrow prefix to a directory:\n${roots.slice(0, 100).join('\n')}`;
  }
  const names = records.split('\0').map(record => /^(100644|100755) blob [0-9a-f]+\t(.+)$/.exec(record)?.[2])
    .filter((name): name is string => !!name && !excluded(name) && name.startsWith(prefix));
  return `${names.slice(0, 100).join('\n')}\n${names.length > 100 ? `... ${names.length - 100} more paths; narrow prefix` : ''}`;
}
const result = (text: string) => ({ content: [{ type: 'text' as const, text }], details: undefined });
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'brief_files', label: 'Captured files',
    description: 'List eligible source paths in the frozen comparison endpoint. Optional path prefix; at most 100 names.',
    parameters: Type.Object({ prefix: Type.Optional(Type.String()) }),
    async execute(_id, { prefix }) {
      return result(files(prefix || ''));
    },
  });
  pi.registerTool({
    name: 'brief_read', label: 'Read captured source',
    description: 'Read a UTF-8 source file from the frozen endpoint tree with snapshot-relative line numbers. Only ordinary eligible repository paths; up to 160 lines per call.',
    parameters: Type.Object({ path: Type.String(), start: Type.Optional(Type.Number()), lines: Type.Optional(Type.Number()) }),
    async execute(_id, { path, start = 1, lines = 100 }) {
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(lines) || lines < 1 || lines > 160)
        throw Error('Use start >= 1 and 1..160 lines');
      const oid = oidFor(path);
      if (!oid) throw Error('Path is not an eligible captured source file');
      const size = Number(git(['cat-file', '-s', oid], 100).toString());
      if (!Number.isSafeInteger(size) || size > 120_000) throw Error('Source is too large to inspect (120 KB limit)');
      const bytes = git(['cat-file', 'blob', oid], 120_001);
      if (bytes.includes(0)) throw Error('Source is binary');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
      const selected = text.slice(start - 1, start - 1 + lines);
      let output = selected.map((line, i) => `${start + i}: ${line}`).join('\n');
      if (output.length > 16_000) output = output.slice(0, 16_000) + '\n... output truncated; narrow line range';
      return result(`${path} (${text.length} lines at captured endpoint):\n${output}`);
    },
  });
}
