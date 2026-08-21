import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LLMRegistry } from '../../src/llm/registry.js';
import { createAgentDecisionRunner } from '../../src/workflows/agentDecisionRunner.js';

test('Agent 判断使用 Agent 配置的 LLM 并返回剥离控制标记的正文', async () => {
  const registry = new LLMRegistry();
  const requests: unknown[] = [];
  (registry as any).providers.set('llm-1', {
    id: 'llm-1', type: 'openai',
    async chat(request: unknown) {
      requests.push(request);
      return { text: '质量满足交付要求。\n[[匹配: 是]]', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
    },
    async *stream() {},
  });
  (registry as any).metadata.set('llm-1', { enabled: true, source: 'test', model: 'm', type: 'openai' });
  const result = await createAgentDecisionRunner({
    llmRegistry: registry,
    getAgent: id => id === 'reviewer' ? { id, name: '评审', department: 'qa', role: '评审', llm: 'llm-1', tools: [], enabled: true } : undefined,
  }).decide({
    agentId: 'reviewer', mode: 'condition', prompt: '是否通过',
    receivedInputs: [{ sourceName: '构建', outputText: '构建完成', outputFileRefs: [] }],
    project: { id: 'p1', title: '项目', status: 'qa', phase: 'qa' }, iteration: 0,
  });
  assert.deepEqual(result, { outputText: '质量满足交付要求。', controlResult: { type: 'condition', matched: true } });
  assert.equal(requests.length, 1);
});

test('Agent 判断拒绝不存在 Agent 和无效控制标记', async () => {
  const registry = new LLMRegistry();
  const runner = createAgentDecisionRunner({ llmRegistry: registry, getAgent: () => undefined });
  await assert.rejects(
    runner.decide({ agentId: 'none', mode: 'loop', prompt: '继续吗', receivedInputs: [], project: { id: 'p', title: 'p', status: 'idea', phase: 'idea' }, iteration: 0 }),
    /判断 Agent “none”不存在或未启用/,
  );
});
