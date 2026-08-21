import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationScheduler,
  parseSchedulerDecision,
} from '../../src/conversations/scheduler.js';
import type { AgentChatExecutionDeps } from '../../src/agent/agentChat.js';
import type { ChatRequest, LLMProvider } from '../../src/llm/types.js';
import type { AgentConfig } from '../../src/types/company.js';
import type { Conversation, ConversationMessage } from '../../src/conversations/types.js';

const conversation: Conversation = {
  id: 'group-1',
  kind: 'group',
  title: '架构讨论',
  createdBy: 'boss',
  agentMessageLimit: 30,
  maxConsecutiveSpeeches: 2,
  maxMessageChars: 300,
  cooldownMs: 5000,
  paused: false,
  pinned: false,
  muted: false,
  lastReadSequence: 0,
  schedulerMode: 'llm',
  schedulerLlm: 'llm-main',
  createdAt: 1,
  updatedAt: 2,
};

const latestAgentMessage: ConversationMessage = {
  id: 'm-2',
  conversationId: conversation.id,
  sequence: 2,
  senderId: 'agent-a',
  senderType: 'agent',
  content: '方案已经收敛。',
  mentions: [],
  createdAt: 2,
};

const agents: AgentConfig[] = [
  {
    id: 'agent-scheduler',
    name: '调度器',
    department: 'ops',
    role: 'worker',
    llm: 'llm-agent',
    systemPrompt: '判断群聊是否需要停止。',
    tools: [],
  },
];

function makeDeps(overrides: Partial<AgentChatExecutionDeps> = {}): AgentChatExecutionDeps {
  return {
    companyRoot: '/tmp/agent-company',
    getProvider: () => undefined,
    executeCliAgentOnce: async () => ({ validationError: '不应执行 CLI' }),
    ...overrides,
  };
}

test('parseSchedulerDecision 只接受 continue 和 pause_conversation', () => {
  assert.deepEqual(parseSchedulerDecision({ decision: 'continue' }), { decision: 'continue' });
  assert.deepEqual(
    parseSchedulerDecision({
      decision: 'pause_conversation',
      reason: '讨论已经收敛，已暂停群聊。',
    }),
    {
      decision: 'pause_conversation',
      reason: '讨论已经收敛，已暂停群聊。',
    },
  );

  for (const output of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    {},
    [],
    { decision: 'pause_conversation' },
    { decision: 'pause_conversation', reason: '' },
    { decision: 'speak', reason: '不允许发言' },
    '{"decision":',
  ]) {
    assert.throws(
      () => parseSchedulerDecision(output),
      /无法识别的群聊调度协议/,
    );
  }
});

test('LLM 调度器按 conversation.schedulerLlm 调 provider 并返回暂停原因', async () => {
  const requests: ChatRequest[] = [];
  const provider: LLMProvider = {
    id: 'llm-main',
    type: 'openai',
    async chat(request) {
      requests.push(request);
      return {
        text: '{"decision":"pause_conversation","reason":"讨论已经收敛，已暂停群聊。"}',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    async *stream() {
      throw new Error('不应调用 stream');
    },
  };
  const scheduler = createConversationScheduler(makeDeps({
    getProvider: (id) => id === 'llm-main' ? provider : undefined,
  }), () => agents);

  const decision = await scheduler.decide({
    conversation,
    latestAgentMessage,
    history: [latestAgentMessage],
  });

  assert.deepEqual(decision, {
    decision: 'pause_conversation',
    reason: '讨论已经收敛，已暂停群聊。',
  });
  assert.equal(requests.length, 1);
  assert.match(String(requests[0]!.messages.at(-1)?.content), /架构讨论/);
});

test('Agent 调度器复用指定 Agent 的 LLM 配置但不要求它是群成员', async () => {
  const requests: ChatRequest[] = [];
  const provider: LLMProvider = {
    id: 'llm-agent',
    type: 'openai',
    async chat(request) {
      requests.push(request);
      return {
        text: '{"decision":"continue"}',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    async *stream() {
      throw new Error('不应调用 stream');
    },
  };
  const scheduler = createConversationScheduler(makeDeps({
    getProvider: (id) => id === 'llm-agent' ? provider : undefined,
  }), () => agents);

  const decision = await scheduler.decide({
    conversation: {
      ...conversation,
      schedulerMode: 'agent',
      schedulerLlm: undefined,
      schedulerAgentId: 'agent-scheduler',
    },
    latestAgentMessage,
    history: [latestAgentMessage],
  });

  assert.deepEqual(decision, { decision: 'continue' });
  assert.equal(requests.length, 1);
  assert.match(String(requests[0]!.messages[0]?.content), /判断群聊是否需要停止/);
});
