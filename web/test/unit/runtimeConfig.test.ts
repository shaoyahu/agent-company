import test from 'node:test';
import assert from 'node:assert/strict';

type RuntimeModule = typeof import('../../src/runtime/runtimeConfig.ts');

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
let moduleSequence = 0;

function restoreGlobal(name: 'window' | 'location', descriptor?: PropertyDescriptor): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete (globalThis as Record<string, unknown>)[name];
  }
}

function setRuntimeGlobals(origin: string, bridge?: unknown): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: bridge === undefined ? {} : { agentCompanyDesktop: bridge },
  });
}

async function loadRuntimeModule(label: string): Promise<RuntimeModule> {
  moduleSequence += 1;
  return import(`../../src/runtime/runtimeConfig.ts?${label}-${moduleSequence}`);
}

function validBridge(getServerOrigin: () => Promise<unknown>) {
  return {
    isElectron: true,
    getServerOrigin,
    async selectProjectDirectory() {
      return { canceled: true as const };
    },
    async openExternal() {},
    async getAppInfo() {
      return { version: '1.0.0', platform: 'darwin' as const };
    },
  };
}

test.after(() => {
  restoreGlobal('window', originalWindow);
  restoreGlobal('location', originalLocation);
});

test('bridge 缺失时使用浏览器运行时配置', async () => {
  setRuntimeGlobals('http://localhost:5173');
  const { getRuntimeConfig } = await loadRuntimeModule('browser');

  assert.deepEqual(await getRuntimeConfig(), {
    apiOrigin: '',
    wsOrigin: 'http://localhost:5173',
    desktop: false,
  });
});

test('Electron origin 去除尾斜杠并生成 REST/WS 地址', async () => {
  setRuntimeGlobals(
    'http://localhost:5173',
    validBridge(async () => 'https://127.0.0.1:43210///'),
  );
  const { getRuntimeConfig, apiUrl, wsUrl } = await loadRuntimeModule('electron');

  assert.deepEqual(await getRuntimeConfig(), {
    apiOrigin: 'https://127.0.0.1:43210',
    wsOrigin: 'wss://127.0.0.1:43210',
    desktop: true,
  });
  assert.equal(apiUrl('/projects'), 'https://127.0.0.1:43210/api/projects');
  assert.equal(apiUrl('projects'), 'https://127.0.0.1:43210/api/projects');
  assert.equal(wsUrl('/ws'), 'wss://127.0.0.1:43210/ws');
  assert.equal(wsUrl(), 'wss://127.0.0.1:43210/ws');
});

test('浏览器 URL helper 保留 Vite proxy 相对 REST 地址并转换 WS 协议', async () => {
  setRuntimeGlobals('https://example.test:5173');
  const { getRuntimeConfig, apiUrl, wsUrl } = await loadRuntimeModule('browser-urls');

  await getRuntimeConfig();

  assert.equal(apiUrl('/company'), '/api/company');
  assert.equal(apiUrl('company'), '/api/company');
  assert.equal(wsUrl('/ws'), 'wss://example.test:5173/ws');
});

test('运行时配置异步初始化结果会被缓存', async () => {
  let calls = 0;
  setRuntimeGlobals(
    'http://localhost:5173',
    validBridge(async () => {
      calls += 1;
      return 'http://127.0.0.1:40123';
    }),
  );
  const { getRuntimeConfig } = await loadRuntimeModule('cached');

  const [first, second] = await Promise.all([getRuntimeConfig(), getRuntimeConfig()]);
  const third = await getRuntimeConfig();

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(second, third);
});

test('结构不合法的 bridge 均安全回退浏览器模式', async () => {
  const invalidBridges: unknown[] = [
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    {},
    { isElectron: false },
    { isElectron: true },
    {
      ...validBridge(async () => 'http://127.0.0.1:4000'),
      openExternal: 'not-a-function',
    },
  ];

  for (const [index, bridge] of invalidBridges.entries()) {
    setRuntimeGlobals('http://localhost:5173', bridge);
    const { getRuntimeConfig } = await loadRuntimeModule(`invalid-bridge-${index}`);
    assert.deepEqual(await getRuntimeConfig(), {
      apiOrigin: '',
      wsOrigin: 'http://localhost:5173',
      desktop: false,
    });
  }
});

