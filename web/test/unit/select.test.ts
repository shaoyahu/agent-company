import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../src/components/ui/Select.tsx', import.meta.url),
  'utf8',
);

test('统一 Select 使用自定义弹层而非原生 select', () => {
  assert.doesNotMatch(source, /<select\b/);
  assert.doesNotMatch(source, /<option\b/);
  assert.match(source, /createPortal/);
  assert.match(source, /document\.body/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
});

test('统一 Select 支持键盘选择、Esc 关闭和外部点击关闭', () => {
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Escape/);
  assert.match(source, /Enter/);
  assert.match(source, /pointerdown/);
});

test('统一 Select 滚动菜单自身时保持打开，外部滚动时关闭避免错位', () => {
  assert.match(source, /const handleViewportScroll = \(event: Event\) => \{/);
  assert.match(source, /menuRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(source, /window\.addEventListener\('scroll', handleViewportScroll, true\)/);
});

test('统一 Select 保留禁用项、占位项、错误态和最小菜单项高度', () => {
  assert.match(source, /option\.disabled/);
  assert.match(source, /const menuOptions = useMemo/);
  assert.match(source, /\{ value: '', label: placeholder \}/);
  assert.match(source, /errorText/);
  assert.match(source, /minHeight:\s*40/);
});
