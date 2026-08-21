import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LLMRegistry } from '../../src/llm/registry.js';
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from '../../src/llm/types.js';
import {
  createLlmConditionRunner,
  parseLlmConditionResult,
  type LlmConditionInput,
} from '../../src/workflows/llmCondition.js';

class ConditionProvider implements LLMProvider {
  readonly type = 'openai' as const;
  requests: ChatRequest[] = [];

  constructor(
    readonly id: string,
    private readonly response: () => Promise<ChatResponse>,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    return this.response();
  }

  async *stream(): AsyncIterable<never> {
    return;
  }
}

function response(text: string): ChatResponse {
  return {
    text,
    toolCalls: [],
    stopReason: 'end_turn',
    usage: { inputTokens: 3, outputTokens: 5 },
  };
}

function makeRegistry(
  provider?: LLMProvider,
  enabled = true,
): LLMRegistry {
  const registry = new LLMRegistry();
  if (provider) {
    (registry as any).providers.set(provider.id, provider);
    (registry as any).metadata.set(provider.id, {
      source: 'test',
      enabled,
      model: 'condition-model',
      type: provider.type,
    });
  }
  return registry;
}

function makeInput(overrides: Partial<LlmConditionInput> = {}): LlmConditionInput {
  return {
    providerId: 'main',
    prompt: '判断当前项目是否已完成',
    project: {
      id: 'project-1',
      title: '发布项目',
      description: '完成质量验收',
      boss: '球球',
      status: 'qa',
      phase: 'qa',
    },
    stageResult: 'success',
    output: '回归测试全部通过',
    projectStatus: 'qa',
    iteration: 2,
    ...overrides,
  };
}

test('LLM 判断只接受 matched 和 reason 的严格 JSON 对象', () => {
  assert.deepEqual(
    parseLlmConditionResult('{"matched":true,"reason":"验收已完成"}'),
    { matched: true, reason: '验收已完成' },
  );
  assert.deepEqual(
    parseLlmConditionResult('{"matched":false,"reason":"仍有阻塞问题"}'),
    { matched: false, reason: '仍有阻塞问题' },
  );
});

test('LLM 判断拒绝 hostile input、非严格 JSON 与缺少 matched 的响应', () => {
  for (const text of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    '不是 JSON',
    '```json\n{"matched":true,"reason":"完成"}\n```',
    '{}',
    '{"reason":"完成"}',
    '{"matched":true}',
    '{"matched":"true","reason":"完成"}',
    '{"matched":true,"reason":"","extra":true}',
    '{"matched":true,"reason":"完成","__proto__":{}}',
    '{"matched":true,"reason":"完成","constructor":{}}',
  ]) {
    assert.throws(
      () => parseLlmConditionResult(text as string),
      /^Error: LLM 判断结果格式不正确：严格 JSON/,
      String(text),
    );
  }
});

test('LLM 判断在 Provider 不存在或禁用时明确报错', async () => {
  const missing = createLlmConditionRunner({ llmRegistry: makeRegistry() });
  await assert.rejects(
    missing.matches(makeInput()),
    /LLM 判断 Provider “main”不存在或不可用/,
  );

  const provider = new ConditionProvider(
    'main',
    async () => response('{"matched":true,"reason":"不应调用"}'),
  );
  const disabled = createLlmConditionRunner({
    llmRegistry: makeRegistry(provider, false),
  });
  await assert.rejects(
    disabled.matches(makeInput()),
    /LLM 判断 Provider “main”不存在或不可用/,
  );
  assert.equal(provider.requests.length, 0);
});

test('LLM 判断 Runner 对 hostile 输入返回中文校验错误且不调用 Provider', async () => {
  const provider = new ConditionProvider(
    'main',
    async () => response('{"matched":true,"reason":"不应调用"}'),
  );
  const runner = createLlmConditionRunner({
    llmRegistry: makeRegistry(provider),
  });

  for (const input of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    {},
    { ...makeInput(), providerId: undefined },
    { ...makeInput(), providerId: null },
    { ...makeInput(), providerId: '' },
    { ...makeInput(), providerId: '   ' },
    { ...makeInput(), prompt: undefined },
    { ...makeInput(), prompt: null },
    { ...makeInput(), prompt: '' },
    { ...makeInput(), prompt: '   ' },
    { ...makeInput(), iteration: -1 },
    { ...makeInput(), iteration: 1.5 },
    { ...makeInput(), iteration: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await assert.rejects(
      runner.matches(input as LlmConditionInput),
      /^Error: LLM 判断输入无效：/,
      String(input),
    );
  }
  assert.equal(provider.requests.length, 0);
});

test('LLM 判断将调用错误、缺少文本和非法响应转换为中文错误', async () => {
  const failed = new ConditionProvider('main', async () => {
    throw new Error('上游连接超时');
  });
  await assert.rejects(
    createLlmConditionRunner({
      llmRegistry: makeRegistry(failed),
    }).matches(makeInput()),
    /LLM 判断失败：调用 LLM Provider “main”失败：上游连接超时/,
  );

  const noText = new ConditionProvider(
    'main',
    async () => ({}) as ChatResponse,
  );
  await assert.rejects(
    createLlmConditionRunner({
      llmRegistry: makeRegistry(noText),
    }).matches(makeInput()),
    /LLM 判断失败：LLM Provider “main”未返回文本/,
  );

  const malformed = new ConditionProvider(
    'main',
    async () => response('不是 JSON'),
  );
  await assert.rejects(
    createLlmConditionRunner({
      llmRegistry: makeRegistry(malformed),
    }).matches(makeInput()),
    /LLM 判断失败：LLM 判断结果格式不正确：严格 JSON/,
  );
});

test('LLM 判断将项目、阶段、输出、状态、轮次和用户提示词传给 Provider', async () => {
  const provider = new ConditionProvider(
    'main',
    async () => response('{"matched":true,"reason":"验收已完成"}'),
  );

  const result = await createLlmConditionRunner({
    llmRegistry: makeRegistry(provider),
  }).matches(makeInput());

  assert.deepEqual(result, { matched: true, reason: '验收已完成' });
  assert.equal(provider.requests.length, 1);
  const request = provider.requests[0]!;
  assert.equal(request.messages.length, 2);
  assert.match(String(request.messages[0]?.content), /只能输出 JSON/);
  assert.match(String(request.messages[0]?.content), /"matched":boolean/);
  const userPrompt = String(request.messages[1]?.content);
  assert.match(userPrompt, /发布项目/);
  assert.match(userPrompt, /success/);
  assert.match(userPrompt, /回归测试全部通过/);
  assert.match(userPrompt, /"projectStatus":"qa"/);
  assert.match(userPrompt, /"iteration":2/);
  assert.match(userPrompt, /判断当前项目是否已完成/);
});
