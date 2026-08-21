import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationSummary,
} from '../../src/api/client.ts';
import {
  createConversationEventState,
  parseWebSocketData,
  reduceConversationConnectionGeneration,
  reduceConversationEvent,
  runConversationMutation,
  type ConversationSocketEvent,
} from '../../src/features/messages/conversationEvents.ts';

function message(
  id: string,
  conversationId = 'c-1',
  sequence = 1,
): ConversationMessage {
  return {
    id,
    conversationId,
    sequence,
    senderId: 'agent-a',
    senderType: 'agent',
    content: `消息 ${id}`,
    mentions: [],
    createdAt: sequence,
  };
}

function summary(id: string): ConversationSummary {
  return {
    id,
    kind: 'group',
    title: `会话 ${id}`,
    createdBy: 'boss',
    agentMessageLimit: 30,
    maxConsecutiveSpeeches: 2,
    maxMessageChars: 300,
    cooldownMs: 5_000,
    paused: false,
    pinned: false,
    muted: false,
    lastReadSequence: 0,
    createdAt: 1,
    updatedAt: 1,
    memberCount: 3,
    unreadCount: 0,
  };
}

test('parseWebSocketData 安全解析统一 ConversationSocketEvent', () => {
  const event: ConversationSocketEvent = {
    type: 'conversation_message',
    conversationId: 'c-1',
    message: message('m-1'),
  };

  assert.deepEqual(parseWebSocketData(JSON.stringify(event)), event);
  assert.deepEqual(parseWebSocketData({
    type: 'conversation_state',
    conversationId: 'c-1',
    agentId: 'agent-a',
    state: 'speaking',
    since: 12,
  }), {
    type: 'conversation_state',
    conversationId: 'c-1',
    agentId: 'agent-a',
    state: 'speaking',
    since: 12,
  });
  assert.deepEqual(parseWebSocketData({
    type: 'conversation_updated',
    conversationId: 'c-1',
  }), {
    type: 'conversation_updated',
    conversationId: 'c-1',
  });
  assert.deepEqual(parseWebSocketData({
    type: 'conversation_deleted',
    conversationId: 'c-1',
  }), {
    type: 'conversation_deleted',
    conversationId: 'c-1',
  });
  assert.deepEqual(parseWebSocketData({
    type: 'provider_deleted',
    id: 'minimax',
  }), {
    type: 'provider_deleted',
    id: 'minimax',
  });
});

test('parseWebSocketData 忽略非法 JSON、未知事件和 hostile id 且不抛', () => {
  for (const value of [
    '{bad json',
    '',
    '   ',
    null,
    undefined,
    1,
    '{}',
    '{"type":"unknown"}',
    JSON.stringify({
      type: 'conversation_message',
      conversationId: '__proto__',
      message: message('m-1', '__proto__'),
    }),
    JSON.stringify({
      type: 'conversation_message',
      conversationId: 'c-1',
      message: message('constructor'),
    }),
    JSON.stringify({
      type: 'conversation_state',
      conversationId: 'c-1',
      agentId: 'constructor',
      state: 'speaking',
      since: 1,
    }),
  ]) {
    assert.doesNotThrow(() => parseWebSocketData(value));
    assert.equal(parseWebSocketData(value), null);
  }
});

test('parseWebSocketData 忽略未知参与者状态和非法 since', () => {
  for (const state of [undefined, null, '', '   ', '__proto__', 'constructor', 'pending']) {
    assert.equal(parseWebSocketData({
      type: 'conversation_state',
      conversationId: 'c-1',
      agentId: 'agent-a',
      state,
      since: 1,
    }), null);
  }
  for (const since of [undefined, null, '', -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseWebSocketData({
      type: 'conversation_state',
      conversationId: 'c-1',
      agentId: 'agent-a',
      state: 'idle',
      since,
    }), null);
  }
});

test('当前会话追加消息并按 id 去重', () => {
  const initial = createConversationEventState(
    [summary('c-1'), summary('c-2')],
    [message('m-1')],
  );
  const event: ConversationSocketEvent = {
    type: 'conversation_message',
    conversationId: 'c-1',
    message: message('m-2', 'c-1', 2),
  };

  const once = reduceConversationEvent(initial, event, 'c-1');
  const twice = reduceConversationEvent(once, event, 'c-1');

  assert.deepEqual(once.messages.map((item) => item.id), ['m-1', 'm-2']);
  assert.deepEqual(twice.messages.map((item) => item.id), ['m-1', 'm-2']);
  assert.equal(twice.conversations.find((item) => item.id === 'c-1')?.unreadCount, 0);
  assert.equal(twice.shouldNotify, false);
});

test('非当前会话只更新摘要和未读，重复事件不重复通知', () => {
  const initial = createConversationEventState(
    [summary('c-1'), summary('c-2')],
    [message('m-1')],
  );
  const event: ConversationSocketEvent = {
    type: 'conversation_message',
    conversationId: 'c-2',
    message: message('m-2', 'c-2', 2),
  };

  const once = reduceConversationEvent(initial, event, 'c-1');
  const twice = reduceConversationEvent(once, event, 'c-1');
  const updated = once.conversations.find((item) => item.id === 'c-2');

  assert.deepEqual(once.messages.map((item) => item.id), ['m-1']);
  assert.equal(updated?.lastMessage?.id, 'm-2');
  assert.equal(updated?.updatedAt, 2);
  assert.equal(updated?.unreadCount, 1);
  assert.equal(once.shouldNotify, true);
  assert.equal(twice.shouldNotify, false);
});

