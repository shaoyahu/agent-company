import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

type BuilderConfig = {
  files?: string[];
  extraResources?: Array<{ from?: string; to?: string }>;
  asarUnpack?: string[];
  npmRebuild?: boolean;
  afterPack?: string;
  mac?: {
    target?: Array<{ target?: string; arch?: string[] }>;
    entitlements?: string;
    entitlementsInherit?: string;
  };
};

type PackageConfig = {
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readJson(relativePath: string): PackageConfig {
  const url = new URL(relativePath, import.meta.url);
  try {
    return JSON.parse(readFileSync(url, 'utf8')) as PackageConfig;
  } catch (error) {
    assert.fail(`无法读取 ${relativePath}: ${String(error)}`);
  }
}

function readBuilderConfig(): BuilderConfig {
  const url = new URL('../../electron-builder.yml', import.meta.url);
  try {
    return load(readFileSync(url, 'utf8')) as BuilderConfig;
  } catch (error) {
    assert.fail(`无法读取 electron-builder.yml: ${String(error)}`);
  }
}

test('electron-builder 只生成 macOS arm64 app 与 dmg', () => {
  const config = readBuilderConfig();
  assert.deepEqual(config.mac?.target, [
    { target: 'dir', arch: ['arm64'] },
    { target: 'dmg', arch: ['arm64'] },
  ]);
});

test('生产包包含 Electron、Server 与 Web 构建产物', () => {
  const config = readBuilderConfig();
  assert.ok(config.files?.includes('dist/**/*'));
  assert.ok(config.files?.includes('assets/icon.png'));
  assert.deepEqual(config.extraResources, [
    { from: '../web/dist', to: 'web/dist' },
  ]);
});

test('Server 发布包只允许 dist 和 package.json', () => {
  const serverPackage = readJson('../../../server/package.json');
  assert.deepEqual(serverPackage.files, ['dist', 'package.json']);
});

test('electron-builder 显式排除 workspace Server 敏感文件', () => {
  const config = readBuilderConfig();
  const files = config.files ?? [];

  for (const forbiddenPath of [
    'src',
    'data',
    'test',
    'company.db',
    'company.db-wal',
    'company.db-shm',
  ]) {
    assert.ok(
      files.some(
        (pattern) => pattern.startsWith('!')
          && pattern.includes('@agent-company/server')
          && pattern.includes(forbiddenPath),
      ),
      `缺少 Server ${forbiddenPath} 的打包排除规则`,
    );
  }
});

test('打包 Server 使用已修复 high advisory 的 Fastify 版本', () => {
  const serverPackage = readJson('../../../server/package.json');
  assert.equal(serverPackage.dependencies?.fastify, '5.12.0');
});

test('生产包重建并解包唯一版本的 better-sqlite3 原生依赖', () => {
  const config = readBuilderConfig();
  const electronPackage = readJson('../../package.json');
  const serverPackage = readJson('../../../server/package.json');

  assert.equal(config.npmRebuild, true);
  assert.ok(
    config.asarUnpack?.some((pattern) => pattern.includes('better-sqlite3')),
  );
  assert.equal(
    electronPackage.dependencies?.['better-sqlite3'],
    '13.0.3',
    'Electron 与 Server 必须使用同一个 better-sqlite3 版本',
  );
  assert.equal(
    serverPackage.dependencies?.['better-sqlite3'],
    '13.0.3',
    'Server 与 Electron 必须使用同一个 better-sqlite3 版本',
  );
  assert.match(
    electronPackage.devDependencies?.electron ?? '',
    /^43\.4\.0$/,
    'Electron 必须固定为 43.4.0，禁止安全降级',
  );
});

test('macOS 包配置使用 entitlements', () => {
  const config = readBuilderConfig();
  assert.equal(config.mac?.entitlements, 'assets/entitlements.mac.plist');
  assert.equal(
    config.mac?.entitlementsInherit,
    'assets/entitlements.mac.plist',
  );
});

test('Electron 运行时显式设置窗口和 Dock 图标', () => {
  const mainSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');

  assert.match(mainSource, /runtimeIconPath/);
  assert.match(mainSource, /assets', 'icon\.png'/);
  assert.match(mainSource, /icon:\s*runtimeIconPath/);
  assert.match(mainSource, /app\.dock\?\.setIcon\(runtimeIconPath\)/);
});

test('macOS entitlements 仅保留 Electron JIT 必需项', () => {
  const entitlementsUrl = new URL(
    '../../assets/entitlements.mac.plist',
    import.meta.url,
  );
  const entitlements = readFileSync(entitlementsUrl, 'utf8');

  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(
    entitlements,
    /com\.apple\.security\.cs\.disable-library-validation/,
  );
  assert.doesNotMatch(
    entitlements,
    /com\.apple\.security\.cs\.allow-unsigned-executable-memory/,
  );
});

test('根脚本提供开发、构建和 macOS 打包编排', () => {
  const rootPackage = readJson('../../../package.json');
  const devScript = rootPackage.scripts?.['dev:electron'] ?? '';

  assert.match(devScript, /npm run dev:server-for-electron/);
  assert.match(devScript, /AGENT_COMPANY_ELECTRON_RENDERER=1/);
  assert.match(devScript, /npm run dev -w web/);
  assert.match(devScript, /npm run dev -w electron/);
  assert.doesNotMatch(devScript, /npm run dev -w server/);
  assert.match(
    rootPackage.scripts?.['dev:server-for-electron'] ?? '',
    /npm run build -w server -- --watch/,
  );
  assert.equal(
    rootPackage.scripts?.['build:electron'],
    'npm run build -w server && npm run build -w web && npm run build -w electron',
  );
  assert.equal(
    rootPackage.scripts?.['package:mac'],
    'npm run build:electron && node electron/scripts/package-mac.mjs',
  );
});

test('Electron 开发脚本等待 Vite 后启动 Electron', () => {
  const electronPackage = readJson('../../package.json');
  const devScript = electronPackage.scripts?.dev ?? '';
  const devElectronScript = readFileSync(
    new URL('../../scripts/dev-electron.mjs', import.meta.url),
    'utf8',
  );

  assert.equal(devScript, 'node scripts/dev-electron.mjs');
  assert.match(devElectronScript, /http:\/\/127\.0\.0\.1:5173/);
  assert.match(devElectronScript, /AGENT_COMPANY_RENDERER_URL/);
  assert.match(devElectronScript, /electronBin/);
  assert.match(devElectronScript, /watchDirectory\(join\(rootDir, 'server', 'dist'\)/);
  assert.ok(electronPackage.devDependencies?.['electron-builder']);
  assert.ok(electronPackage.devDependencies?.['wait-on']);
});

test('macOS 打包脚本禁止隐式发布', () => {
  const electronPackage = readJson('../../package.json');
  assert.match(
    electronPackage.scripts?.['package:mac'] ?? '',
    /--publish never/,
  );
});

test('Electron 打包产物目录不会进入版本控制', () => {
  const gitignoreUrl = new URL('../../../.gitignore', import.meta.url);
  const gitignore = readFileSync(gitignoreUrl, 'utf8');
  assert.match(gitignore, /^electron\/release\/$/m);
});
