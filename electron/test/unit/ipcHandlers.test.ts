import test from 'node:test';
import assert from 'node:assert/strict';
import { IPC_CHANNELS } from '../../src/channels.js';
import { registerTrustedIpcHandlers } from '../../src/ipcHandlers.js';
import { resolveRendererTarget } from '../../src/security.js';

test('四个 IPC handler 使用同一 sender 守卫注册', async () => {
  type Listener = (
    event: { sender: unknown; senderFrame?: unknown },
    ...args: unknown[]
  ) => unknown;
  const handlers = new Map<string, Listener>();
  const mainFrame = { url: 'http://localhost:5173/agents' };
  const currentWebContents = { mainFrame };
  const target = resolveRendererTarget(
    false,
    'http://localhost:5173',
    '/Applications/Agent Company/web/dist/index.html',
  );
  const calls: string[] = [];

  registerTrustedIpcHandlers(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    {
      target,
      getCurrentWebContents: () => currentWebContents,
      getServerOrigin: () => {
        calls.push('origin');
        return 'http://127.0.0.1:3000';
      },
      selectProjectDirectory: async () => {
        calls.push('directory');
        return { canceled: true as const };
      },
      openExternal: async (url) => {
        calls.push(`external:${String(url)}`);
      },
      getAppInfo: () => {
        calls.push('info');
        return { version: '0.1.0', platform: 'darwin' as const };
      },
    },
  );

  assert.deepEqual(
    [...handlers.keys()],
    Object.values(IPC_CHANNELS),
  );

  const trustedEvent = {
    sender: currentWebContents,
    senderFrame: mainFrame,
  };
  assert.equal(
    handlers.get(IPC_CHANNELS.getServerOrigin)?.(trustedEvent),
    'http://127.0.0.1:3000',
  );
  assert.deepEqual(
    await handlers.get(IPC_CHANNELS.selectProjectDirectory)?.(trustedEvent),
    { canceled: true },
  );
  await handlers.get(IPC_CHANNELS.openExternal)?.(
    trustedEvent,
    'https://example.com',
  );
  assert.deepEqual(
    handlers.get(IPC_CHANNELS.getAppInfo)?.(trustedEvent),
    { version: '0.1.0', platform: 'darwin' },
  );
  assert.deepEqual(calls, [
    'origin',
    'directory',
    'external:https://example.com',
    'info',
  ]);

  const untrustedEvent = {
    sender: { mainFrame },
    senderFrame: mainFrame,
  };
  for (const listener of handlers.values()) {
    assert.throws(
      () => listener(untrustedEvent),
      /拒绝来自非当前窗口的 IPC 请求/,
    );
  }
  assert.equal(calls.length, 4);
});