test('非当前会话只对 Agent 消息累加未读数，当前会话清零', () => {
  const initial = createConversationEventState(
    [{ ...summary('c-1'), unreadCount: 3 }, summary('c-2')],
    [],
  );
  const current = reduceConversationEvent(initial, {
    type: 'conversation_message',
    conversationId: 'c-1',
    message: message('m-current', 'c-1', 4),
  }, 'c-1');
  const human = reduceConversationEvent(current, {
    type: 'conversation_message',
    conversationId: 'c-2',
    message: {
      ...message('m-human', 'c-2', 1),
      senderId: 'boss',
      senderType: 'human',
    },
  }, 'c-1');
  const agent = reduceConversationEvent(human, {
    type: 'conversation_message',
    conversationId: 'c-2',
    message: message('m-agent', 'c-2', 2),
  }, 'c-1');

  assert.equal(current.conversations.find((item) => item.id === 'c-1')?.unreadCount, 0);
  assert.equal(human.conversations.find((item) => item.id === 'c-2')?.unreadCount, 0);
  assert.equal(agent.conversations.find((item) => item.id === 'c-2')?.unreadCount, 1);
});

test('会话状态只更新当前会话并按 Agent id 保存', () => {
  const initial = createConversationEventState([summary('c-1')], []);
  const current = reduceConversationEvent(initial, {
    type: 'conversation_state',
    conversationId: 'c-1',
    agentId: 'agent-a',
    state: 'deciding',
    since: 10,
  }, 'c-1');
  const other = reduceConversationEvent(current, {
    type: 'conversation_state',
    conversationId: 'c-2',
    agentId: 'agent-b',
    state: 'speaking',
    since: 11,
  }, 'c-1');

  assert.deepEqual(current.participantStates.get('agent-a'), {
    state: 'deciding',
    since: 10,
  });
  assert.equal(other.participantStates.has('agent-b'), false);
});

test('conversation_updated 标记列表回读和当前 detail 回读', () => {
  const initial = createConversationEventState([summary('c-1')], []);
  const current = reduceConversationEvent(initial, {
    type: 'conversation_updated',
    conversationId: 'c-1',
  }, 'c-1');
  const other = reduceConversationEvent(initial, {
    type: 'conversation_updated',
    conversationId: 'c-2',
  }, 'c-1');

  assert.equal(current.shouldReloadConversations, true);
  assert.equal(current.shouldReloadDetail, true);
  assert.equal(other.shouldReloadConversations, true);
  assert.equal(other.shouldReloadDetail, false);
});

test('conversation_deleted 移除列表项且不触发已删除会话 detail 回读', () => {
  const initial = createConversationEventState([summary('c-1'), summary('c-2')], [
    message('m-1', 'c-1', 1),
  ]);
  const current = reduceConversationEvent(initial, {
    type: 'conversation_deleted',
    conversationId: 'c-1',
  }, 'c-1');
  const other = reduceConversationEvent(initial, {
    type: 'conversation_deleted',
    conversationId: 'c-2',
  }, 'c-1');

  assert.deepEqual(current.conversations.map((conversation) => conversation.id), ['c-2']);
  assert.deepEqual(current.messages, []);
  assert.equal(current.participantStates.size, 0);
  assert.equal(current.shouldReloadConversations, true);
  assert.equal(current.shouldReloadDetail, false);
  assert.deepEqual(other.conversations.map((conversation) => conversation.id), ['c-1']);
  assert.equal(other.messages.length, 1);
  assert.equal(other.shouldReloadConversations, true);
  assert.equal(other.shouldReloadDetail, false);
});

test('连接代际变化清空断线前参与者状态并要求回读', () => {
  const initial = createConversationEventState([summary('c-1')], []);
  initial.participantStates.set('agent-a', { state: 'speaking', since: 10 });
  initial.participantStates.set('agent-b', { state: 'error', since: 11 });

  const unchanged = reduceConversationConnectionGeneration(initial, 1, 1);
  assert.equal(unchanged.state, initial);
  assert.equal(unchanged.shouldReload, false);
  assert.equal(unchanged.state.participantStates.size, 2);

  const reconnected = reduceConversationConnectionGeneration(initial, 1, 2);
  assert.notEqual(reconnected.state, initial);
  assert.equal(reconnected.shouldReload, true);
  assert.equal(reconnected.state.participantStates.size, 0);
  assert.equal(reconnected.state.conversations, initial.conversations);
  assert.equal(reconnected.state.messages, initial.messages);
});

test('非法连接代际不清空参与者状态或触发回读', () => {
  const initial = createConversationEventState([summary('c-1')], []);
  initial.participantStates.set('agent-a', { state: 'deciding', since: 10 });

  for (const generation of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const result = reduceConversationConnectionGeneration(initial, 1, generation);
    assert.equal(result.state, initial);
    assert.equal(result.shouldReload, false);
    assert.equal(result.state.participantStates.size, 1);
  }
});

test('runConversationMutation 写操作成功后回读 detail 并以回读结果为准', async () => {
  const calls: string[] = [];
  const detail = {
    ...summary('c-1'),
    members: [],
  } as ConversationDetail;

  const result = await runConversationMutation(
    async () => {
      calls.push('write');
      return { paused: true };
    },
    async () => {
      calls.push('read');
      return detail;
    },
  );

  assert.deepEqual(calls, ['write', 'read']);
  assert.equal(result, detail);
});

test('runConversationMutation 写操作失败时不执行回读', async () => {
  const calls: string[] = [];

  await assert.rejects(
    runConversationMutation(
      async () => {
        calls.push('write');
        throw new Error('写入失败');
      },
      async () => {
        calls.push('read');
        throw new Error('不应执行');
      },
    ),
    /写入失败/,
  );
  assert.deepEqual(calls, ['write']);
});
