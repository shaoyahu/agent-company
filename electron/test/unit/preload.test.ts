import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IPC_CHANNELS } from '../../src/channels.js';
import { createDesktopBridge } from '../../src/preloadBridge.js';

test('preload bridge 只暴露固定 API 并调用精确 channel', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const responses = new Map<string, unknown>([
    [IPC_CHANNELS.getServerOrigin, 'http://127.0.0.1:3000'],
    [
      IPC_CHANNELS.selectProjectDirectory,
      { canceled: false, path: '/Users/test/project' },
    ],
    [IPC_CHANNELS.openExternal, undefined],
    [
      IPC_CHANNELS.getAppInfo,
      { version: '0.1.0', platform: 'darwin' },
    ],
  ]);
  const bridge = createDesktopBridge(async (channel, ...args) => {
    calls.push({ channel, args });
    return responses.get(channel);
  });

  assert.deepEqual(Object.keys(bridge).sort(), [
    'getAppInfo',
    'getServerOrigin',
    'isElectron',
    'openExternal',
    'selectProjectDirectory',
  ]);
  assert.equal(bridge.isElectron, true);
  assert.equal(await bridge.getServerOrigin(), 'http://127.0.0.1:3000');
  assert.deepEqual(
    await bridge.selectProjectDirectory(),
    { canceled: false, path: '/Users/test/project' },
  );
  await bridge.openExternal('https://example.com/docs');
  assert.deepEqual(
    await bridge.getAppInfo(),
    { version: '0.1.0', platform: 'darwin' },
  );
  assert.deepEqual(calls, [
    { channel: IPC_CHANNELS.getServerOrigin, args: [] },
    { channel: IPC_CHANNELS.selectProjectDirectory, args: [] },
    {
      channel: IPC_CHANNELS.openExternal,
      args: ['https://example.com/docs'],
    },
    { channel: IPC_CHANNELS.getAppInfo, args: [] },
  ]);
});

test('preload 源码只向主世界暴露 agentCompanyDesktop', () => {
  const preloadUrl = new URL('../../src/preload.ts', import.meta.url);
  const source = readFileSync(preloadUrl, 'utf8');
  const exposureCalls = source.match(/exposeInMainWorld\s*\(/g) ?? [];

  assert.equal(exposureCalls.length, 1);
  assert.match(
    source,
    /exposeInMainWorld\(\s*['"]agentCompanyDesktop['"]\s*,/,
  );
});
