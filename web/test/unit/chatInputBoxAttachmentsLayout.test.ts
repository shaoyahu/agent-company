import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../src/components/dashboard/ChatInputBox.tsx', import.meta.url),
  'utf8',
);

test('附件按钮启用真实文件选择并展示附件 chip', () => {
  assert.match(source, /fileInputRef/);
  assert.match(source, /type="file"/);
  assert.match(source, /multiple/);
  assert.match(source, /attachments\.map/);
  assert.match(source, /removeAttachment/);
  assert.doesNotMatch(source, /附件功能开发中/);
});

test('创建项目时把附件随 createProject 提交,成功后清空附件', () => {
  assert.match(source, /attachments:/);
  assert.match(source, /setAttachments\(\[\]\)/);
});

test('清空输入按钮语义明确且无输入时禁用', () => {
  assert.match(source, /Trash2|X/);
  assert.match(source, /title="清空输入"/);
  assert.match(source, /disabled=\{!text\.trim\(\)\}/);
  assert.doesNotMatch(source, /RefreshCw/);
});

test('输入框使用独立输入面板和 focus 强调样式', () => {
  assert.match(source, /inputFocused/);
  assert.match(source, /onFocus=\{\(\) => setInputFocused\(true\)\}/);
  assert.match(source, /onBlur=\{\(\) => setInputFocused\(false\)\}/);
  assert.match(source, /className="chat-input-box__panel"/);
  assert.match(source, /background: 'transparent'/);
  assert.match(source, /boxShadow: inputFocused \?/);
});
