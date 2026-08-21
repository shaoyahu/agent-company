import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatInputSource = readFileSync(
  new URL('../../src/components/dashboard/ChatInputBox.tsx', import.meta.url),
  'utf8',
);

const appSource = readFileSync(
  new URL('../../src/App.tsx', import.meta.url),
  'utf8',
);

const boardSource = readFileSync(
  new URL('../../src/components/KanbanBoard.tsx', import.meta.url),
  'utf8',
);

const apiSource = readFileSync(
  new URL('../../src/api/client.ts', import.meta.url),
  'utf8',
);

test('ChatInputBox 提供创造模式和 SOLO 模式切换并提交 mode', () => {
  assert.match(chatInputSource, /projectMode/);
  assert.match(chatInputSource, /创造模式/);
  assert.match(chatInputSource, /SOLO 模式/);
  assert.match(chatInputSource, /mode: projectMode/);
  assert.match(chatInputSource, /autoStart: projectMode === 'creative'/);
});

test('ChatInputBox 创造模式选择 workflow,SOLO 模式才选择 Agent', () => {
  assert.match(chatInputSource, /api\.workflows\(\)/);
  assert.match(chatInputSource, /workflowId/);
  assert.match(chatInputSource, /workflowId: projectMode === 'creative' \? workflowId : undefined/);
  assert.match(chatInputSource, /projectMode === 'solo' && \(/);
  assert.match(chatInputSource, /projectMode === 'creative' && \(/);
  assert.match(chatInputSource, /WorkflowMenu/);
});

test('App 创建 SOLO 项目后不自动 tick', () => {
  assert.match(appSource, /autoStart/);
  assert.match(appSource, /if \(!options\?\.autoStart\) return/);
  assert.match(appSource, /await api\.tick\(projectId\)/);
});

test('KanbanBoard 在 SOLO 项目中隐藏任务推进区域只保留对话', () => {
  assert.match(boardSource, /isSoloProject/);
  assert.match(boardSource, /SOLO 模式/);
  assert.match(boardSource, /actions=\{isSoloProject \? undefined :/);
  assert.match(boardSource, /!\s*isSoloProject && \(/);
});

test('API 类型支持项目 mode 和 agent 消息类型', () => {
  assert.match(apiSource, /mode\?: 'creative' \| 'solo'/);
  assert.match(apiSource, /'message' \| 'system' \| 'agent' \| 'tool' \| 'thought'/);
});
