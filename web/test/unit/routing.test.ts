import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRoute,
  routePath,
  type AppRoute,
} from '../../src/app/routing.ts';

test('parseRoute 解析五个主入口', () => {
  assert.deepEqual(parseRoute('/'), { view: 'dashboard' });
  assert.deepEqual(parseRoute('/dashboard'), { view: 'dashboard' });
  assert.deepEqual(parseRoute('/messages'), { view: 'messages' });
  assert.deepEqual(parseRoute('/agents'), { view: 'organization' });
  assert.deepEqual(parseRoute('/projects'), { view: 'projects' });
  assert.deepEqual(parseRoute('/settings'), { view: 'settings' });
});

test('parseRoute 解析消息详情并安全解码 id', () => {
  assert.deepEqual(parseRoute('/messages/c-1'), {
    view: 'messages',
    conversationId: 'c-1',
  });
  assert.deepEqual(parseRoute('/messages/a%2Fb%20c'), {
    view: 'messages',
    conversationId: 'a/b c',
  });
});

test('parseRoute 解析项目详情并解码 id', () => {
  assert.deepEqual(parseRoute('/project/a%20b'), {
    view: 'project',
    projectId: 'a b',
  });
});

test('parseRoute 对非法编码和未知路径回退工作台', () => {
  assert.deepEqual(parseRoute('/messages/%E0%A4%A'), { view: 'dashboard' });
  assert.deepEqual(parseRoute('/messages/'), { view: 'dashboard' });
  assert.deepEqual(parseRoute('/messages/a/b'), { view: 'dashboard' });
  assert.deepEqual(parseRoute('/project/%E0%A4%A'), { view: 'dashboard' });
  assert.deepEqual(parseRoute('/unknown'), { view: 'dashboard' });
  assert.deepEqual(parseRoute(''), { view: 'dashboard' });
});

test('routePath 为所有路由生成 History API 路径', () => {
  const cases: Array<[AppRoute, string]> = [
    [{ view: 'dashboard' }, '/'],
    [{ view: 'messages' }, '/messages'],
    [{ view: 'messages', conversationId: 'a/b c' }, '/messages/a%2Fb%20c'],
    [{ view: 'organization' }, '/agents'],
    [{ view: 'projects' }, '/projects'],
    [{ view: 'settings' }, '/settings'],
    [{ view: 'project', projectId: 'a/b c' }, '/project/a%2Fb%20c'],
  ];

  for (const [route, expected] of cases) {
    assert.equal(routePath(route), expected);
  }
});

test('parseRoute 与 routePath 对项目详情可往返', () => {
  const route: AppRoute = { view: 'project', projectId: '__proto__/项目' };
  assert.deepEqual(parseRoute(routePath(route)), route);
});

test('parseRoute 与 routePath 对 hostile 消息 id 可往返', () => {
  for (const conversationId of ['__proto__', 'constructor', '会话/一']) {
    const route: AppRoute = { view: 'messages', conversationId };
    assert.deepEqual(parseRoute(routePath(route)), route);
  }
});
