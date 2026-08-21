import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const boardSource = readFileSync(
  new URL('../../src/components/KanbanBoard.tsx', import.meta.url),
  'utf8',
);

test('项目对话发送后在消息流里展示等待 Agent 回复状态', () => {
  assert.match(boardSource, /awaitingReply/);
  assert.match(boardSource, /setAwaitingReply\(true\)/);
  assert.match(boardSource, /setAwaitingReply\(false\)/);
  assert.match(boardSource, /Agent 正在回复/);
  assert.match(boardSource, /MessageLoadingBubble/);
});

test('SOLO 项目最后一条仍是老板消息时展示等待回复状态', () => {
  assert.match(boardSource, /soloAwaitingReply/);
  assert.match(boardSource, /lastConversationMessage\?\.fromId === 'boss'/);
  assert.match(boardSource, /awaitingReply \|\| soloAwaitingReply/);
});

test('消息流滚动依赖等待态变化', () => {
  assert.match(boardSource, /\[messages\.length, showReplyLoading\]/);
});
