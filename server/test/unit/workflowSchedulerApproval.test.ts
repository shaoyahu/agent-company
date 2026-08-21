import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LLMRegistry } from '../../src/llm/registry.js';
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from '../../src/llm/types.js';
import {
  createSchedulerApprovalRunner,
  parseSchedulerApproval,
  type SchedulerApprovalInput,
} from '../../src/workflows/schedulerApproval.js';

class ApprovalProvider implements LLMProvider {
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
      model: 'approval-model',
      type: provider.type,
    });
  }
  return registry;
}

function makeInput(prompt?: string): SchedulerApprovalInput {
  return {
    providerId: 'scheduler',
    schedulerNodeId: 'approval',
    nodeRunId: 'run-approval',
    prompt,
    project: {
      id: 'project-1',
      title: '发布审批项目',
      description: '确认发布质量',
      boss: '球球',
      status: 'qa',
      phase: 'qa',
    },
    workflowSnapshot: {
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'approval', type: 'scheduler_approval', providerId: 'scheduler' },
        { id: 'end-approved', type: 'end' },
        { id: 'end-rejected', type: 'end' },
      ],
      edges: [
        { id: 'edge-start', source: 'start', target: 'approval', type: 'default' },
        { id: 'edge-approved', source: 'approval', target: 'end-approved', type: 'approved' },
        { id: 'edge-rejected', source: 'approval', target: 'end-rejected', type: 'rejected' },
      ],
    },
    completedNodeRuns: [{
      runId: 'run-stage',
      nodeId: 'stage-qa',
      nodeType: 'stage',
      status: 'completed',
      startedAt: 1,
      completedAt: 2,
      outputRefs: ['task-qa'],
    }],
    taskOutputs: [{
      id: 'task-qa',
      phase: 'qa',
      title: '执行验收',
      status: 'done',
      outputSummary: '全部回归测试通过',
      outputFiles: ['test-report.md'],
    }],
  };
}

test('parseSchedulerApproval 只接受 approved/rejected 严格 JSON 对象', () => {
  assert.deepEqual(
    parseSchedulerApproval('{"decision":"approved","reason":"测试全部通过"}'),
    { decision: 'approved', reason: '测试全部通过' },
  );
  assert.deepEqual(
    parseSchedulerApproval('{"decision":"rejected","reason":"缺少回归测试"}'),
    { decision: 'rejected', reason: '缺少回归测试' },
  );
});

test('parseSchedulerApproval 拒绝空值、非 JSON、围栏和非对象', () => {
  const values: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    'approved',
    '前缀 {"decision":"approved","reason":"可以发布"}',
    '```json\n{"decision":"approved","reason":"可以发布"}\n```',
    '[]',
    'null',
  ];
  for (const value of values) {
    assert.throws(
      () => parseSchedulerApproval(value as string),
      /^Error: 审批结果格式不正确：/,
      String(value),
    );
  }
});

test('parseSchedulerApproval 拒绝缺字段、额外字段、错误 decision 和空 reason', () => {
  const values = [
    '{}',
    '{"decision":"approved"}',
    '{"reason":"可以发布"}',
    '{"decision":"approve","reason":"可以发布"}',
    '{"decision":"","reason":"可以发布"}',
    '{"decision":"approved","reason":""}',
    '{"decision":"approved","reason":"   "}',
    '{"decision":"approved","reason":1}',
    '{"decision":"approved","reason":"可以发布","extra":true}',
    '{"decision":"approved","reason":"可以发布","__proto__":{}}',
    '{"decision":"approved","reason":"可以发布","constructor":{}}',
  ];
  for (const value of values) {
    assert.throws(
      () => parseSchedulerApproval(value),
      /^Error: 审批结果格式不正确：/,
      value,
    );
  }
});

test('parseSchedulerApproval 拒绝过长 reason 且不泄漏 JSON.parse SyntaxError', () => {
  assert.throws(
    () => parseSchedulerApproval(`{"decision":"approved","reason":"${'好'.repeat(1001)}"}`),
    /审批结果格式不正确：审批理由不能超过 1000 个字符/,
  );
  assert.throws(
    () => parseSchedulerApproval('{'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^审批结果格式不正确：/);
      assert.doesNotMatch(error.message, /JSON|SyntaxError|position|Unexpected/);
      return true;
    },
  );
});

test('Runner 在 Provider 不存在或禁用时明确报错', async () => {
  const missing = createSchedulerApprovalRunner({
    llmRegistry: makeRegistry(),
  });
  await assert.rejects(
    missing.decide(makeInput()),
    /调度器 LLM “scheduler”不存在或不可用/,
  );

  const disabledProvider = new ApprovalProvider(
    'scheduler',
    async () => response('{"decision":"approved","reason":"可以发布"}'),
  );
  const disabled = createSchedulerApprovalRunner({
    llmRegistry: makeRegistry(disabledProvider, false),
  });
  await assert.rejects(
    disabled.decide(makeInput()),
    /调度器 LLM “scheduler”不存在或不可用/,
  );
  assert.equal(disabledProvider.requests.length, 0);
});

