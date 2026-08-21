import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ResourceLifecycle,
  handleSecondInstance,
} from '../../src/lifecycle.js';

test('退出会等待启动完成后关闭资源且 close 幂等', async () => {
  let resolveStart!: (resource: { close(): Promise<void> }) => void;
  let closeCount = 0;
  const lifecycle = new ResourceLifecycle<{ close(): Promise<void> }>();
  const startPromise = lifecycle.start(() => new Promise((resolve) => {
    resolveStart = resolve;
  }));

  const firstClose = lifecycle.close();
  const secondClose = lifecycle.close();
  assert.strictEqual(firstClose, secondClose);
  assert.equal(lifecycle.isShuttingDown, true);

  let shutdownFinished = false;
  void firstClose.then(() => {
    shutdownFinished = true;
  });
  await Promise.resolve();
  assert.equal(shutdownFinished, false);

  resolveStart({
    async close() {
      closeCount += 1;
    },
  });

  await startPromise;
  await firstClose;
  assert.equal(closeCount, 1);
  assert.equal(lifecycle.current, null);
  assert.equal(lifecycle.isShuttingDown, true);
  assert.equal(lifecycle.canCreateWindow, false);
});

test('启动失败后 close 仍可完成且保持幂等', async () => {
  const lifecycle = new ResourceLifecycle<{ close(): Promise<void> }>();
  const startError = new Error('启动失败');
  const startPromise = lifecycle.start(async () => {
    throw startError;
  });

  await assert.rejects(startPromise, startError);
  const firstClose = lifecycle.close();
  const secondClose = lifecycle.close();
  assert.strictEqual(firstClose, secondClose);
  await firstClose;
  assert.equal(lifecycle.current, null);
});

test('second-instance 在已有窗口时恢复并聚焦', async () => {
  const calls: string[] = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    focus: () => calls.push('focus'),
  };

  await handleSecondInstance(
    Promise.resolve(),
    () => window,
    async () => {
      calls.push('create');
    },
  );

  assert.deepEqual(calls, ['restore', 'focus']);
});

test('second-instance 无可用窗口时重建窗口', async () => {
  for (const window of [
    null,
    {
      isDestroyed: () => true,
      isMinimized: () => false,
      restore() {},
      focus() {},
    },
  ]) {
    let createCount = 0;
    await handleSecondInstance(
      Promise.resolve(),
      () => window,
      async () => {
        createCount += 1;
      },
    );
    assert.equal(createCount, 1);
  }
});

test('second-instance 等待桌面后端就绪后再读取当前窗口', async () => {
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const calls: string[] = [];
  let currentWindow: {
    isDestroyed(): boolean;
    isMinimized(): boolean;
    restore(): void;
    focus(): void;
  } | null = null;

  const handling = handleSecondInstance(
    ready,
    () => currentWindow,
    async () => {
      calls.push('create');
    },
  );
  await Promise.resolve();
  assert.equal(calls.length, 0);

  currentWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => calls.push('restore'),
    focus: () => calls.push('focus'),
  };
  markReady();
  await handling;

  assert.deepEqual(calls, ['focus']);
});
