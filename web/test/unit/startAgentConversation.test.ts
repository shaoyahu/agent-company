import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAgentConversation } from '../../src/features/organization/openAgentConversation.js';

test('创建 direct 成功后按顺序关闭菜单并使用共享路由导航', async () => {
  const calls: string[] = [];
  const state = { view: 'messages' as const, conversationId: '会话/id ?' };

  await openAgentConversation('agent-a', {
    createConversation: async (input) => {
      calls.push(`create:${JSON.stringify(input)}`);
      return { id: state.conversationId };
    },
    closeMenu: () => {
      calls.push('close');
    },
    pushState: (receivedState, title, path) => {
      assert.deepEqual(receivedState, state);
      assert.equal(title, '');
      calls.push(`push:${path}`);
    },
    notifyNavigation: () => {
      calls.push('notify');
    },
  });

  assert.deepEqual(calls, [
    'create:{"kind":"direct","agentIds":["agent-a"]}',
    'close',
    'push:/messages/%E4%BC%9A%E8%AF%9D%2Fid%20%3F',
    'notify',
  ]);
});

test('创建 direct 失败时不关闭菜单也不导航，并透出原错误', async () => {
  const calls: string[] = [];
  const error = new Error('创建失败');

  await assert.rejects(
    openAgentConversation('agent-a', {
      createConversation: async () => {
        calls.push('create');
        throw error;
      },
      closeMenu: () => {
        calls.push('close');
      },
      pushState: () => {
        calls.push('push');
      },
      notifyNavigation: () => {
        calls.push('notify');
      },
    }),
    (received) => received === error,
  );

  assert.deepEqual(calls, ['create']);
});