test('Runner 在 Provider 从启用更新为禁用后拒绝审批且不调用旧实例', async () => {
  const provider = new ApprovalProvider(
    'scheduler',
    async () => response('{"decision":"approved","reason":"不应调用"}'),
  );
  const registry = makeRegistry(provider);
  registry.add({
    id: 'scheduler',
    type: 'openai',
    model: 'approval-model',
    enabled: false,
  });

  await assert.rejects(
    createSchedulerApprovalRunner({ llmRegistry: registry }).decide(makeInput()),
    /调度器 LLM “scheduler”不存在或不可用/,
  );
  assert.equal(provider.requests.length, 0);
});

test('Runner 将调用失败、缺文本和解析失败原样形成中文审批失败', async () => {
  const providerFailure = new ApprovalProvider('scheduler', async () => {
    throw new Error('上游连接超时');
  });
  await assert.rejects(
    createSchedulerApprovalRunner({
      llmRegistry: makeRegistry(providerFailure),
    }).decide(makeInput()),
    /调度器审批失败：调用调度器 LLM “scheduler”失败：上游连接超时/,
  );

  const invalidResponses: unknown[] = [
    null,
    undefined,
    '不是响应对象',
    [],
    {},
    { text: undefined },
    { text: null },
    { text: 1 },
    { text: '' },
    { text: '   ' },
  ];
  for (const invalidResponse of invalidResponses) {
    const missingText = new ApprovalProvider(
      'scheduler',
      async () => invalidResponse as ChatResponse,
    );
    await assert.rejects(
      createSchedulerApprovalRunner({
        llmRegistry: makeRegistry(missingText),
      }).decide(makeInput()),
      /调度器审批失败：调度器 LLM “scheduler”未返回文本/,
      String(invalidResponse),
    );
  }

  const malformed = new ApprovalProvider(
    'scheduler',
    async () => response('不是 JSON'),
  );
  await assert.rejects(
    createSchedulerApprovalRunner({
      llmRegistry: makeRegistry(malformed),
    }).decide(makeInput()),
    /调度器审批失败：审批结果格式不正确：/,
  );
});

test('Runner prompt 保留流程上下文且当前节点补充标准只发送一次', async () => {
  const provider = new ApprovalProvider(
    'scheduler',
    async () => response('{"decision":"approved","reason":"满足发布标准"}'),
  );
  const runner = createSchedulerApprovalRunner({
    llmRegistry: makeRegistry(provider),
  });
    const approvalCriteria = '必须确认安全扫描通过';
    const input = makeInput(approvalCriteria);
    const approvalNode = input.workflowSnapshot.nodes.find(
      (node) => node.id === input.schedulerNodeId,
    );
    assert.equal(approvalNode?.type, 'scheduler_approval');
    if (!approvalNode || approvalNode.type !== 'scheduler_approval') {
      assert.fail('测试工作流缺少调度器审批节点');
    }
    approvalNode.prompt = approvalCriteria;

    const result = await runner.decide(input);

  assert.deepEqual(result, {
    decision: 'approved',
    reason: '满足发布标准',
  });
  assert.equal(provider.requests.length, 1);
  const request = provider.requests[0]!;
  assert.equal(request.messages.length, 2);
  const systemPrompt = request.messages[0]?.content;
  const userPrompt = request.messages[1]?.content;
  assert.equal(typeof systemPrompt, 'string');
  assert.equal(typeof userPrompt, 'string');
  assert.match(systemPrompt as string, /只能输出 JSON/);
  assert.match(systemPrompt as string, /"decision":"approved\|rejected"/);
  assert.match(userPrompt as string, /发布审批项目/);
  assert.match(userPrompt as string, /run-stage/);
  assert.match(userPrompt as string, /全部回归测试通过/);
    assert.match(userPrompt as string, /"id":"approval"/);
    assert.match(userPrompt as string, /"providerId":"scheduler"/);
    assert.match(userPrompt as string, /"type":"approved"/);
    assert.equal(
      (userPrompt as string).match(/必须确认安全扫描通过/g)?.length,
      1,
    );
  assert.match(userPrompt as string, /补充审批标准/);

    await runner.decide(makeInput('   '));
    const blankPrompt = provider.requests[1]?.messages[1]?.content;
    assert.equal(typeof blankPrompt, 'string');
    assert.doesNotMatch(blankPrompt as string, /补充审批标准/);
});
