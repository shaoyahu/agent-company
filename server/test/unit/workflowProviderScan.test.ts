import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findUnavailableWorkflowAgent,
  workflowAgentAvailable,
} from '../../src/workflows/providerScan.js';
import type { AgentConfig } from '../../src/types/company.js';
import type { WorkflowGraph } from '../../src/workflows/model.js';

function makeGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'stage',
        type: 'stage',
        stage: '需求',
        name: '需求分析',
        description: '',
        agentId: 'stage-agent',
        inputNodeIds: [],
        prompt: '',
      },
      { id: 'condition', type: 'condition', name: '评审', description: '', inputNodeIds: ['stage'] },
      { id: 'loop-start', type: 'loop_start', loopId: 'review', maxIterations: 3 },
      {
        id: 'loop-end',
        type: 'loop_end',
        loopId: 'review',
        startNodeId: 'loop-start',
        name: '循环判断',
        description: '',
        inputNodeIds: ['condition'],
        exitCondition: {
          type: 'llm_judgment',
          agentId: 'loop-end-agent',
          prompt: '是否结束循环',
          inputNodeIds: ['condition'],
        },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start-stage', source: 'start', target: 'stage', type: 'default' },
      { id: 'stage-condition', source: 'stage', target: 'condition', type: 'default' },
      {
        id: 'condition-loop',
        source: 'condition',
        target: 'loop-start',
        type: 'condition',
        condition: {
          type: 'llm_judgment',
          agentId: 'condition-agent',
          prompt: '是否进入循环',
          inputNodeIds: ['condition'],
        },
      },
      { id: 'loop-start-loop-end', source: 'loop-start', target: 'loop-end', type: 'default' },
      { id: 'loop-end-end', source: 'loop-end', target: 'end', type: 'default' },
      { id: 'loop-back', source: 'loop-end', target: 'loop-start', type: 'loop_back' },
    ],
  };
}

test('流程 Agent 扫描优先返回阶段 Agent 的中文错误', () => {
  const result = findUnavailableWorkflowAgent(makeGraph(), () => false);

  assert.equal(result, '流程 Agent “stage-agent”不存在、未启用或其 LLM 不可用');
});

test('流程 Agent 扫描覆盖条件边 Agent', () => {
  const result = findUnavailableWorkflowAgent(
    makeGraph(),
    agentId => agentId !== 'condition-agent',
  );

  assert.equal(result, '流程 Agent “condition-agent”不存在、未启用或其 LLM 不可用');
});

test('流程 Agent 扫描覆盖循环结束判断 Agent', () => {
  const result = findUnavailableWorkflowAgent(
    makeGraph(),
    agentId => agentId !== 'loop-end-agent',
  );

  assert.equal(result, '流程 Agent “loop-end-agent”不存在、未启用或其 LLM 不可用');
});

test('启用 Agent 且其 LLM 可用时流程 Agent 可用', () => {
  const agents: AgentConfig[] = [{
    id: 'available-agent',
    name: '可用 Agent',
    department: '研发',
    role: 'worker',
    llm: 'available-llm',
    systemPrompt: '',
    tools: [],
    enabled: true,
  }];

  const agentAvailable = workflowAgentAvailable(agents, llmId => llmId === 'available-llm');

  assert.equal(agentAvailable('available-agent'), true);
});

test('禁用、缺失 Agent 或 LLM 不可用时流程 Agent 不可用', () => {
  const agents: AgentConfig[] = [
    {
      id: 'disabled-agent',
      name: '禁用 Agent',
      department: '研发',
      role: 'worker',
      llm: 'available-llm',
      systemPrompt: '',
      tools: [],
      enabled: false,
    },
    {
      id: 'unavailable-llm-agent',
      name: 'LLM 不可用 Agent',
      department: '研发',
      role: 'worker',
      llm: 'unavailable-llm',
      systemPrompt: '',
      tools: [],
      enabled: true,
    },
  ];
  const agentAvailable = workflowAgentAvailable(agents, llmId => llmId === 'available-llm');

  assert.equal(agentAvailable('disabled-agent'), false);
  assert.equal(agentAvailable('missing-agent'), false);
  assert.equal(agentAvailable('unavailable-llm-agent'), false);
});
