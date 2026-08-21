import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationMessage } from '../../src/api/client.ts';
import {
  getConversationSenderName,
  getParticipantStateMeta,
  mergeConversationMessage,
  readConversationMessageEvent,
  validateCreateConversationDraft,
} from '../../src/features/messages/messageModel.ts';

function message(
  id: string,
  sequence: number,
  content = id,
): ConversationMessage {
  return {
    id,
    conversationId: 'c-1',
    sequence,
    senderId: 'boss',
    senderType: 'human',
    content,
    mentions: [],
    createdAt: sequence,
  };
}

test('mergeConversationMessage 按 id 去重并使用最新消息', () => {
  const result = mergeConversationMessage(
    [message('m-1', 1, '旧内容'), message('m-2', 2)],
    message('m-1', 1, '新内容'),
  );

  assert.deepEqual(result.map((item) => item.id), ['m-1', 'm-2']);
  assert.equal(result[0].content, '新内容');
});

test('mergeConversationMessage 始终按 sequence 升序返回', () => {
  const result = mergeConversationMessage(
    [message('m-3', 3), message('m-1', 1)],
    message('m-2', 2),
  );

  assert.deepEqual(result.map((item) => item.sequence), [1, 2, 3]);
});

test('mergeConversationMessage 对 hostile 输入安全', () => {
  assert.deepEqual(mergeConversationMessage(undefined as any, null as any), []);
  assert.deepEqual(mergeConversationMessage(null as any, undefined as any), []);

  const result = mergeConversationMessage(
    [null, undefined, message('constructor', 2)] as any,
    message('__proto__', 1),
  );
  assert.deepEqual(result, []);
});

test('getParticipantStateMeta 映射所有参与者状态', () => {
  assert.deepEqual(getParticipantStateMeta('idle'), {
    label: '空闲',
    tone: 'neutral',
  });
  assert.deepEqual(getParticipantStateMeta('cooling'), {
    label: '阅读中',
    tone: 'neutral',
  });
  assert.deepEqual(getParticipantStateMeta('deciding'), {
    label: '判断中',
    tone: 'accent',
  });
  assert.deepEqual(getParticipantStateMeta('speaking'), {
    label: '发言中',
    tone: 'accent',
  });
  assert.deepEqual(getParticipantStateMeta('paused'), {
    label: '已暂停',
    tone: 'neutral',
  });
  assert.deepEqual(getParticipantStateMeta('error'), {
    label: '异常',
    tone: 'danger',
  });
});

test('getParticipantStateMeta 对未知和 hostile key 统一兜底 neutral', () => {
  const fallback = { label: '空闲', tone: 'neutral' };
  for (const state of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    'unknown',
  ]) {
    assert.deepEqual(getParticipantStateMeta(state), fallback);
  }
});

test('validateCreateConversationDraft 要求私聊正好一个 Agent', () => {
  assert.equal(validateCreateConversationDraft('direct', '', []), '私聊必须正好选择一个 Agent');
  assert.equal(validateCreateConversationDraft('direct', '', ['a', 'b']), '私聊必须正好选择一个 Agent');
  assert.equal(validateCreateConversationDraft('direct', '', ['a']), null);
});

test('validateCreateConversationDraft 要求群聊标题、至少两个 Agent 和调度器', () => {
  assert.equal(validateCreateConversationDraft('group', '', ['a', 'b']), '群聊标题不能为空');
  assert.equal(validateCreateConversationDraft('group', '   ', ['a', 'b']), '群聊标题不能为空');
  assert.equal(validateCreateConversationDraft('group', '研发群', ['a']), '群聊至少需要两个 Agent');
  assert.equal(validateCreateConversationDraft('group', '研发群', ['a', 'b']), '群聊必须配置调度器');
  assert.equal(
    validateCreateConversationDraft('group', '研发群', ['a', 'b'], 'llm', ''),
    '调度器 LLM 不能为空',
  );
  assert.equal(
    validateCreateConversationDraft('group', '研发群', ['a', 'b'], 'agent', 'constructor'),
    '调度器 Agent 无效',
  );
  assert.equal(
    validateCreateConversationDraft('group', '研发群', ['a', 'b'], 'llm', 'llm-main'),
    null,
  );
  assert.equal(
    validateCreateConversationDraft('group', '研发群', ['a', 'b'], 'agent', 'agent-c'),
    null,
  );
});

test('validateCreateConversationDraft 拒绝重复和 hostile Agent id', () => {
  assert.equal(
    validateCreateConversationDraft('group', '研发群', ['a', 'a'], 'llm', 'llm-main'),
    'Agent 不能重复选择',
  );
  for (const id of ['', '   ', '__proto__', 'constructor', null, undefined]) {
    assert.equal(
      validateCreateConversationDraft('direct', '', [id] as any),
      'Agent 选择无效',
    );
  }
});

test('validateCreateConversationDraft 拒绝 hostile 会话类型', () => {
  for (const kind of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.equal(
      validateCreateConversationDraft(kind as any, '研发群', ['a', 'b']),
      '会话类型无效',
    );
  }
});

test('getConversationSenderName 显示人类、Agent 和系统名称', () => {
  const agents = [
    {
      id: 'agent-a',
      name: '架构师',
      department: 'dev',
      role: 'worker' as const,
      llm: 'p1',
      systemPrompt: '',
      tools: [],
    },
  ];
  assert.equal(getConversationSenderName(message('m1', 1), agents), '我');
  assert.equal(
    getConversationSenderName({
      ...message('m2', 2),
      senderId: 'agent-a',
      senderType: 'agent',
    }, agents),
    '架构师',
  );
  assert.equal(
    getConversationSenderName({
      ...message('m3', 3),
      senderId: 'missing',
      senderType: 'agent',
    }, agents),
    'missing',
  );
  assert.equal(
    getConversationSenderName({
      ...message('m4', 4),
      senderId: 'system',
      senderType: 'system',
    }, agents),
    '系统',
  );
});

test('getConversationSenderName 对 hostile 消息和 Agent 集合安全兜底', () => {
  for (const value of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.equal(getConversationSenderName(value as any, null as any), 'Agent');
  }
});

test('readConversationMessageEvent 只接受结构完整且会话一致的事件', () => {
  const incoming = message('m-2', 2);
  assert.deepEqual(readConversationMessageEvent({
    type: 'conversation_message',
    conversationId: 'c-1',
    message: incoming,
  }), incoming);

  for (const value of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    {},
    { type: 'unknown' },
    { type: 'conversation_message', conversationId: '__proto__', message: incoming },
    { type: 'conversation_message', conversationId: 'other', message: incoming },
    { type: 'conversation_message', conversationId: 'c-1', message: null },
  ]) {
    assert.equal(readConversationMessageEvent(value), null);
  }
});
