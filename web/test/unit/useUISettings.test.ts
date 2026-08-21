// useUISettings 纯函数部分单测(球球 review 2026-08-15 改 localStorage)
// - applyUISettingsToCSS 设置 --ui-* CSS variables
// - RANGES 边界正确
// 注:hook 部分(useUISettings())需要 React testing 框架,这一轮不测
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyUISettingsToCSS, RANGES } from '../../src/hooks/useUISettings.js';

let origDocument: any;
let setPropCalls: Array<{ prop: string; value: string }>;

beforeEach(() => {
  setPropCalls = [];
  // mock document.documentElement.style
  origDocument = (globalThis as any).document;
  (globalThis as any).document = {
    documentElement: {
      style: {
        setProperty(prop: string, value: string) {
          setPropCalls.push({ prop, value });
        },
      },
    },
  };
});

afterEach(() => {
  (globalThis as any).document = origDocument;
});

test('applyUISettingsToCSS — density 1.0 基准值,所有 height/padding 正确缩放', () => {
  applyUISettingsToCSS({ density: 1.0, fontSize: 14, radius: 4 });
  const map = Object.fromEntries(setPropCalls.map(c => [c.prop, c.value]));
  // BASE 乘 1.0 = BASE
  assert.equal(map['--ui-sidebar-item-h'], '40px');
  assert.equal(map['--ui-sidebar-gap'], '2px');
  assert.equal(map['--ui-control-h-sm'], '30px');
  assert.equal(map['--ui-control-h-md'], '36px');
  assert.equal(map['--ui-control-h-input'], '38px');
  assert.equal(map['--ui-control-h-input-sm'], '32px');
  assert.equal(map['--ui-page-pad-y'], '24px');
  assert.equal(map['--ui-font-size'], '14px');
  assert.equal(map['--ui-radius'], '4px');
});

test('applyUISettingsToCSS — density 0.5(紧凑)所有高度减半', () => {
  applyUISettingsToCSS({ density: 0.5, fontSize: 14, radius: 4 });
  const map = Object.fromEntries(setPropCalls.map(c => [c.prop, c.value]));
  assert.equal(map['--ui-sidebar-item-h'], '20px');  // 40 * 0.5
  assert.equal(map['--ui-control-h-md'], '18px');    // 36 * 0.5
  assert.equal(map['--ui-page-pad-y'], '12px');      // 24 * 0.5
});

test('applyUISettingsToCSS — density 2.0(宽松)所有高度翻倍', () => {
  applyUISettingsToCSS({ density: 2.0, fontSize: 14, radius: 4 });
  const map = Object.fromEntries(setPropCalls.map(c => [c.prop, c.value]));
  assert.equal(map['--ui-sidebar-item-h'], '80px');
  assert.equal(map['--ui-control-h-md'], '72px');
});

test('applyUISettingsToCSS — fontSize 直接用(不乘 density)', () => {
  applyUISettingsToCSS({ density: 1.5, fontSize: 18, radius: 12 });
  const map = Object.fromEntries(setPropCalls.map(c => [c.prop, c.value]));
  assert.equal(map['--ui-font-size'], '18px');
  assert.equal(map['--ui-radius'], '12px');
});

test('RANGES 边界正确', () => {
  assert.equal(RANGES.density.min, 0.5);
  assert.equal(RANGES.density.max, 2.0);
  assert.equal(RANGES.fontSize.min, 10);
  assert.equal(RANGES.fontSize.max, 26);
  assert.equal(RANGES.radius.min, 0);
  assert.equal(RANGES.radius.max, 24);
});

test('applyUISettingsToCSS — 没 document 时不抛(SSR 安全)', () => {
  (globalThis as any).document = undefined;
  // 不应 throw
  assert.doesNotThrow(() => applyUISettingsToCSS({ density: 1.0, fontSize: 14, radius: 4 }));
});
