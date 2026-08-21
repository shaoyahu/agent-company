/**
 * web/test/unit/lookups.test.ts
 *
 * 球球 review 2026-08-16:回归保护 — 任何"key→obj.xxx"查表必须有兜底,
 * 否则 db 后端 schema 变化 / 新增类型会让 React 整页崩。
 * 这套测试锁住所有兜底函数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getToneMeta } from '../../src/components/ui/Toast.js';
import { getTagToneStyle } from '../../src/components/ui/Tag.js';

// =================== getToneMeta (Toast) ===================

test('getToneMeta:已知 tone(info/ok/warn/danger)返对应 meta', () => {
  assert.ok(getToneMeta('info').Icon, 'info 应有 Icon');
  assert.ok(getToneMeta('ok').Icon);
  assert.ok(getToneMeta('warn').Icon);
  assert.ok(getToneMeta('danger').Icon);
  assert.equal(getToneMeta('danger').statusBadge, 'ERROR', 'danger 应有 ERROR 徽章');
});

test('getToneMeta:未知 tone 兜底走 info(不崩)', () => {
  const meta = getToneMeta('bogus-tone');
  assert.ok(meta, '应返兜底 meta');
  assert.ok(meta.Icon, '兜底 meta 应有 Icon');
  // 等价于 info
  assert.equal(meta.color, getToneMeta('info').color);
});

test('getToneMeta:空串 兜底走 info', () => {
  const meta = getToneMeta('');
  assert.ok(meta.Icon);
});

test('getToneMeta:undefined 兜底走 info(球球场景:不存在的 tone 类型)', () => {
  const meta = getToneMeta(undefined as any);
  assert.ok(meta.Icon);
});

test('getToneMeta:meta 含 color/bg/border/icon 字段', () => {
  for (const tone of ['info', 'ok', 'warn', 'danger']) {
    const m = getToneMeta(tone);
    assert.ok(m.color, `${tone} 应有 color`);
    assert.ok(m.bg, `${tone} 应有 bg`);
    assert.ok(m.border, `${tone} 应有 border`);
    assert.ok(m.Icon, `${tone} 应有 Icon`);
  }
});

// =================== getTagToneStyle (Tag) ===================

test('getTagToneStyle:已知 tone 返对应样式', () => {
  for (const tone of ['neutral', 'accent', 'ok', 'warn', 'danger', 'info', 'openai', 'anthropic', 'both', 'mono']) {
    const s = getTagToneStyle(tone);
    assert.ok(s.bg, `${tone} 应有 bg`);
    assert.ok(s.fg, `${tone} 应有 fg`);
    assert.ok(s.border, `${tone} 应有 border`);
  }
});

test('getTagToneStyle:未知 tone 兜底走 neutral(不崩)', () => {
  const s = getTagToneStyle('made-up');
  assert.ok(s.bg);
  assert.ok(s.fg);
  assert.ok(s.border);
  // 等价于 neutral
  assert.equal(s.bg, getTagToneStyle('neutral').bg);
  assert.equal(s.fg, getTagToneStyle('neutral').fg);
});

test('getTagToneStyle:空串 兜底走 neutral', () => {
  const s = getTagToneStyle('');
  assert.ok(s.bg);
});

test('getTagToneStyle:undefined 兜底走 neutral', () => {
  const s = getTagToneStyle(undefined as any);
  assert.ok(s.bg);
});

// =================== 回归保护:以前 TYPE_META[t.type] 让 .icon 崩了 ===================
// 类似的查表模式(getPlatformLabel / getToneMeta / getTagToneStyle)都不应崩
test('所有 get* 兜底函数对任意输入都不抛', () => {
  const inputs = [undefined, null, '', 'unknown', '   ', '__proto__', 'constructor'];
  for (const input of inputs) {
    assert.doesNotThrow(() => getToneMeta(input as any), `getToneMeta(${String(input)}) 不应抛`);
    assert.doesNotThrow(() => getTagToneStyle(input as any), `getTagToneStyle(${String(input)}) 不应抛`);
  }
});
