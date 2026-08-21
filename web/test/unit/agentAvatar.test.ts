/**
 * web/test/unit/agentAvatar.test.ts
 *
 * 球球 review 2026-08-16:renderAgentAvatar 是 agent 头像的统一渲染,
 * 4 种格式(null / color:X / lucide icon name / 任意字符)都要正确处理,不能崩。
 *
 * 测试策略:不直接 renderToStaticMarkup(lucide 在 server-side 渲染需要 browser API),
 * 改用 createElement 检查返回的 ReactElement 类型 / props 验证逻辑分支。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderAgentAvatar } from '../../src/components/ui/renderAgentAvatar.js';
import { LUCIDE_PRESETS_FOR_TEST as LUCIDE_MAP } from '../../src/components/ui/renderAgentAvatar.js';

// =================== 防御性输入 ===================

test('renderAgentAvatar:空 / null / undefined 返默认(不崩)', () => {
  for (const v of ['', null, undefined]) {
    const el = renderAgentAvatar(v as any);
    assert.ok(isValidElement(el), `${JSON.stringify(v)} 应返 valid ReactElement`);
  }
});

test('renderAgentAvatar:数字 / boolean 等非 string 输入不崩', () => {
  for (const v of [42, true, false, {}, []]) {
    const el = renderAgentAvatar(v as any);
    assert.ok(isValidElement(el), `${JSON.stringify(v)} 应返 valid ReactElement,不应崩`);
  }
});

test('renderAgentAvatar:未知字符串走兜底字符渲染', () => {
  const el = renderAgentAvatar('xyz') as ReactElement;
  assert.ok(isValidElement(el));
  // 兜底分支渲染 'xyz' 字符
  assert.equal(el.props.children, 'xyz', '兜底分支应把字符串作为 children');
});

// =================== color: 前缀 ===================

test('renderAgentAvatar:color:A → 纯色方块,children=A,白色文字', () => {
  const el = renderAgentAvatar('color:A') as ReactElement;
  assert.equal(el.props.children, 'A');
  // style 应有 #fff 白色文字
  const style = el.props.style;
  assert.ok(style, '应有 style');
  assert.equal(style.color, '#fff', '纯色方块白色文字');
  assert.ok(style.background?.includes('--cat-openai'), 'openai 色块用 var(--cat-openai)');
});

test('renderAgentAvatar:color:✓ → 纯色方块,children=✓', () => {
  const el = renderAgentAvatar('color:✓') as ReactElement;
  assert.equal(el.props.children, '✓');
  assert.equal(el.props.style.color, '#fff');
});

test('renderAgentAvatar:color:未在 COLOR_BG_MAP 的字符走兜底色', () => {
  const el = renderAgentAvatar('color:Z') as ReactElement;
  assert.equal(el.props.children, 'Z');
  // 兜底用 --muted
  assert.ok(el.props.style.background?.includes('--muted'), '未知 color 走 var(--muted)');
});

// =================== lucide icon name ===================

test('renderAgentAvatar:12 个 lucide preset 全部能解析到 icon 组件', () => {
  const expected = ['user', 'bot', 'code', 'briefcase', 'palette', 'chart',
                    'wrench', 'heart', 'cpu', 'globe', 'idea', 'music'];
  for (const name of expected) {
    const Icon = LUCIDE_MAP[name];
    assert.ok(Icon, `LUCIDE_MAP 应包含 "${name}"`);
  }
});

test('renderAgentAvatar:已知 lucide name 渲染对应 icon 组件', () => {
  const el = renderAgentAvatar('user') as ReactElement;
  // lucide 分支 children 是 <Icon size=... />
  assert.ok(isValidElement(el.props.children), 'children 应是 ReactElement(lucide icon)');
  const iconEl = el.props.children as ReactElement;
  // iconEl.type 应该是 LUCIDE_MAP.user
  assert.ok(iconEl.type === LUCIDE_MAP.user, '应渲染 user icon');
});

test('renderAgentAvatar:未知 name(非 lucide 也非 color:)走兜底字符分支', () => {
  const el = renderAgentAvatar('custom-text') as ReactElement;
  // 兜底分支 children = 'custom-text'
  assert.equal(el.props.children, 'custom-text');
});

test('renderAgentAvatar:data:image 头像渲染为图片', () => {
  const src = 'data:image/png;base64,abc123';
  const el = renderAgentAvatar(src, { size: 40 }) as ReactElement;
  assert.equal(el.type, 'img');
  assert.equal(el.props.src, src);
  assert.equal(el.props.alt, '');
  assert.equal(el.props.style.width, 40);
  assert.equal(el.props.style.height, 40);
});

// =================== size / fontSize opts ===================

test('renderAgentAvatar:size 控制宽高(默认 32)', () => {
  const el = renderAgentAvatar('A') as ReactElement;
  assert.equal(el.props.style.width, 32, '默认 width=32');
  assert.equal(el.props.style.height, 32, '默认 height=32');
});

test('renderAgentAvatar:size 自定义生效', () => {
  const el = renderAgentAvatar('A', { size: 56 }) as ReactElement;
  assert.equal(el.props.style.width, 56);
  assert.equal(el.props.style.height, 56);
});

test('renderAgentAvatar:fontSize 覆盖(emoji / 兜底字符分支)', () => {
  const el = renderAgentAvatar('🤖', { size: 40, fontSize: 24 }) as ReactElement;
  assert.equal(el.props.style.fontSize, 24, 'emoji 分支应使用 fontSize');
});

// =================== hostile input ===================

test('renderAgentAvatar:__proto__ / constructor 等原型链字段不崩', () => {
  for (const v of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
    const el = renderAgentAvatar(v);
    assert.ok(isValidElement(el), `${v} 应返 valid ReactElement`);
  }
});
