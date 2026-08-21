import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/AgentsView.tsx'),
  'utf8',
);
const departmentTreeSource = readFileSync(
  resolve(process.cwd(), 'src/components/DepartmentTree.tsx'),
  'utf8',
);
const organizationCss = readFileSync(
  resolve(process.cwd(), 'src/features/organization/organization.css'),
  'utf8',
);

test('Agent 头像选择器不得放入固定 80px 窄列', () => {
  assert.doesNotMatch(source, /gridTemplateColumns:\s*'1fr 1fr 80px'/);
  assert.match(
    source,
    /gridTemplateColumns:\s*vp\.isNarrow\s*\?\s*'1fr'\s*:\s*'repeat\(2, minmax\(0, 1fr\)\)'/,
  );
  assert.match(
    source,
    /data-agent-avatar-field style=\{\{ width: '100%', maxWidth: 420 \}\}/,
  );
});

test('CLI 工具未选择时必须显示明确占位项', () => {
  assert.match(source, /'\(请选择 CLI 工具\)'/);
  assert.match(source, /getCliToolSelectionNotice\(a\.cliTool, cliTools\)/);
});

test('部门编辑器不暴露底层 id、负责人 agent id 和 teams', () => {
  assert.doesNotMatch(source, /label="部门 ID"/);
  assert.doesNotMatch(source, /label="负责人 agent id"/);
  assert.doesNotMatch(source, /label="Teams\(逗号分隔\)"/);
  assert.match(source, /label="英文名称"/);
  assert.doesNotMatch(source, /company[\s\S]{0,120}department[\s\S]{0,80}(edit|new)/);
});

