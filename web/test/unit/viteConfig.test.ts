import test from 'node:test';
import assert from 'node:assert/strict';
import config, { createViteConfig } from '../../vite.config.js';

test('生产资源使用相对路径以支持 Electron loadFile', () => {
  assert.equal(config.base, './');
});

test('预构建 React DOM 依赖,避免 Electron dev 窗口出现 Outdated Optimize Dep 白屏', () => {
  const cfg = createViteConfig({});
  assert.deepEqual(cfg.optimizeDeps?.include, ['react-dom']);
});

test('浏览器开发模式保留 API proxy 到默认后端端口', () => {
  const cfg = createViteConfig({});
  assert.deepEqual(cfg.server?.proxy, {
    '/api': 'http://localhost:4000',
    '/ws': {
      target: 'ws://localhost:4000',
      ws: true,
    },
  });
});

test('Electron renderer 开发模式禁用 API proxy 避免 4000 未启动刷屏', () => {
  const cfg = createViteConfig({ AGENT_COMPANY_ELECTRON_RENDERER: '1' });
  assert.equal(cfg.server?.proxy, undefined);
  assert.ok(
    cfg.plugins?.some((plugin) => (
      typeof plugin === 'object'
      && plugin !== null
      && 'name' in plugin
      && plugin.name === 'agent-company-electron-dev-api-guard'
    )),
  );
});
