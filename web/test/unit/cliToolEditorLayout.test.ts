import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/settings/ToolsSettings.tsx'),
  'utf8',
);

test('CLI 底层字段默认收进高级配置', () => {
  assert.match(source, /<details/);
  assert.match(source, /高级配置/);
});

test('CLI 测试使用模型列表语义且不要求 input JSON', () => {
  assert.match(source, /type === 'cli' \? '测试模型列表' : '运行'/);
  assert.match(source, /type === 'cli' \? '检测到的模型' : 'output'/);
  assert.match(source, /\{type !== 'cli' && \(\s*<Field label="input \(JSON\)"/);
});
