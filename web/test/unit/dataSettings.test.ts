import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(
  new URL('../../src/components/SettingsView.tsx', import.meta.url),
  'utf8',
);
const dataSettingsSource = readFileSync(
  new URL('../../src/components/settings/DataSettings.tsx', import.meta.url),
  'utf8',
);

test('设置页包含数据 tab 并渲染 DataSettings', () => {
  assert.match(settingsSource, /id:\s*'data'/);
  assert.match(settingsSource, /label:\s*'数据'/);
  assert.match(settingsSource, /<DataSettings \/>/);
});

test('DataSettings 使用数据管理 API 且危险操作有确认', () => {
  assert.match(dataSettingsSource, /api\.exportData\(\)/);
  assert.match(dataSettingsSource, /api\.importData/);
  assert.match(dataSettingsSource, /api\.resetData\(\)/);
  assert.match(dataSettingsSource, /window\.confirm/);
  assert.match(dataSettingsSource, /一键还原/);
  assert.match(dataSettingsSource, /导出数据/);
  assert.match(dataSettingsSource, /导入数据/);
});
