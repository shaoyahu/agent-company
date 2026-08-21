import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const boardSource = readFileSync(
  new URL('../../src/components/KanbanBoard.tsx', import.meta.url),
  'utf8',
);

test('项目对话输入区支持粘贴图片作为附件发送给 Agent', () => {
  assert.match(boardSource, /chatAttachments/);
  assert.match(boardSource, /handlePaste/);
  assert.match(boardSource, /clipboardData\.items/);
  assert.match(boardSource, /item\.type\.startsWith\('image\/'\)/);
  assert.match(boardSource, /fileToProjectAttachment/);
  assert.match(boardSource, /attachments:\s*chatAttachments/);
  assert.match(boardSource, /setChatAttachments\(\[\]\)/);
});

test('项目对话输入区展示已粘贴图片附件并允许移除', () => {
  assert.match(boardSource, /attachments\.map/);
  assert.match(boardSource, /粘贴图片/);
  assert.match(boardSource, /removeChatAttachment/);
  assert.match(boardSource, /formatAttachmentSize/);
});
