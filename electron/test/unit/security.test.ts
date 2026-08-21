import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedExternalUrl,
  assertDarwin,
  assertTrustedIpcSender,
  classifyRendererNavigation,
  installRendererNavigationGuards,
  isTrustedRendererUrl,
  projectDirectoryDialogOptions,
  resolveRendererTarget,
  secureWebPreferences,
  withDesktopExecutablePaths,
} from '../../src/security.js';

test('BrowserWindow 使用固定安全配置', () => {
  assert.deepEqual(secureWebPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
});

test('平台守卫只允许 darwin', () => {
  assert.doesNotThrow(() => assertDarwin('darwin'));

  const invalidPlatforms: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'linux',
    'win32',
  ];
  for (const platform of invalidPlatforms) {
    assert.throws(
      () => assertDarwin(platform),
      /首版桌面应用仅支持 macOS/,
    );
  }
});

test('外链只允许 http 和 https 协议', () => {
  assert.equal(
    assertAllowedExternalUrl('https://example.com/path?q=1'),
    'https://example.com/path?q=1',
  );
  assert.equal(
    assertAllowedExternalUrl('http://127.0.0.1:4000/status'),
    'http://127.0.0.1:4000/status',
  );

  const invalidUrls: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'not-a-url',
    'file:///tmp/test',
    'javascript:alert(1)',
    'ftp://example.com/file',
  ];
  for (const url of invalidUrls) {
    assert.throws(
      () => assertAllowedExternalUrl(url),
      /仅允许打开 http: 或 https: 外链/,
    );
  }
});

test('Finder 目录选择固定允许选择和创建目录', () => {
  assert.deepEqual(projectDirectoryDialogOptions, {
    properties: ['openDirectory', 'createDirectory'],
  });
});

test('PATH 补充桌面常用目录并保持去重', () => {
  assert.equal(
    withDesktopExecutablePaths(
      '/usr/bin:/opt/homebrew/bin:/Users/test/.bun/bin',
      '/Users/test',
    ),
    [
      '/usr/bin',
      '/opt/homebrew/bin',
      '/Users/test/.bun/bin',
      '/usr/local/bin',
      '/Users/test/.local/bin',
    ].join(':'),
  );
});

test('PATH 为空时仍生成完整桌面命令目录', () => {
  assert.equal(
    withDesktopExecutablePaths(undefined, '/Users/test'),
    [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/test/.local/bin',
      '/Users/test/.bun/bin',
    ].join(':'),
  );
});

test('非打包模式只接受无凭据的 loopback http renderer URL', () => {
  const localIndexPath = '/Applications/Agent Company/web/dist/index.html';
  const validUrls = [
    'http://localhost:5173',
    'http://127.0.0.1:5173/agents',
    'http://[::1]:5173/?mode=desktop',
  ];

  for (const rendererUrl of validUrls) {
    const target = resolveRendererTarget(false, rendererUrl, localIndexPath);
    assert.equal(target.kind, 'url');
    assert.equal(target.url, new URL(rendererUrl).href);
  }

  const invalidUrls: unknown[] = [
    null,
    '__proto__',
    'constructor',
    'not-a-url',
    'https://localhost:5173',
    'file:///tmp/index.html',
    'http://example.com',
    'http://localhost.example.com',
    'http://127.0.0.2:5173',
    'http://127.1:5173',
    'http://user:password@localhost:5173',
    'http://[::ffff:127.0.0.1]:5173',
  ];
  for (const rendererUrl of invalidUrls) {
    assert.throws(
      () => resolveRendererTarget(false, rendererUrl, localIndexPath),
      /开发模式渲染器地址仅允许无凭据的本机 http URL/,
    );
  }
});

test('renderer URL 缺失时使用本地文件，打包模式始终忽略环境变量', () => {
  const localIndexPath = '/Applications/Agent Company/web/dist/index.html';

  for (const rendererUrl of [undefined, '', '   ']) {
    assert.deepEqual(
      resolveRendererTarget(false, rendererUrl, localIndexPath),
      {
        kind: 'file',
        filePath: localIndexPath,
        rootPath: '/Applications/Agent Company/web/dist',
        url: 'file:///Applications/Agent%20Company/web/dist/index.html',
      },
    );
  }

  assert.deepEqual(
    resolveRendererTarget(
      true,
      'https://attacker.example/renderer',
      localIndexPath,
    ),
    {
      kind: 'file',
      filePath: localIndexPath,
      rootPath: '/Applications/Agent Company/web/dist',
      url: 'file:///Applications/Agent%20Company/web/dist/index.html',
    },
  );
});

