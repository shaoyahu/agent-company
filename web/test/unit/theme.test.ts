import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME,
  THEMES,
  resolveTheme,
} from '../../src/theme/themes.ts';
import {
  applyTheme,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from '../../src/theme/applyTheme.ts';

test('主题列表包含三套已确认主题', () => {
  assert.deepEqual(THEMES.map((theme) => theme.id), [
    'console',
    'workspace',
    'terminal',
  ]);
});

test('resolveTheme 对合法主题原样返回', () => {
  assert.equal(resolveTheme('console'), 'console');
  assert.equal(resolveTheme('workspace'), 'workspace');
  assert.equal(resolveTheme('terminal'), 'terminal');
});

test('resolveTheme 对 hostile input 回退默认主题', () => {
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'prototype',
    'unknown',
    1,
  ]) {
    assert.equal(resolveTheme(value), DEFAULT_THEME);
  }
});

test('readStoredTheme 读取并校验 localStorage', () => {
  const storage = {
    getItem(key: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      return 'workspace';
    },
  } as Storage;

  assert.equal(readStoredTheme(storage), 'workspace');
});

test('readStoredTheme 在存储异常时回退默认主题', () => {
  const storage = {
    getItem() {
      throw new Error('denied');
    },
  } as unknown as Storage;

  assert.equal(readStoredTheme(storage), DEFAULT_THEME);
});

test('applyTheme 同步根节点并持久化', () => {
  const root = { dataset: {} } as HTMLElement;
  const writes: Array<[string, string]> = [];
  const storage = {
    setItem(key: string, value: string) {
      writes.push([key, value]);
    },
  } as Storage;

  assert.equal(applyTheme('terminal', root, storage), 'terminal');
  assert.equal(root.dataset.theme, 'terminal');
  assert.equal(root.dataset.acTheme, 'terminal');
  assert.deepEqual(writes, [[THEME_STORAGE_KEY, 'terminal']]);
});

test('applyTheme 对非法值和存储写入异常保持可用', () => {
  const root = { dataset: {} } as HTMLElement;
  const storage = {
    setItem() {
      throw new Error('denied');
    },
  } as unknown as Storage;

  assert.doesNotThrow(() => applyTheme('__proto__', root, storage));
  assert.equal(root.dataset.theme, DEFAULT_THEME);
});
