import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../src/features/workflows/NodeInputSelector.tsx', import.meta.url),
  'utf8',
);

test('接收信息选择器使用 Portal、非透明菜单和 Esc 关闭', () => {
  assert.match(source, /createPortal\(.*document\.body/s);
  assert.match(source, /background:\s*['"]var\(--surface-1\)['"]/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /pointerdown/);
});
