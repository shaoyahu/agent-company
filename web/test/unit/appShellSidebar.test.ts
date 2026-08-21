import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const shellSource = readFileSync(
  new URL('../../src/app/AppShell.tsx', import.meta.url),
  'utf8',
);

const topbarSource = readFileSync(
  new URL('../../src/app/AppTopbar.tsx', import.meta.url),
  'utf8',
);

const sidebarSource = readFileSync(
  new URL('../../src/app/AppSidebar.tsx', import.meta.url),
  'utf8',
);

const appSource = readFileSync(
  new URL('../../src/App.tsx', import.meta.url),
  'utf8',
);

const cssSource = readFileSync(
  new URL('../../src/app/app-shell.css', import.meta.url),
  'utf8',
);

const electronBuilderSource = readFileSync(
  new URL('../../../electron/electron-builder.yml', import.meta.url),
  'utf8',
);

test('Topbar 不再渲染三横线菜单按钮', () => {
  assert.doesNotMatch(shellSource, /onToggleSidebar=\{onToggleSidebar\}/);
  assert.doesNotMatch(topbarSource, /Menu/);
  assert.doesNotMatch(topbarSource, /app-topbar__menu/);
  assert.doesNotMatch(topbarSource, /onToggleSidebar/);
  assert.doesNotMatch(topbarSource, /onOpenMobileNav/);
});

test('侧边栏折叠态顶部保留图标并把展开按钮放到底部', () => {
  const hiddenRule = cssSource.match(
    /\.app-shell\[data-sidebar-collapsed='true'\] \.app-sidebar__brand-copy,[\s\S]*?\{\s*display: none;\s*\}/,
  );
  assert.ok(hiddenRule);
  assert.doesNotMatch(hiddenRule[0], /app-sidebar__collapse/);
  assert.doesNotMatch(hiddenRule[0], /app-sidebar__mark/);
  assert.doesNotMatch(hiddenRule[0], /app-sidebar__mobile-close/);
  assert.match(cssSource, /data-sidebar-collapsed='true'][\s\S]*?\.app-sidebar__expand-footer[\s\S]*?display: flex/);
  assert.match(cssSource, /data-sidebar-collapsed='true'][\s\S]*?\.app-sidebar__collapse[\s\S]*?display: none/);
  assert.match(cssSource, /\.app-sidebar__mobile-close[\s\S]*?display: none/);
});

test('侧边栏不渲染导航快捷键文案', () => {
  assert.doesNotMatch(sidebarSource, /app-sidebar__shortcut/);
  assert.doesNotMatch(sidebarSource, /item\.shortcut/);
  assert.doesNotMatch(cssSource, /app-sidebar__shortcut/);
});

test('侧边栏品牌名固定为 Agent Company,不使用后端公司名', () => {
  assert.match(appSource, /companyName=\{'Agent Company'\}/);
  assert.doesNotMatch(appSource, /companyName=\{company\?\.name \|\| 'Agent Company'\}/);
});

test('侧边栏品牌图标使用项目图标图片,不再渲染 AC 文本', () => {
  assert.match(sidebarSource, /className="app-sidebar__mark" src="\/app-icon\.png"/);
  assert.doesNotMatch(sidebarSource, />AC</);
  assert.match(cssSource, /object-fit:\s*cover/);
});

test('项目图标资源覆盖 Web 和 Electron 打包入口', () => {
  assert.ok(existsSync(new URL('../../public/app-icon.png', import.meta.url)));
  assert.ok(existsSync(new URL('../../../electron/assets/icon.icns', import.meta.url)));
  assert.match(electronBuilderSource, /icon:\s*assets\/icon\.icns/);
});

test('消息路由在侧边栏和 Topbar 使用消息语义', () => {
  assert.match(shellSource, /route\.view === 'project' \? 'projects' : route\.view/);
  assert.match(topbarSource, /case 'messages':\s*return '消息'/);
  assert.match(topbarSource, /route\.view === 'messages'[\s\S]*?conversationId/);
});
