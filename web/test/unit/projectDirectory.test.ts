import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseProjectDirectory } from '../../src/features/dashboard/projectDirectory.js';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = globalThis.fetch;

function installWindow(value: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value,
  });
}

function desktopBridge(
  selection: { canceled: true } | { canceled: false; path: string },
): Record<string, unknown> {
  return {
    isElectron: true,
    getServerOrigin: async () => 'http://127.0.0.1:4000',
    selectProjectDirectory: async () => selection,
    openExternal: async () => {},
    getAppInfo: async () => ({ version: '0.1.0', platform: 'darwin' }),
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('Electron 使用 preload bridge 返回 Finder 选择的绝对目录', async () => {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  installWindow({
    agentCompanyDesktop: desktopBridge({
      canceled: false,
      path: '/Users/test/code/../code/agent-company',
    }),
  });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: String(init?.body ?? ''),
    });
    return new Response(JSON.stringify({
      path: '/Users/test/code/agent-company',
      exists: true,
      writable: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  assert.deepEqual(
    await chooseProjectDirectory('/Users/test/current'),
    { changed: true, path: '/Users/test/code/agent-company' },
  );
  assert.deepEqual(calls, [{
    url: '/api/fs/validate-dir',
    method: 'POST',
    body: JSON.stringify({ path: '/Users/test/code/../code/agent-company' }),
  }]);
});

test('Electron 取消选择时保留当前目录', async () => {
  installWindow({
    agentCompanyDesktop: desktopBridge({ canceled: true }),
  });

  assert.deepEqual(
    await chooseProjectDirectory('/Users/test/current'),
    { changed: false, path: '/Users/test/current' },
  );
});

test('Electron 拒绝 bridge 返回的空值、hostile input 和相对路径', async () => {
  for (const path of [null, undefined, '', '   ', '__proto__', 'constructor', 'relative/path']) {
    installWindow({
      agentCompanyDesktop: desktopBridge({ canceled: false, path: path as string }),
    });
    await assert.rejects(
      chooseProjectDirectory('/Users/test/current'),
      /Finder 未返回有效的绝对目录/,
    );
  }
});

test('Electron 拒绝 Server 判定为不可写的目录', async () => {
  installWindow({
    agentCompanyDesktop: desktopBridge({
      canceled: false,
      path: '/Users/test/read-only',
    }),
  });
  globalThis.fetch = (async () => new Response(JSON.stringify({
    path: '/Users/test/read-only',
    exists: true,
    writable: false,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof globalThis.fetch;

  await assert.rejects(
    chooseProjectDirectory('/Users/test/current'),
    /项目目录不可写/,
  );
});

test('浏览器手工输入绝对路径后交给 Server 校验并使用规范路径', async () => {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  installWindow({
    prompt: () => '/Users/test/code/../code/project',
  });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: String(init?.body ?? ''),
    });
    return new Response(JSON.stringify({
      path: '/Users/test/code/project',
      exists: true,
      writable: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  assert.deepEqual(
    await chooseProjectDirectory('/Users/test/current'),
    { changed: true, path: '/Users/test/code/project' },
  );
  assert.deepEqual(calls, [{
    url: '/api/fs/validate-dir',
    method: 'POST',
    body: JSON.stringify({ path: '/Users/test/code/../code/project' }),
  }]);
});

test('浏览器拒绝 Server 判定为不可写的目录', async () => {
  installWindow({
    prompt: () => '/Users/test/read-only',
  });
  globalThis.fetch = (async () => new Response(JSON.stringify({
    path: '/Users/test/read-only',
    exists: true,
    writable: false,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof globalThis.fetch;

  await assert.rejects(
    chooseProjectDirectory('/Users/test/current'),
    /项目目录不可写/,
  );
});

test('浏览器取消或输入空白时保留当前目录且不请求 Server', async () => {
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error('不应请求 Server');
  }) as typeof globalThis.fetch;

  for (const input of [null, undefined, '', '   ']) {
    installWindow({ prompt: () => input });
    assert.deepEqual(
      await chooseProjectDirectory('/Users/test/current'),
      { changed: false, path: '/Users/test/current' },
    );
  }
  assert.equal(fetchCount, 0);
});

test('浏览器 hostile 或相对路径由 Server 拒绝并透出中文错因', async () => {
  for (const input of ['__proto__', 'constructor', 'relative/path']) {
    installWindow({ prompt: () => input });
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: '项目目录必须是绝对路径',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof globalThis.fetch;

    await assert.rejects(
      chooseProjectDirectory('/Users/test/current'),
      /项目目录必须是绝对路径/,
    );
  }
});
