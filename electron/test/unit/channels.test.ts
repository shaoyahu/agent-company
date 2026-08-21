import test from 'node:test';
import assert from 'node:assert/strict';
import { IPC_CHANNELS } from '../../src/channels.js';

test('IPC channel 集合与名称保持固定', () => {
  assert.deepEqual(IPC_CHANNELS, {
    getServerOrigin: 'desktop:get-server-origin',
    selectProjectDirectory: 'desktop:select-project-directory',
    openExternal: 'desktop:open-external',
    getAppInfo: 'desktop:get-app-info',
  });
});

test('IPC channel 名称不重复', () => {
  const channels = Object.values(IPC_CHANNELS);
  assert.equal(new Set(channels).size, channels.length);
});
