import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(
  new URL('../../src/features/messages/MessagesPage.tsx', import.meta.url),
  'utf8',
);
const cssSource = readFileSync(
  new URL('../../src/features/messages/messages.css', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../src/App.tsx', import.meta.url),
  'utf8',
);
const shellSource = readFileSync(
  new URL('../../src/app/AppShell.tsx', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(
  new URL('../../src/main.tsx', import.meta.url),
  'utf8',
);

function cssBlock(selector: string): string {
  const match = cssSource.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `缺少 ${selector} 样式块`);
  return match[1];
}

function cssBlockByPattern(pattern: RegExp, label: string): string {
  const match = cssSource.match(pattern);
  assert.ok(match, `缺少 ${label} 样式块`);
  return match[1];
}

test('MessagesPage 默认只渲染会话列表和聊天区,详情由点击按钮打开', () => {
  const listPane = pageSource.indexOf('className="messages-list-pane"');
  const chatPane = pageSource.indexOf('className="messages-chat-pane"');

  assert.match(pageSource, /className="messages-layout"/);
  assert.ok(listPane > -1);
  assert.ok(chatPane > listPane);
  assert.match(pageSource, /detailsOpen/);
  assert.match(pageSource, /aria-label="打开会话详情"/);
  assert.match(pageSource, /detailsOpen && detail &&/);
});

test('消息布局始终使用横向 Flex 主区并约束详情抽屉宽度', () => {
  const paneBlock = cssBlockByPattern(
    /\.messages-list-pane,\s*\.messages-chat-pane,\s*\.messages-details-pane\s*\{([^}]*)\}/,
    '面板共享',
  );

  assert.match(cssSource, /\.messages-layout\s*\{[\s\S]*?display:\s*flex/);
  assert.match(cssSource, /\.messages-layout\s*\{[\s\S]*?width:\s*100%/);
  assert.match(cssSource, /\.messages-layout\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(cssSource, /\.messages-layout\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(cssSource, /\.messages-layout\s*\{[\s\S]*?height:\s*100%/);
  assert.match(cssSource, /\.messages-layout\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(paneBlock, /min-width:\s*0/);
  assert.match(
    cssSource,
    /\.messages-list-pane\s*\{[\s\S]*?flex:\s*0 0 clamp\(220px,\s*24vw,\s*300px\)/,
  );
  assert.match(
    cssSource,
    /\.messages-chat-pane\s*\{[\s\S]*?flex:\s*1 1 0/,
  );
  assert.match(
    cssSource,
    /\.messages-details-pane\s*\{[\s\S]*?width:\s*clamp\(260px,\s*28vw,\s*340px\)/,
  );
  assert.doesNotMatch(
    cssSource,
    /\.messages-layout\s*\{[\s\S]{0,180}?flex-direction:\s*column/,
  );
});

test('长消息不能撑破中间消息栏和三栏布局', () => {
  assert.match(cssBlock('.messages-timeline'), /min-width:\s*0/);
  assert.match(cssBlock('.messages-message'), /min-width:\s*0/);
  assert.match(cssBlock('.messages-message-content'), /min-width:\s*0/);
  assert.match(cssBlock('.messages-message-content'), /overflow-wrap:\s*anywhere/);
});

test('空消息态占满聊天区剩余空间,输入框固定在底部', () => {
  const stateBlock = cssBlock('.messages-timeline-state');
  assert.match(stateBlock, /flex:\s*1/);
  assert.match(stateBlock, /min-height:\s*0/);
});

test('成员操作菜单使用最高层 fixed 浮层,避免被详情面板或滚动列表裁剪', () => {
  const popoverBlock = cssBlock('.messages-member-menu-popover');
  assert.match(popoverBlock, /position:\s*fixed/);
  assert.match(popoverBlock, /z-index:\s*1000/);
  assert.doesNotMatch(popoverBlock, /position:\s*absolute/);
});

test('窄屏规则不得隐藏主面板或改写为其他布局模式', () => {
  assert.doesNotMatch(
    cssSource,
    /\.messages-(?:list|chat)-pane\s*\{[^}]*display:\s*none/,
  );
  assert.doesNotMatch(
    cssSource,
    /\.messages-layout\s*\{[^}]*display:\s*(?:grid|block)/,
  );
});

test('App 接入 MessagesPage 并透传 Agent、事件和连接状态', () => {
  assert.match(appSource, /case 'messages':/);
  assert.match(
    appSource,
    /<MessagesPage[\s\S]*?agents=\{company\.agents\}[\s\S]*?lastEvent=\{lastEvent\}[\s\S]*?connected=\{connected\}/,
  );
  assert.match(shellSource, /data-view=\{route\.view\}/);
  assert.match(mainSource, /features\/messages\/messages\.css/);
});
