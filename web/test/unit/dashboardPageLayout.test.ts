import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync(
  new URL('../../src/features/dashboard/DashboardPage.tsx', import.meta.url),
  'utf8',
);

const dashboardCss = readFileSync(
  new URL('../../src/features/dashboard/dashboard.css', import.meta.url),
  'utf8',
);

const chatInputSource = readFileSync(
  new URL('../../src/components/dashboard/ChatInputBox.tsx', import.meta.url),
  'utf8',
);

test('工作台只保留大输入框和三项运行概况', () => {
  assert.doesNotMatch(dashboardSource, /PageHeader/);
  assert.doesNotMatch(dashboardSource, /breadcrumb=/);
  assert.doesNotMatch(dashboardSource, /老板：/);
  assert.doesNotMatch(dashboardSource, /company\.name/);
  assert.doesNotMatch(dashboardSource, /最近活动/);
  assert.doesNotMatch(dashboardSource, /ACTIVITY/);
  assert.doesNotMatch(dashboardSource, /需要处理/);
  assert.doesNotMatch(dashboardSource, /dashboard-grid/);
  assert.doesNotMatch(dashboardSource, /dashboard-department/);
  assert.match(dashboardSource, /title="运行概况" count=\{3\}/);
});

test('工作台输入框上方展示软件基调开场语', () => {
  assert.match(dashboardSource, /等你好久了，现在想推进什么？/);
  assert.match(dashboardSource, /className="dashboard-opening"/);
  assert.match(dashboardCss, /\.dashboard-opening[\s\S]*?text-align: center/);
});

test('工作台输入框区域居中,运行概况固定在页面底部', () => {
  assert.match(dashboardSource, /dashboard-hero-compose/);
  assert.match(dashboardCss, /\.dashboard-page[\s\S]*?display: flex[\s\S]*?flex-direction: column/);
  assert.match(dashboardCss, /\.dashboard-page \.page-container[\s\S]*?display: flex[\s\S]*?flex-direction: column/);
  assert.match(dashboardCss, /\.dashboard-hero-compose[\s\S]*?max-width: 1040px/);
  assert.match(dashboardCss, /\.dashboard-hero-compose[\s\S]*?flex: 1/);
  assert.match(dashboardCss, /\.dashboard-hero-compose[\s\S]*?align-items: center/);
  assert.match(dashboardCss, /\.dashboard-section[\s\S]*?margin-top: auto/);
});

test('工作台输入框高度更醒目', () => {
  assert.match(chatInputSource, /minHeight: 112/);
});

test('工作台输入框不放在卡片里,配置项在输入框下方', () => {
  assert.match(chatInputSource, /className="chat-input-box"/);
  assert.match(chatInputSource, /className="chat-input-box__panel"/);
  assert.match(chatInputSource, /className="chat-input-box__config"/);
  assert.match(chatInputSource, /chat-input-box__textarea[\s\S]*?chat-input-box__actions[\s\S]*?chat-input-box__config/);
  assert.doesNotMatch(chatInputSource, /boxShadow: '0 1px 2px rgba\(0,0,0,0\.04\), 0 4px 16px rgba\(0,0,0,0\.04\)'/);
});

test('工作台输入框和配置栏中间不出现双下圆角', () => {
  assert.match(dashboardCss, /\.chat-input-box__panel[\s\S]*?border-radius: calc\(var\(--ui-radius\) \+ 12px\) calc\(var\(--ui-radius\) \+ 12px\) 0 0/);
  assert.match(dashboardCss, /\.chat-input-box__config[\s\S]*?border-radius: 0 0 calc\(var\(--ui-radius\) \+ 12px\) calc\(var\(--ui-radius\) \+ 12px\)/);
});