test('可信 renderer URL 只包含已确定 target 的内部地址', () => {
  const urlTarget = resolveRendererTarget(
    false,
    'http://localhost:5173',
    '/Applications/Agent Company/web/dist/index.html',
  );
  assert.equal(
    isTrustedRendererUrl('http://localhost:5173/project/abc', urlTarget),
    true,
  );
  assert.equal(
    isTrustedRendererUrl('http://localhost:5174/project/abc', urlTarget),
    false,
  );
  assert.equal(
    isTrustedRendererUrl('http://user@localhost:5173/project/abc', urlTarget),
    false,
  );

  const fileTarget = resolveRendererTarget(
    true,
    undefined,
    '/Applications/Agent Company/web/dist/index.html',
  );
  assert.equal(
    isTrustedRendererUrl(
      'file:///Applications/Agent%20Company/web/dist/assets/app.js',
      fileTarget,
    ),
    true,
  );
  const invalidUrls: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'file:///Applications/Agent%20Company/web/secret.html',
    'https://example.com',
  ];
  for (const url of invalidUrls) {
    assert.equal(isTrustedRendererUrl(url, fileTarget), false);
  }
});

test('IPC sender 必须来自当前窗口的可信主 frame', () => {
  const target = resolveRendererTarget(
    false,
    'http://localhost:5173',
    '/Applications/Agent Company/web/dist/index.html',
  );
  const mainFrame = { url: 'http://localhost:5173/agents' };
  const currentWebContents = { mainFrame };

  assert.doesNotThrow(() => assertTrustedIpcSender(
    { sender: currentWebContents, senderFrame: mainFrame },
    currentWebContents,
    target,
  ));
  assert.throws(
    () => assertTrustedIpcSender(
      { sender: { mainFrame }, senderFrame: mainFrame },
      currentWebContents,
      target,
    ),
    /拒绝来自非当前窗口的 IPC 请求/,
  );
  assert.throws(
    () => assertTrustedIpcSender(
      {
        sender: currentWebContents,
        senderFrame: { url: 'http://localhost:5173/iframe' },
      },
      currentWebContents,
      target,
    ),
    /仅允许主页面发送 IPC 请求/,
  );

  const untrustedFrame = { url: 'https://attacker.example' };
  const untrustedWebContents = { mainFrame: untrustedFrame };
  assert.throws(
    () => assertTrustedIpcSender(
      { sender: untrustedWebContents, senderFrame: untrustedFrame },
      untrustedWebContents,
      target,
    ),
    /拒绝来自不可信页面的 IPC 请求/,
  );
  assert.throws(
    () => assertTrustedIpcSender(
      { sender: currentWebContents, senderFrame: mainFrame },
      null,
      target,
    ),
    /拒绝来自非当前窗口的 IPC 请求/,
  );
});

test('页面导航和重定向共用可信 target 决策', () => {
  const target = resolveRendererTarget(
    false,
    'http://localhost:5173',
    '/Applications/Agent Company/web/dist/index.html',
  );

  assert.deepEqual(
    classifyRendererNavigation('http://localhost:5173/project/abc', target),
    { action: 'allow' },
  );
  assert.deepEqual(
    classifyRendererNavigation('https://example.com/docs', target),
    { action: 'open-external', url: 'https://example.com/docs' },
  );
  assert.deepEqual(
    classifyRendererNavigation('http://example.com/', target),
    { action: 'open-external', url: 'http://example.com/' },
  );

  const deniedUrls: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'not-a-url',
    'file:///tmp/secret',
    'javascript:alert(1)',
    'mailto:test@example.com',
  ];
  for (const url of deniedUrls) {
    assert.deepEqual(
      classifyRendererNavigation(url, target),
      { action: 'deny' },
    );
  }
});

test('窗口同时安装 navigation、redirect 与 window.open 守卫', () => {
  const target = resolveRendererTarget(
    false,
    'http://localhost:5173',
    '/Applications/Agent Company/web/dist/index.html',
  );
  const listeners = new Map<string, (event: {
    preventDefault(): void;
  }, url: string) => void>();
  const windowOpenHandlers: Array<(details: { url: string }) => {
    action: 'deny';
  }> = [];
  const openedUrls: string[] = [];

  installRendererNavigationGuards(
    {
      on(eventName, listener) {
        listeners.set(eventName, listener);
      },
      setWindowOpenHandler(handler) {
        windowOpenHandlers.push(handler);
      },
    },
    target,
    (url) => openedUrls.push(url),
  );

  assert.strictEqual(
    listeners.get('will-navigate'),
    listeners.get('will-redirect'),
  );

  let prevented = false;
  listeners.get('will-navigate')?.(
    { preventDefault: () => { prevented = true; } },
    'http://localhost:5173/agents',
  );
  assert.equal(prevented, false);

  listeners.get('will-redirect')?.(
    { preventDefault: () => { prevented = true; } },
    'https://example.com/docs',
  );
  assert.equal(prevented, true);
  assert.deepEqual(openedUrls, ['https://example.com/docs']);

  prevented = false;
  listeners.get('will-navigate')?.(
    { preventDefault: () => { prevented = true; } },
    'file:///tmp/secret',
  );
  assert.equal(prevented, true);
  assert.deepEqual(openedUrls, ['https://example.com/docs']);

  const windowOpenHandler = windowOpenHandlers[0];
  assert.ok(windowOpenHandler);
  assert.deepEqual(
    windowOpenHandler({ url: 'https://example.com/help' }),
    { action: 'deny' },
  );
  assert.deepEqual(openedUrls, [
    'https://example.com/docs',
    'https://example.com/help',
  ]);
});
