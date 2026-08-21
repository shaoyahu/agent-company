import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSource = readFileSync(
  new URL('../../src/api/server.ts', import.meta.url),
  'utf8',
);

test('Provider 新增、更新、删除都广播事件,驱动前端全局 company 回读', () => {
  assert.match(serverSource, /broadcast\(\{ type: 'provider_added'/);
  assert.match(serverSource, /broadcast\(\{ type: 'provider_updated'/);
  assert.match(serverSource, /broadcast\(\{ type: 'provider_deleted'/);
});
