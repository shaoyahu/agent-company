import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const boardSource = readFileSync(
  resolve(process.cwd(), 'src/components/KanbanBoard.tsx'),
  'utf8',
);
const mentionTextareaSource = readFileSync(
  resolve(process.cwd(), 'src/components/chat/MentionTextarea.tsx'),
  'utf8',
);

test('项目聊天复用共享 @Agent 输入组件', () => {
  assert.match(boardSource, /<MentionTextarea/);
  assert.doesNotMatch(boardSource, /function MentionTextarea\(/);
  assert.match(boardSource, /from ['"].*components\/chat\/MentionTextarea/);
  assert.match(boardSource, /onPaste=\{handlePaste\}/);
});

test('共享 @Agent 输入组件执行键盘决策并按需阻止默认行为', () => {
  const handlerStart = mentionTextareaSource.indexOf('const handleKeyDown');
  const handlerEnd = mentionTextareaSource.indexOf('\n\n  return (', handlerStart);
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handlerSource = mentionTextareaSource.slice(handlerStart, handlerEnd);

  assert.match(handlerSource, /applyMentionKeyDown\(input, \{/);
  assert.match(handlerSource, /preventDefault: \(\) => event\.preventDefault\(\)/);
  assert.match(handlerSource, /select: index =>/);
  assert.match(handlerSource, /close: \(\) =>/);
  assert.match(handlerSource, /move: index =>/);
  assert.match(handlerSource, /send: onSend/);
});

test('共享 @Agent 输入组件在父级清空 value 时关闭候选', () => {
  assert.match(
    mentionTextareaSource,
    /setMention\(current => syncMentionStateForValue\(value, current\)\)/,
  );
});

test('共享 @Agent 输入组件在移动光标后同步当前 mention 状态', () => {
  assert.match(mentionTextareaSource, /const handleSelect = /);
  assert.match(
    mentionTextareaSource,
    /setMention\(findMentionState\(\s*event\.currentTarget\.value,\s*event\.currentTarget\.selectionStart \?\? event\.currentTarget\.value\.length,\s*\)\)/,
  );
  assert.match(mentionTextareaSource, /onSelect=\{handleSelect\}/);
});

test('项目聊天加载 Agent 失败时透出原始错误 danger toast', () => {
  const effectStart = boardSource.indexOf('// 一次性拿所有 agent');
  const effectEnd = boardSource.indexOf('useEffect(() => { refresh();', effectStart);
  assert.notEqual(effectStart, -1);
  assert.notEqual(effectEnd, -1);
  const effectSource = boardSource.slice(effectStart, effectEnd);

  assert.match(effectSource, /title: '加载 Agent 失败'/);
  assert.match(effectSource, /description: e instanceof Error \? e\.message : String\(e\)/);
  assert.match(effectSource, /tone: 'danger'/);
});
