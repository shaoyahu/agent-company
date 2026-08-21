import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateProjectDir } from '../../src/api/projectDirectory.js';

test('macOS 真实临时目录通过规范化后的 tmp 白名单', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-company-dir-'));
  try {
    assert.deepEqual(
      validateProjectDir(directory),
      { dir: realpathSync(directory) },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('项目目录拒绝 hostile、相对、超长和白名单外路径', () => {
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'relative/path',
    `/${'x'.repeat(4097)}`,
    '/etc',
  ]) {
    const result = validateProjectDir(value);
    assert.ok('error' in result, `应拒绝 ${String(value)}`);
  }
});
