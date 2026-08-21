import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip, readZip, assertSafeZipPath } from '../../src/utils/zipArchive.js';

test('createZip/readZip 能读回多个 UTF-8 文件', () => {
  const zip = createZip([
    { path: 'manifest.json', data: '{"ok":true}' },
    { path: 'skills/user/demo/SKILL.md', data: '# demo\n' },
  ]);

  const entries = readZip(zip);
  const byPath = new Map(entries.map((entry) => [entry.path, entry.data.toString('utf8')]));

  assert.equal(byPath.get('manifest.json'), '{"ok":true}');
  assert.equal(byPath.get('skills/user/demo/SKILL.md'), '# demo\n');
});

test('assertSafeZipPath 拒绝 zip-slip 和 Windows 路径', () => {
  for (const bad of ['../x', '/tmp/x', 'skills/../x', 'a\\\\b', '', 'a//b']) {
    assert.throws(() => assertSafeZipPath(bad), /非法备份路径/);
  }
});

test('readZip 拒绝包含非法路径的备份包', () => {
  const zip = createZip([{ path: 'safe.txt', data: 'x' }]);
  const patched = Buffer.from(zip);
  const index = patched.indexOf(Buffer.from('safe.txt'));
  assert.notEqual(index, -1);
  Buffer.from('../x.txt').copy(patched, index);

  assert.throws(() => readZip(patched), /非法备份路径|ZIP/);
});
