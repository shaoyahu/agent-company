import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../src/components/dashboard/ChatInputBox.tsx', import.meta.url),
  'utf8',
);

const dashboardCss = readFileSync(
  new URL('../../src/features/dashboard/dashboard.css', import.meta.url),
  'utf8',
);

test('目录选择不再使用 webkitdirectory 上传或目录名猜测', () => {
  assert.doesNotMatch(source, /webkitdirectory/i);
  assert.doesNotMatch(source, /webkitRelativePath/);
  assert.doesNotMatch(source, /resolveDir\s*\(/);
  assert.doesNotMatch(source, /create:\s*true/);
});

test('授权模式使用统一 Select 组件而不是原生 select', () => {
  assert.match(source, /import \{ Select \} from '\.\.\/ui\/Select'/);
  assert.match(source, /<Select[\s\S]*options=\{/);
  assert.doesNotMatch(source, /<select\b/);
});

test('Electron 与浏览器分别显示原生选择和手工输入文案', () => {
  assert.match(source, /选择文件夹/);
  assert.match(source, /输入本地路径/);
  assert.match(source, /chooseProjectDirectory/);
  assert.match(source, /getDesktopBridge/);
});

test('文件夹选择下拉展示最近目录和选择文件夹入口', () => {
  assert.match(source, /api\.homeDirs\(\)/);
  assert.match(source, /<FolderMenu/);
  assert.match(source, /dirs=\{homeDirs\}/);
  assert.match(source, />\s*最近\s*</);
  assert.match(source, /directoryActionLabel=\{isElectron \? '选择文件夹' : '输入本地路径'\}/);
});

test('完整文件夹按钮打开下拉且只保留一个下箭头', () => {
  const titleIndex = source.indexOf("title={isElectron ? '使用 Finder 选择真实目录' : '输入由 Server 校验的绝对路径'}");
  assert.notEqual(titleIndex, -1);
  const openIndex = source.lastIndexOf('<button', titleIndex);
  assert.notEqual(openIndex, -1);
  const closeIndex = source.indexOf('</button>', titleIndex);
  assert.notEqual(closeIndex, -1);
  const folderButtonSource = source.slice(openIndex, closeIndex);
  assert.match(folderButtonSource, /onClick=\{\(\) => setShowFolderMenu\(s => !s\)\}/);
  assert.match(folderButtonSource, /<ChevronDown/);
  assert.doesNotMatch(source, /title="快速选择 Home 下的常用目录"/);
});

test('文件夹选择入口和下拉项必须有 hover 反馈', () => {
  assert.match(source, /className="chat-input-box__folder-trigger"/);
  assert.match(source, /className="chat-input-box__folder-item"/);
  assert.match(source, /className="chat-input-box__folder-action"/);
  assert.match(dashboardCss, /\.chat-input-box__folder-trigger:hover/);
  assert.match(dashboardCss, /\.chat-input-box__folder-item:hover/);
  assert.match(dashboardCss, /\.chat-input-box__folder-action:hover/);
});

test('工作台输入框面板使用白色背景', () => {
  assert.match(dashboardCss, /\.chat-input-box__panel[\s\S]*?background: #fff/);
});

test('首页输入内容作为 initialMessage 传给项目,不再拆成项目标题和描述', () => {
  assert.match(source, /initialMessage: text\.trim\(\)/);
  assert.doesNotMatch(source, /splitMessage\(text\)/);
  assert.doesNotMatch(source, /const \{ title, description \} = splitMessage/);
  assert.match(source, /const title = projectMode === 'solo' \? '新的 SOLO 对话' : '新的创造项目'/);
  assert.match(source, /api\.createProject\(\{[\s\S]*?title,[\s\S]*?initialMessage: text\.trim\(\)/);
});

test('加载 Home 快速目录后不自动选中首项', () => {
  assert.doesNotMatch(source, /d\.dirs\[0\]/);
  assert.doesNotMatch(source, /setProjectDir\(d\.dirs\[0\]\.path\)/);
});

test('Home 快速目录与其他入口共用 Server 校验且不直接写入路径', () => {
  assert.match(source, /validateProjectDirectory/);
  assert.match(source, /onSelect=\{handleSelectHomeDirectory\}/);
  assert.doesNotMatch(source, /onSelect=\{\(p\)\s*=>\s*\{\s*setProjectDir\(p\)/);
});

test('Home 不可写候选禁用并阻止选择且显示不可写状态', () => {
  assert.match(source, /disabled=\{!d\.writable\}/);
  assert.match(source, /if \(!d\.writable\) return;/);
  assert.match(source, /title=\{d\.writable \? d\.path : '不可写'\}/);
  assert.match(source, /\{d\.writable \? null : '不可写'\}/);
});
