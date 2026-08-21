import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

test('生产启动不得自动写入默认部门或职员', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');

  assert.doesNotMatch(source, /\bseedIfEmpty\b/);
  assert.doesNotMatch(source, /id:\s*['"]frontend-dev['"]/);
});

test('生产启动不得自动注册 CLI 工具', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');

  assert.doesNotMatch(source, /\bensureBuiltinCliTools\b/);
  assert.doesNotMatch(source, /name:\s*['"](?:trae-cli|claude-code)['"]/);
});

test('独立 Server 默认只监听 loopback 且不允许环境变量开启未认证 LAN', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');

  assert.match(source, /host:\s*['"]127\.0\.0\.1['"]/);
  assert.doesNotMatch(source, /process\.env\.HOST/);
  assert.doesNotMatch(source, /['"]0\.0\.0\.0['"]/);
});
