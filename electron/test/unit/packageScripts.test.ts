import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('根 build:electron 依次构建 Server、Web、Electron', () => {
  const packageUrl = new URL('../../../package.json', import.meta.url);
  let packageJson: {
    scripts?: Record<string, string>;
  };
  try {
    packageJson = JSON.parse(readFileSync(packageUrl, 'utf8')) as {
      scripts?: Record<string, string>;
    };
  } catch (error) {
    assert.fail(`无法读取根 package.json: ${String(error)}`);
  }

  assert.equal(
    packageJson.scripts?.['build:electron'],
    'npm run build -w server && npm run build -w web && npm run build -w electron',
  );
});

test('根 dev:electron 同时监听 Server 构建避免 Electron 后端旧代码', () => {
  const packageUrl = new URL('../../../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageUrl, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(
    packageJson.scripts?.['dev:server-for-electron'] ?? '',
    /npm run build -w server -- --watch/,
  );
  assert.match(
    packageJson.scripts?.['dev:electron'] ?? '',
    /npm run dev:server-for-electron/,
  );
  assert.match(
    packageJson.scripts?.['dev:electron'] ?? '',
    /wait-on file:server\/dist\/bootstrap\.js/,
  );
});

test('Electron Main 构建包含所有非 bundle 运行时模块', () => {
  const packageUrl = new URL('../../package.json', import.meta.url);
  let packageJson: {
    scripts?: Record<string, string>;
  };
  try {
    packageJson = JSON.parse(readFileSync(packageUrl, 'utf8')) as {
      scripts?: Record<string, string>;
    };
  } catch (error) {
    assert.fail(`无法读取 Electron package.json: ${String(error)}`);
  }

  const buildMain = packageJson.scripts?.['build:main'] ?? '';
  for (const entry of [
    'src/main.ts',
    'src/channels.ts',
    'src/ipcHandlers.ts',
    'src/lifecycle.ts',
    'src/security.ts',
    'src/serverHost.ts',
  ]) {
    assert.match(buildMain, new RegExp(`\\b${entry.replace('.', '\\.')}\\b`));
  }
});

test('E2E 与 macOS 打包复用同一 ABI restore 和信号控制抽象', () => {
  for (const script of ['test-e2e.mjs', 'package-mac.mjs']) {
    const source = readFileSync(
      new URL(`../../scripts/${script}`, import.meta.url),
      'utf8',
    );
    assert.match(
      source,
      /from ['"]\.\/abi-restore\.mjs['"]/,
      `${script} 必须复用 abi-restore.mjs`,
    );
  }
});
