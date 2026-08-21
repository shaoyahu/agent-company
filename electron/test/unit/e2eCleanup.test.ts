import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupElectronE2E } from '../e2e/e2eCleanup.js';

test('端口释放断言失败时仍删除 testRoot 并保留端口错误', async () => {
  const calls: string[] = [];
  const portError = new Error('端口仍被占用');

  await assert.rejects(
    cleanupElectronE2E({
      async closeElectron() {
        calls.push('close');
      },
      async assertPortReleased() {
        calls.push('port');
        throw portError;
      },
      removeTestRoot() {
        calls.push('remove');
      },
    }),
    (error) => error === portError,
  );
  assert.deepEqual(calls, ['close', 'port', 'remove']);
});

test('无端口时仍关闭 Electron 并删除 testRoot', async () => {
  const calls: string[] = [];
  await cleanupElectronE2E({
    async closeElectron() {
      calls.push('close');
    },
    removeTestRoot() {
      calls.push('remove');
    },
  });
  assert.deepEqual(calls, ['close', 'remove']);
});

test('Electron 关闭单独失败时仍清理并保留关闭错误', async () => {
  const closeError = new Error('Electron 关闭失败');
  let removed = false;
  await assert.rejects(
    cleanupElectronE2E({
      async closeElectron() {
        throw closeError;
      },
      removeTestRoot() {
        removed = true;
      },
    }),
    (error) => error === closeError,
  );
  assert.equal(removed, true);
});

test('目录删除单独失败时保留删除错误', async () => {
  const removeError = new Error('目录删除失败');
  await assert.rejects(
    cleanupElectronE2E({
      async closeElectron() {},
      removeTestRoot() {
        throw removeError;
      },
    }),
    (error) => error === removeError,
  );
});

test('关闭和端口断言同时失败时保留两个原始错误', async () => {
  const closeError = new Error('Electron 关闭失败');
  const portError = new Error('端口仍被占用');
  await assert.rejects(
    cleanupElectronE2E({
      async closeElectron() {
        throw closeError;
      },
      async assertPortReleased() {
        throw portError;
      },
      removeTestRoot() {},
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [closeError, portError]);
      return true;
    },
  );
});

test('关闭和目录删除同时失败时保留两个原始错误', async () => {
  const closeError = new Error('Electron 关闭失败');
  const removeError = new Error('目录删除失败');
  await assert.rejects(
    cleanupElectronE2E({
      async closeElectron() {
        throw closeError;
      },
      removeTestRoot() {
        throw removeError;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [closeError, removeError]);
      return true;
    },
  );
});

test('端口断言和目录删除同时失败时保留两个原始错误', async () => {
  const portError = new Error('端口仍被占用');
  const removeError = new Error('目录删除失败');

  await assert.rejects(
    cleanupElectronE2E({
      async closeElectron() {},
      async assertPortReleased() {
        throw portError;
      },
      removeTestRoot() {
        throw removeError;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [portError, removeError]);
      assert.equal(error.cause, portError);
      return true;
    },
  );
});

test('关闭、端口断言和目录删除同时失败时保留三个原始错误', async () => {
  const closeError = new Error('Electron 关闭失败');
  const portError = new Error('端口仍被占用');
  const removeError = new Error('目录删除失败');

  await assert.rejects(
    cleanupElectronE2E({
      async closeElectron() {
        throw closeError;
      },
      async assertPortReleased() {
        throw portError;
      },
      removeTestRoot() {
        throw removeError;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [closeError, portError, removeError]);
      assert.equal(error.cause, closeError);
      return true;
    },
  );
});
