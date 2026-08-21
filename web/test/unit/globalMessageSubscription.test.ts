import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(
  new URL('../../src/App.tsx', import.meta.url),
  'utf8',
);

const boardSource = readFileSync(
  new URL('../../src/components/KanbanBoard.tsx', import.meta.url),
  'utf8',
);

const toastSource = readFileSync(
  new URL('../../src/components/ui/Toast.tsx', import.meta.url),
  'utf8',
);

const webSocketSource = readFileSync(
  new URL('../../src/hooks/useWebSocket.ts', import.meta.url),
  'utf8',
);

test('App 全局 WebSocket 处理 message 事件并刷新工作区数据', () => {
  assert.match(appSource, /lastEvent\?\.type === 'message'/);
  assert.match(appSource, /void refresh\(\)/);
  assert.match(appSource, /收到 Agent 回复/);
});

test('App 全局 WebSocket 处理 Provider 变更事件并刷新工作区数据', () => {
  assert.match(appSource, /lastEvent\?\.type === 'provider_added'/);
  assert.match(appSource, /lastEvent\?\.type === 'provider_updated'/);
  assert.match(appSource, /lastEvent\?\.type === 'provider_deleted'/);
  assert.match(appSource, /void refresh\(\)/);
});

test('进入消息页时刷新工作区数据,避免添加成员使用旧 Agent 列表', () => {
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*if \(route\.view !== 'messages'\) return;\s*void refresh\(\);\s*\}, \[refresh, route\.view\]\)/,
  );
});

test('App 全局 Agent 回复提醒按消息 id 去重,避免重渲染重复弹 toast', () => {
  assert.match(appSource, /handledMessageToastIdsRef/);
  assert.match(appSource, /messageToastKey/);
  assert.match(appSource, /lastEvent\.projectId.*message\?\.id/s);
  assert.match(appSource, /handledMessageToastIdsRef\.current\.has\(messageToastKey\)/);
  assert.match(appSource, /handledMessageToastIdsRef\.current\.add\(messageToastKey\)/);
});

test('App 只为非当前会话提供全局摘要提醒,不处理当前消息和参与者状态', () => {
  assert.match(appSource, /lastEvent\?\.type === 'conversation_message'/);
  assert.match(appSource, /currentRoute\.view === 'messages'/);
  assert.match(appSource, /currentRoute\.conversationId === lastEvent\.conversationId/);
  assert.match(appSource, /收到会话消息/);
  assert.doesNotMatch(appSource, /setMessages/);
  assert.doesNotMatch(appSource, /participantStates/);
  assert.doesNotMatch(appSource, /lastEvent\?\.type === 'conversation_state'/);
});

test('App 会话摘要提醒按消息 id 集合去重', () => {
  assert.match(appSource, /conversationToastIdsRef/);
  assert.match(appSource, /conversationToastIdsRef\.current\.has\(lastEvent\.message\.id\)/);
  assert.match(appSource, /conversationToastIdsRef\.current\.add\(lastEvent\.message\.id\)/);
});

test('ToastProvider 提供稳定 context value,避免 toast 增删触发消费方 effect 重跑', () => {
  assert.match(toastSource, /useMemo/);
  assert.match(toastSource, /const value = useMemo\(\(\) => \(\{ push \}\), \[push\]\)/);
  assert.match(toastSource, /<ToastContext\.Provider value=\{value\}>/);
  assert.doesNotMatch(toastSource, /<ToastContext\.Provider value=\{\{ push \}\}>/);
});

test('项目页复用 App 全局 WebSocket 事件而不是自己再建连接', () => {
  assert.doesNotMatch(boardSource, /import \{ useWebSocket \} from '\.\.\/hooks\/useWebSocket'/);
  assert.doesNotMatch(boardSource, /useWebSocket\(\)/);
  assert.match(boardSource, /lastEvent\?: any/);
  assert.match(boardSource, /connected: boolean/);
});

test('项目页只在当前项目相关 message 事件到达时刷新详情', () => {
  assert.match(boardSource, /lastEvent\?\.type === 'message'/);
  assert.match(boardSource, /lastEvent\.projectId === projectId/);
  assert.match(boardSource, /refresh\(\)/);
});

test('useWebSocket 断线后安排重连并在卸载时清理 timer', () => {
  assert.match(webSocketSource, /reconnectTimer/);
  assert.match(webSocketSource, /window\.setTimeout\(connect/);
  assert.match(webSocketSource, /window\.clearTimeout\(reconnectTimer\)/);
  assert.match(webSocketSource, /if \(!stopped\)/);
});
