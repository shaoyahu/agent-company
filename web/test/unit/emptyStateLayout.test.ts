import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../src/components/ui/EmptyState.tsx', import.meta.url), 'utf8');

test('EmptyState 图标和文字作为一个整体居中排列', () => {
  assert.match(source, /display:\s*'flex'/);
  assert.match(source, /justifyContent:\s*'center'/);
  assert.match(source, /display:\s*'inline-flex'/);
  assert.match(source, /alignItems:\s*'center'/);
});
