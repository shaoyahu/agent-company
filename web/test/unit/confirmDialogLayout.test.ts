import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modalSource = readFileSync(new URL('../../src/components/ui/Modal.tsx', import.meta.url), 'utf8');
const confirmSource = readFileSync(new URL('../../src/components/ui/useConfirm.tsx', import.meta.url), 'utf8');

test('Modal 支持 auto 高度,用于短内容二次确认弹窗', () => {
  assert.match(modalSource, /'auto'/);
  assert.match(modalSource, /isAutoHeight/);
  assert.match(modalSource, /height: isAutoHeight \? 'auto'/);
  assert.match(modalSource, /minHeight: isAutoHeight \? undefined : 280/);
});

test('useConfirm 二次确认弹窗使用 auto 高度,不套用 sm 固定高弹窗', () => {
  assert.match(confirmSource, /height="auto"/);
  assert.match(confirmSource, /size="sm"/);
});