test('非法 Electron origin 均安全回退浏览器模式', async () => {
  const invalidOrigins: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'not-a-url',
    'ftp://127.0.0.1:4000',
    'ws://127.0.0.1:4000',
    'javascript:alert(1)',
  ];

  for (const [index, origin] of invalidOrigins.entries()) {
    setRuntimeGlobals(
      'http://localhost:5173',
      validBridge(async () => origin),
    );
    const { getRuntimeConfig } = await loadRuntimeModule(`invalid-origin-${index}`);
    assert.deepEqual(await getRuntimeConfig(), {
      apiOrigin: '',
      wsOrigin: 'http://localhost:5173',
      desktop: false,
    });
  }
});

test('bridge 调用异常时安全回退浏览器模式', async () => {
  setRuntimeGlobals(
    'http://localhost:5173',
    validBridge(async () => {
      throw new Error('测试 bridge 调用失败');
    }),
  );
  const { getRuntimeConfig } = await loadRuntimeModule('bridge-error');

  assert.deepEqual(await getRuntimeConfig(), {
    apiOrigin: '',
    wsOrigin: 'http://localhost:5173',
    desktop: false,
  });
});

test('URL helper 对 hostile path 不抛错并统一前导斜杠', async () => {
  setRuntimeGlobals('http://localhost:5173');
  const { getRuntimeConfig, apiUrl, wsUrl } = await loadRuntimeModule('hostile-path');
  await getRuntimeConfig();

  const cases: Array<[unknown, string, string]> = [
    [undefined, '', 'ws'],
    [null, '', ''],
    ['', '', ''],
    ['   ', '   ', '   '],
    ['__proto__', '__proto__', '__proto__'],
    ['constructor', 'constructor', 'constructor'],
    ['///projects', 'projects', 'projects'],
  ];

  for (const [input, normalizedApi, normalizedWs] of cases) {
    const apiPath = normalizedApi ? `/api/${normalizedApi}` : '/api';
    const wsPath = normalizedWs ? `/${normalizedWs}` : '/';
    assert.equal(apiUrl(input as string), apiPath);
    assert.equal(wsUrl(input as string), `ws://localhost:5173${wsPath}`);
  }
});

test('URL helper 拒绝原始或解码后的点段与反斜杠路径', async () => {
  setRuntimeGlobals('http://localhost:5173');
  const { getRuntimeConfig, apiUrl, wsUrl } = await loadRuntimeModule('unsafe-path');
  await getRuntimeConfig();

  const unsafePaths = [
    '../admin',
    './admin',
    '/safe/../admin',
    '%2e%2e/admin',
    '%2E/admin',
    '.%2e/admin',
    '.%2E/admin',
    '%2e./admin',
    '%2E./admin',
    '%2e%2e%2fadmin',
    '..\\admin',
    'safe\\admin',
    'safe%5cadmin',
  ];

  for (const path of unsafePaths) {
    assert.doesNotThrow(() => apiUrl(path));
    assert.doesNotThrow(() => wsUrl(path));
    assert.equal(apiUrl(path), '/api');
    assert.equal(wsUrl(path), 'ws://localhost:5173/');
  }
});

test('URL helper 拒绝 pathname 原始或解码后的 ASCII 控制字符', async () => {
  setRuntimeGlobals('http://localhost:5173');
  const { getRuntimeConfig, apiUrl, wsUrl } = await loadRuntimeModule('control-path');
  await getRuntimeConfig();

  const controlCodes = [
    ...Array.from({ length: 0x20 }, (_, index) => index),
    0x7f,
  ];
  const unsafePaths = [
    '.\t./admin',
    '.\n./admin',
    '.\r./admin',
    ...controlCodes.flatMap((code) => {
      const rawControl = String.fromCharCode(code);
      const encodedControl = `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
      return [`safe${rawControl}path`, `safe${encodedControl}path`];
    }),
  ];

  for (const path of unsafePaths) {
    assert.equal(apiUrl(path), '/api');
    assert.equal(wsUrl(path), 'ws://localhost:5173/');
  }
});

test('URL helper 保留可信内部路径的 query 与 fragment', async () => {
  setRuntimeGlobals('https://example.test:5173');
  const { getRuntimeConfig, apiUrl, wsUrl } = await loadRuntimeModule('query-fragment');
  await getRuntimeConfig();

  assert.equal(
    apiUrl('/projects?next=../admin&filter=a%5Cb#active'),
    '/api/projects?next=../admin&filter=a%5Cb#active',
  );
  assert.equal(
    wsUrl('/ws?token=a%2Fb#channel'),
    'wss://example.test:5173/ws?token=a%2Fb#channel',
  );
  assert.equal(
    apiUrl('/projects?next=.\t./admin#value=.\n./admin'),
    '/api/projects?next=.\t./admin#value=.\n./admin',
  );
});
