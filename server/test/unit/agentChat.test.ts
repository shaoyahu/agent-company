import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  executeAgentChat,
  type AgentChatExecutionDeps,
  type AgentChatResponse,
} from '../../src/agent/agentChat.js';
import type { LLMMessage, LLMProvider } from '../../src/llm/types.js';
import type { AgentConfig } from '../../src/types/company.js';

const llmAgent: AgentConfig = {
  id: 'agent-a',
  name: '甲',
  department: 'dev',
  role: 'worker',
  llm: 'llm-a',
  systemPrompt: '直接回答。',
  tools: [],
};

const history: LLMMessage[] = [
  { role: 'user', content: '上一条问题', name: 'human:boss' },
  { role: 'assistant', content: '上一条回答', name: 'agent:agent-a' },
  { role: 'user', content: '当前问题', name: 'human:boss' },
];

function deps(overrides: Partial<AgentChatExecutionDeps> = {}): AgentChatExecutionDeps {
  return {
    companyRoot: '/tmp/agent-company',
    getProvider: () => undefined,
    executeCliAgentOnce: async () => ({ validationError: '不应执行 CLI' }),
    ...overrides,
  };
}

test('LLM 执行保留真实历史并只走非流式 chat，不产生 chunk', async () => {
  const requests: LLMMessage[][] = [];
  let streamCalls = 0;
  const provider: LLMProvider = {
    id: 'llm-a',
    type: 'openai',
    async chat(request) {
      requests.push(request.messages.map((message) => ({ ...message })));
      return {
        text: '完整回复',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 12, outputTokens: 4 },
      };
    },
    async *stream() {
      streamCalls += 1;
      throw new Error('禁止流式执行');
    },
  };

  const result = await executeAgentChat(
    llmAgent,
    history,
    deps({ getProvider: (id) => id === provider.id ? provider : undefined }),
  );

  assert.equal(result.requestError, undefined);
  assert.equal(result.response?.success, true);
  assert.equal(result.response?.text, '完整回复');
  assert.deepEqual(requests, [[
    { role: 'system', content: '直接回答。' },
    ...history,
  ]]);
  assert.equal(streamCalls, 0);
});

test('CLI 带发送者历史且只复用一次单次执行和错误摘要结果', async () => {
  const agent: AgentConfig = {
    ...llmAgent,
    executor: 'cli',
    llm: '',
    cliTool: 'trae-cli',
    cliModel: 'model-a',
  };
  const calls: Array<{
    prompt: string;
    phase: 'test' | 'chat';
    projectDir?: string;
  }> = [];
  const formattedFailure: AgentChatResponse = {
    success: false,
    text: '完整 CLI 输出',
    executor: 'cli',
    command: '/bin/sh',
    args: ['-c', 'exit 1'],
    exitCode: 1,
    durationMs: 8,
    error: 'CLI 执行失败（exit 1）\n错误摘要\n完整输出已记录到 Server 日志。',
  };

  const result = await executeAgentChat(agent, history, deps({
    executeCliAgentOnce: async (_agent, prompt, phase, projectDir) => {
      calls.push({ prompt, phase, projectDir });
      return { response: formattedFailure };
    },
  }));

  assert.deepEqual(calls, [{
    prompt: [
      '[human:boss] 上一条问题',
      '[agent:agent-a] 上一条回答',
      '[human:boss] 当前问题',
    ].join('\n'),
    phase: 'chat',
    projectDir: undefined,
  }]);
  assert.equal(result.response, formattedFailure);
  assert.equal(result.response?.error, formattedFailure.error);
});

test('共享执行器透出旧接口需要的请求级错误', async () => {
  const cliAgent: AgentConfig = {
    ...llmAgent,
    executor: 'cli',
    llm: '',
  };

  assert.deepEqual(
    await executeAgentChat(cliAgent, [
      { role: 'assistant', content: '没有用户消息' },
    ], deps()),
    { requestError: '未找到用户消息' },
  );
  assert.deepEqual(
    await executeAgentChat(llmAgent, history, deps()),
    { requestError: "Agent 'agent-a' 引用了不可用的 LLM 'llm-a'" },
  );
});
