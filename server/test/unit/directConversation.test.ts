import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateDirectReply,
  type DirectReplyDeps,
} from '../../src/conversations/directReply.js';
import type {
  Conversation,
  ConversationMessage,
} from '../../src/conversations/types.js';
import type { LLMMessage } from '../../src/llm/types.js';
import type { AgentConfig } from '../../src/types/company.js';

const conversation: Conversation = {
  id: 'direct-1',
  kind: 'direct',
  title: '与甲对话',
  createdBy: 'boss',
  agentMessageLimit: 30,
  maxConsecutiveSpeeches: 2,
  maxMessageChars: 300,
  cooldownMs: 5000,
  paused: false,
  pinned: false,
  muted: false,
  lastReadSequence: 0,
  schedulerMode: 'none',
  createdAt: 1,
  updatedAt: 2,
};

const agent: AgentConfig = {
  id: 'agent-a',
  name: '甲',
  department: 'dev',
  role: 'worker',
  llm: 'llm-a',
  systemPrompt: '直接回答问题。',
  tools: [],
};

const history: ConversationMessage[] = [
  {
    id: 'm-1',
    conversationId: conversation.id,
    sequence: 1,
    senderId: 'boss',
    senderType: 'human',
    content: '上一条问题',
    mentions: [],
    createdAt: 1,
  },
  {
    id: 'm-2',
    conversationId: conversation.id,
    sequence: 2,
    senderId: 'agent-a',
    senderType: 'agent',
    content: '上一条回答',
    mentions: [],
    createdAt: 2,
  },
  {
    id: 'm-3',
    conversationId: conversation.id,
    sequence: 3,
    senderId: 'boss',
    senderType: 'human',
    content: '当前问题',
    mentions: [],
    createdAt: 3,
  },
];

function makeDeps(overrides: Partial<DirectReplyDeps> = {}): DirectReplyDeps {
  return {
    getAgent: (id) => id === agent.id ? agent : undefined,
    getHistory: () => history,
    executeAgent: async () => '完整回复',
    ...overrides,
  };
}

test('私聊唯一 Agent 不等待 cooldown，基于含当前消息的最近历史返回完整字符串', async () => {
  let messages: LLMMessage[] = [];
  let calls = 0;
  const startedAt = Date.now();

  const reply = await generateDirectReply(conversation, agent.id, makeDeps({
    getHistory: (conversationId, limit) => {
      assert.equal(conversationId, conversation.id);
      assert.equal(limit, 100);
      return history;
    },
    executeAgent: async (receivedAgent, receivedMessages) => {
      calls += 1;
      assert.equal(receivedAgent, agent);
      messages = receivedMessages;
      return '第一段\n第二段';
    },
  }));

  assert.equal(reply, '第一段\n第二段');
  assert.equal(calls, 1);
  assert.ok(Date.now() - startedAt < conversation.cooldownMs);
  assert.deepEqual(messages, [
    { role: 'user', content: '上一条问题', name: 'human:boss' },
    { role: 'assistant', content: '上一条回答', name: 'agent:agent-a' },
    { role: 'user', content: '当前问题', name: 'human:boss' },
  ]);
});

test('私聊拒绝错误会话类型、错误成员和不存在的 Agent', async () => {
  await assert.rejects(
    generateDirectReply({ ...conversation, kind: 'group' }, agent.id, makeDeps()),
    /仅支持私聊/,
  );
  for (const id of ['', '   ', '__proto__', 'constructor']) {
    await assert.rejects(
      generateDirectReply(conversation, id, makeDeps()),
      /Agent id 必须是有效字符串/,
    );
  }
  await assert.rejects(
    generateDirectReply(conversation, 'missing', makeDeps()),
    /Agent 'missing' 不存在/,
  );
  await assert.rejects(
    generateDirectReply(conversation, agent.id, makeDeps({
      getAgent: () => ({ ...agent, enabled: false } as AgentConfig),
    })),
    /Agent 'agent-a' 未启用/,
  );
});

test('执行器不可用或返回空回复时透出真实中文错误且不伪造内容', async () => {
  await assert.rejects(
    generateDirectReply(conversation, agent.id, makeDeps({
      executeAgent: async () => {
        throw new Error("Agent 'agent-a' 引用了不可用的 LLM 'llm-a'");
      },
    })),
    /不可用的 LLM/,
  );
  await assert.rejects(
    generateDirectReply(conversation, agent.id, makeDeps({
      executeAgent: async () => '   ',
    })),
    /Agent 'agent-a' 未返回有效回复/,
  );
});
