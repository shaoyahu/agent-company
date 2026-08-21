import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isElectronTestEnvironment,
  resolveTestProjectDirectory,
} from '../../src/testHooks.js';

const hostileValues: unknown[] = [
  undefined,
  null,
  '',
  '   ',
  '__proto__',
  'constructor',
  'relative/path',
  `/${'x'.repeat(4097)}`,
];

test('仅 test 环境接受真实绝对项目目录', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-company-hook-'));
  try {
    assert.equal(
      resolveTestProjectDirectory('test', directory),
      realpathSync(directory),
    );
    assert.equal(
      resolveTestProjectDirectory('production', directory),
      null,
    );
    assert.equal(
      resolveTestProjectDirectory('development', directory),
      null,
    );
    assert.equal(
      resolveTestProjectDirectory(undefined, directory),
      null,
    );
    assert.equal(
      resolveTestProjectDirectory('production', 'relative/path'),
      null,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Playwright 测试环境精确跳过生产单实例锁', () => {
  assert.equal(isElectronTestEnvironment('test'), true);
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'production',
    'development',
    'TEST',
  ]) {
    assert.equal(isElectronTestEnvironment(value), false);
  }
});

test('test 项目目录拒绝 hostile、相对、超长和不存在路径', () => {
  for (const value of hostileValues) {
    assert.throws(
      () => resolveTestProjectDirectory('test', value),
      /测试项目目录/,
      `应拒绝 ${String(value)}`,
    );
  }
  assert.throws(
    () => resolveTestProjectDirectory(
      'test',
      join(tmpdir(), `agent-company-missing-${Date.now()}`),
    ),
    /测试项目目录/,
  );
});
