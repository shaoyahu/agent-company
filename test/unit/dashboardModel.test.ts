import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceViewModel,
  filterWorkItems,
  findWorkItemById,
  getStageMeta,
  type WorkspaceData,
} from '../../src/dashboardModel';

const fixture: WorkspaceData = {
  metrics: [
    { id: 'coverage', label: '自动化覆盖', value: '92%', hint: '近 7 天上升 4%', tone: 'ok' },
  ],
  quickActions: [
    { id: 'review', label: '待评审项', description: '快速处理高优先级评审', count: '06' },
  ],
  activity: [
    {
      id: 'a-1',
      team: '平台组',
      title: '消息路由热修',
      summary: '回归测试已补齐，等待验证构建产物。',
      time: '3 分钟前',
      tone: 'review',
    },
  ],
  queues: [
    { id: 'q-1', label: '待开始', count: 4, change: '+2' },
  ],
  focus: [
    { id: 'f-1', title: 'Agent 控制台重构', owner: '王简', progress: 74, due: '今天 18:30', tone: 'running' },
  ],
  workItems: [
    {
      id: 'router-upgrade',
      name: '路由回归验证',
      owner: '球球',
      stage: 'review',
      priority: 'P0',
      progress: 82,
      due: '今天 22:00',
      summary: '锁定接口路径和 smoke 覆盖，避免前后端漂移。',
      tags: ['测试', '接口'],
      timeline: [
        { id: 't-1', label: '16:10', detail: '补齐 smoke test' },
      ],
    },
    {
      id: 'mobile-shell',
      name: '移动端壳层优化',
      owner: '阿青',
      stage: 'running',
      priority: 'P1',
      progress: 46,
      due: '明天 10:00',
      summary: '优化首屏布局和卡片层级，保证单手操作路径清晰。',
      tags: ['移动端', '布局'],
      timeline: [
        { id: 't-2', label: '17:40', detail: '合并导航入口' },
      ],
    },
  ],
};

test('getStageMeta 对未知 key 做安全兜底', () => {
  assert.equal(getStageMeta(undefined).label, '待整理');
  assert.equal(getStageMeta(null).label, '待整理');
  assert.equal(getStageMeta('').label, '待整理');
  assert.equal(getStageMeta('__proto__').label, '待整理');
  assert.equal(getStageMeta('constructor').label, '待整理');
  assert.equal(getStageMeta('review').label, '待评审');
});

test('filterWorkItems 支持 stage 与关键词联合筛选', () => {
  const result = filterWorkItems(fixture.workItems, '接口', 'review');
  assert.deepEqual(result.map((item) => item.id), ['router-upgrade']);
});

test('filterWorkItems 对 hostile input 不抛错并返回合理结果', () => {
  assert.equal(filterWorkItems(fixture.workItems, undefined, undefined).length, 2);
  assert.equal(filterWorkItems(fixture.workItems, null, null).length, 2);
  assert.equal(filterWorkItems(fixture.workItems, '   ', '').length, 2);
  assert.equal(filterWorkItems(fixture.workItems, '__proto__', 'constructor').length, 0);
});

test('findWorkItemById 在无效 id 时返回 null', () => {
  assert.equal(findWorkItemById(fixture.workItems, undefined), null);
  assert.equal(findWorkItemById(fixture.workItems, ''), null);
  assert.equal(findWorkItemById(fixture.workItems, '__proto__'), null);
  assert.equal(findWorkItemById(fixture.workItems, 'router-upgrade')?.name, '路由回归验证');
});

test('createWorkspaceViewModel 默认选中筛选后的第一项', () => {
  const viewModel = createWorkspaceViewModel(fixture, '', 'running', undefined);
  assert.equal(viewModel.filteredItems.length, 1);
  assert.equal(viewModel.selectedItem?.id, 'mobile-shell');
});

test('createWorkspaceViewModel 若选中项已被筛掉则自动回落', () => {
  const viewModel = createWorkspaceViewModel(fixture, '移动端', 'running', 'router-upgrade');
  assert.equal(viewModel.selectedItem?.id, 'mobile-shell');
});