test('部门树使用列表导航布局,不再用大卡片展示部门', () => {
  assert.match(departmentTreeSource, /data-department-tree-toolbar/);
  assert.match(departmentTreeSource, /data-department-list/);
  assert.match(departmentTreeSource, /data-department-row/);
  assert.match(departmentTreeSource, /data-department-accent/);
  assert.match(departmentTreeSource, /data-department-actions/);
  assert.match(departmentTreeSource, /部门\s*\{departments\.length\}\s*·\s*成员\s*\{agents\.length\}/);
  assert.match(departmentTreeSource, /opacity:\s*hover\s*\?\s*1\s*:\s*0/);
  assert.doesNotMatch(departmentTreeSource, /borderRadius:\s*'var\(--ui-radius\)'[\s\S]{0,120}overflow:\s*'hidden'[\s\S]{0,120}\{tree\.map/);
  assert.doesNotMatch(departmentTreeSource, /depthMark/);
});

test('Agent 角色说明部长就是部门负责人', () => {
  assert.match(source, /部长（部门负责人）/);
});

test('Agent 测试结果使用 MarkdownText 渲染 LLM markdown 输出', () => {
  assert.match(source, /MarkdownText/);
  assert.match(source, /className="agent-test-markdown"/);
  assert.match(source, /value=\{result\.success \? \(result\.text \|\| '\(无文本输出\)'\) : result\.error\}/);
});

test('Agent 编辑器不暴露底层 id 和 team 字段', () => {
  assert.doesNotMatch(source, /label="Agent ID"/);
  assert.doesNotMatch(source, /label="Team"/);
  assert.match(source, /label="英文名称"/);
  assert.doesNotMatch(source, /company[\s\S]{0,120}agents[\s\S]{0,80}(clone|edit|new)/);
  assert.doesNotMatch(source, /selectedAgent\.team/);
  assert.doesNotMatch(source, /a\.team \?/);
  assert.doesNotMatch(source, /d\.teams[\s\S]{0,80}join/);
});

test('组织页删除旧的本地 Agent 对话组件及专用依赖', () => {
  assert.doesNotMatch(source, /\bChatAgentModal\b/);
  assert.doesNotMatch(source, /\bChatBubble\b/);
  assert.doesNotMatch(source, /\bChatMessage\b/);
  assert.doesNotMatch(source, /\bMentionTextarea\b/);
  assert.doesNotMatch(source, /\bgetActiveMentionAgents\b/);
  assert.doesNotMatch(source, /\bMentionAgent\b/);
});

test('组织 Agent 卡片不渲染空 LLM tag,对话按钮不压住身份 tag', () => {
  assert.match(source, /\{a\.llm && \(/);
  assert.match(source, /data-agent-card-title-row/);
  assert.match(source, /data-agent-card-chat-button/);
  assert.doesNotMatch(source, /position:\s*'absolute'[\s\S]{0,160}title="直接跟这个 agent 对话"/);
});

test('组织 Agent 卡片没有左侧透明占位,hover 不临时改边框颜色', () => {
  const cardStart = source.indexOf('className="organization-agent-card"');
  assert.notEqual(cardStart, -1);
  const cardRoot = source.slice(cardStart, source.indexOf('{/* 头像 + 名字 */}', cardStart));
  assert.doesNotMatch(cardRoot, /borderLeft/);
  assert.doesNotMatch(cardRoot, /style\.borderColor/);
  assert.match(cardRoot, /transition: 'background 0\.1s, box-shadow 0\.1s'/);
});

test('Agent 详情操作合并到右上角三点菜单,不再使用底部横排按钮', () => {
  assert.match(source, /MoreHorizontal/);
  assert.match(source, /data-agent-detail-actions-menu/);
  assert.match(source, /AgentActionsMenu/);
  assert.match(source, /aria-label="打开 Agent 操作菜单"/);
  assert.match(source, /编辑/);
  assert.match(source, /复制/);
  assert.match(source, /测试/);
  assert.match(source, /对话/);
  assert.match(source, /删除/);
  assert.doesNotMatch(source, /\/\* 详情底部操作 \*\//);
});

test('组织页 Agent 支持多选并批量删除 DB Agent', () => {
  assert.match(source, /selectedAgentIds/);
  assert.match(source, /toggleSelectedAgent/);
  assert.match(source, /handleBatchDeleteAgents/);
  assert.match(source, /data-agent-card-select/);
  assert.match(source, /批量删除/);
  assert.match(source, /agents\.db\.some\(x => x\.id === id\)/);
  assert.match(source, /api\.deleteAgent\(id\)/);
});

test('组织页 Agent 卡片右键打开与详情相同的 Portal 菜单', () => {
  assert.match(source, /createPortal/);
  assert.match(source, /contextAgentMenu/);
  assert.match(source, /onContextMenu/);
  assert.match(source, /data-agent-card-context-menu/);
  assert.match(source, /position:\s*'fixed'/);
  assert.match(source, /AgentActionsMenu/);
});

test('Agent 编辑和复制使用显式模式,真实 -copy 后缀 Agent 仍更新原记录', () => {
  assert.doesNotMatch(source, /existing\.id\.endsWith\('-copy'\)/);
  assert.match(source, /mode:\s*'edit'/);
  assert.match(source, /mode:\s*'clone'/);
  assert.match(source, /const isEditing = mode === 'edit'/);
  assert.match(source, /existing:\s*isEditing\s*\?\s*existing\s*:\s*null/);
});

test('Agent 详情打开时组织页不得产生横向溢出', () => {
  const layoutCssBlock = organizationCss.slice(
    organizationCss.indexOf('.organization-layout {'),
    organizationCss.indexOf('.organization-departments {'),
  );
  assert.match(layoutCssBlock, /overflow:\s*hidden/);
  assert.doesNotMatch(layoutCssBlock, /grid-template-columns:/);
  assert.doesNotMatch(organizationCss, /organization-detail[\s\S]{0,180}position:\s*fixed/);
  assert.doesNotMatch(organizationCss, /organization-detail[\s\S]{0,220}inset:/);
  assert.doesNotMatch(organizationCss, /organization-detail[\s\S]{0,160}width:\s*100%\s*!important/);
  assert.doesNotMatch(source, /width:\s*vp\.isNarrow\s*\?\s*300\s*:\s*380/);
});

test('组织页在窄屏也必须保持左右分栏,不能切成上下结构', () => {
  assert.doesNotMatch(organizationCss, /\.organization-layout\s*\{[\s\S]{0,140}flex-direction:\s*column/);
  assert.doesNotMatch(organizationCss, /organization-departments[\s\S]{0,180}width:\s*100%/);
  assert.doesNotMatch(organizationCss, /organization-departments[\s\S]{0,220}border-bottom/);
});

test('组织页主体布局必须用 flex 三栏,避免详情列覆盖 Agent 列', () => {
  const departmentsStart = source.indexOf('className="organization-departments"');
  const agentsStart = source.indexOf('className="organization-agents"');
  const detailStart = source.indexOf('className="organization-detail"');
  assert.notEqual(departmentsStart, -1);
  assert.notEqual(agentsStart, -1);
  assert.notEqual(detailStart, -1);
  const departmentsBlock = source.slice(departmentsStart, agentsStart);
  const agentsBlock = source.slice(agentsStart, detailStart);
  const detailBlock = source.slice(detailStart, source.indexOf('{/* 详情顶部 */}', detailStart));
  const layoutBlock = source.slice(source.indexOf('className="organization-layout"'), departmentsStart);

  assert.match(source, /className="organization-layout"\s+style=\{\{/);
  assert.match(layoutBlock, /display:\s*'flex'/);
  assert.doesNotMatch(layoutBlock, /gridTemplateColumns:/);
  assert.match(departmentsBlock, /flex:\s*`0 0 \$\{vp\.isNarrow \? 160 : 260\}px`/);
  assert.match(agentsBlock, /flex:\s*'1 1 0'/);
  assert.match(detailBlock, /flex:\s*'0 0 clamp\(280px, 34vw, 360px\)'/);
  assert.match(source, /minWidth:\s*0/);
  assert.match(source, /overflow:\s*'hidden'/);
  assert.doesNotMatch(source, /width:\s*vp\.isNarrow\s*\?\s*220\s*:\s*280/);
});

test('组织页 Agent 列内部元素不得用固定最小宽度溢出到详情列', () => {
  const agentsStart = source.indexOf('className="organization-agents"');
  const detailStart = source.indexOf('className="organization-detail"');
  assert.notEqual(agentsStart, -1);
  assert.notEqual(detailStart, -1);
  const agentsBlock = source.slice(agentsStart, detailStart);

  assert.doesNotMatch(agentsBlock, /style=\{\{\s*width:\s*280\s*\}\}/);
  assert.doesNotMatch(agentsBlock, /minmax\(280px, 1fr\)/);
  assert.match(agentsBlock, /width:\s*'min\(100%, 280px\)'/);
  assert.match(agentsBlock, /minmax\(min\(100%, 240px\), 1fr\)/);
  assert.doesNotMatch(organizationCss, /organization-agent-grid[\s\S]{0,120}!important/);
});
