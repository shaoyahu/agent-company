import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationModel } from '../../src/app/navigation.tsx';

test('导航固定包含五个主入口并保持精确顺序', () => {
  const model = buildNavigationModel([], () => {});
  assert.deepEqual(model.primary.map((item) => item.id), [
    'dashboard',
    'messages',
    'organization',
    'projects',
    'settings',
  ]);
  assert.deepEqual(model.primary.map((item) => item.label), [
    '工作台',
    '消息',
    '组织',
    '项目',
    '设置',
  ]);
  assert.equal(model.primary.some((item) => 'shortcut' in item), false);
});

test('消息导航点击进入消息主页并使用 MessageSquare 图标', () => {
  const selected: unknown[] = [];
  const model = buildNavigationModel([], (route) => selected.push(route));
  const messages = model.primary.find((item) => item.id === 'messages');

  assert.ok(messages);
  assert.equal((messages.icon as any).type.displayName, 'MessageSquare');
  messages.onSelect();
  assert.deepEqual(selected, [{ view: 'messages' }]);
});

test('最近项目最多五个并按更新时间倒序', () => {
  const projects = Array.from({ length: 7 }, (_, index) => ({
    id: `p-${index}`,
    title: `项目 ${index}`,
    status: 'prd',
    phase: 'prd',
    updatedAt: index,
  }));
  const model = buildNavigationModel(projects as any, () => {});

  assert.equal(model.recentProjects.length, 5);
  assert.deepEqual(
    model.recentProjects.map((item) => item.id),
    ['p-6', 'p-5', 'p-4', 'p-3', 'p-2'],
  );
});

test('导航对缺失项目字段和 hostile id 不抛', () => {
  assert.doesNotThrow(() => buildNavigationModel([
    { id: '__proto__', title: '', updatedAt: Number.NaN },
    { id: 'constructor', title: undefined, updatedAt: undefined },
  ] as any, () => {}));
});

test('最近项目点击返回项目路由', () => {
  const selected: unknown[] = [];
  const model = buildNavigationModel([
    { id: 'p/1', title: '测试', status: 'dev', phase: 'dev', updatedAt: 1 },
  ] as any, (route) => selected.push(route));

  model.recentProjects[0].onSelect();
  assert.deepEqual(selected, [{ view: 'project', projectId: 'p/1' }]);
});
