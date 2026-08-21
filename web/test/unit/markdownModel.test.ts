import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseMarkdownInline } from '../../src/components/ui/markdownModel';

test('parseMarkdownInline 解析粗体和行内代码', () => {
  assert.deepEqual(parseMarkdownInline('用 **React.memo** 包裹 `Card`'), [
    { type: 'text', text: '用 ' },
    { type: 'strong', text: 'React.memo' },
    { type: 'text', text: ' 包裹 ' },
    { type: 'code', text: 'Card' },
  ]);
});

test('parseMarkdown 解析 LLM 常见 markdown:标题、有序列表、无序列表和代码块', () => {
  assert.deepEqual(parseMarkdown([
    '## 写代码',
    '- **前端**：React + TypeScript',
    '- 使用 `useMemo` 稳定 props',
    '',
    '1. 先看现状',
    '2. 再改代码',
    '',
    '```tsx',
    'const ok = true;',
    '```',
  ].join('\n')), [
    {
      type: 'heading',
      level: 2,
      inline: [{ type: 'text', text: '写代码' }],
    },
    {
      type: 'unorderedList',
      items: [
        [
          { type: 'strong', text: '前端' },
          { type: 'text', text: '：React + TypeScript' },
        ],
        [
          { type: 'text', text: '使用 ' },
          { type: 'code', text: 'useMemo' },
          { type: 'text', text: ' 稳定 props' },
        ],
      ],
    },
    {
      type: 'orderedList',
      items: [
        [{ type: 'text', text: '先看现状' }],
        [{ type: 'text', text: '再改代码' }],
      ],
    },
    {
      type: 'codeBlock',
      language: 'tsx',
      text: 'const ok = true;',
    },
  ]);
});

test('parseMarkdown 解析简单 markdown 表格', () => {
  assert.deepEqual(parseMarkdown([
    '| 项 | 值 |',
    '| --- | --- |',
    '| 模型 | **MiniMax-M3** |',
  ].join('\n')), [
    {
      type: 'table',
      headers: [
        [{ type: 'text', text: '项' }],
        [{ type: 'text', text: '值' }],
      ],
      rows: [[
        [{ type: 'text', text: '模型' }],
        [{ type: 'strong', text: 'MiniMax-M3' }],
      ]],
    },
  ]);
});

test('parseMarkdown 对 hostile input 安全兜底', () => {
  for (const value of [undefined, null, '', '   ', '__proto__', 'constructor', '<script>alert(1)</script>']) {
    assert.doesNotThrow(() => parseMarkdown(value));
    assert.doesNotThrow(() => parseMarkdownInline(value));
  }
  assert.deepEqual(parseMarkdown(undefined), []);
});
