import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemePicker } from '../../src/components/ui/ThemePicker.tsx';

test('ThemePicker 渲染三套中文主题', () => {
  const html = renderToStaticMarkup(
    React.createElement(ThemePicker, {
      value: 'console',
      onChange: () => {},
    }),
  );

  assert.match(html, /专业控制台/);
  assert.match(html, /明亮工作台/);
  assert.match(html, /深色终端/);
});

test('ThemePicker 标记当前选中主题', () => {
  const html = renderToStaticMarkup(
    React.createElement(ThemePicker, {
      value: 'terminal',
      onChange: () => {},
    }),
  );

  assert.match(html, /data-selected="true"/);
  assert.match(html, /aria-pressed="true"/);
});

test('ThemePicker 对非法值回退专业控制台', () => {
  const html = renderToStaticMarkup(
    React.createElement(ThemePicker, {
      value: '__proto__' as any,
      onChange: () => {},
    }),
  );

  assert.match(html, /data-theme-option="console"[^>]*data-selected="true"/);
});
