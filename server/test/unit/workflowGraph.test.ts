import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { WorkflowGraph } from '../../src/workflows/model.js';
import {
  getReachableUpstreamNodeIds,
  normalizeWorkflowGraph,
  validateWorkflowGraph,
} from '../../src/workflows/graph.js';

function graph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'stage',
        type: 'stage',
        stage: 'build',
        name: '构建',
        description: '',
        agentId: 'builder',
        inputNodeIds: ['start'],
        prompt: '',
      },
      {
        id: 'condition',
        type: 'condition',
        name: '检查',
        description: '',
        inputNodeIds: ['stage'],
      },
      { id: 'end-ok', type: 'end' },
      { id: 'end-default', type: 'end' },
    ],
    edges: [
      { id: 'start-stage', source: 'start', target: 'stage', type: 'default' },
      { id: 'stage-condition', source: 'stage', target: 'condition', type: 'default' },
      {
        id: 'condition-ok',
        source: 'condition',
        target: 'end-ok',
        type: 'condition',
        condition: {
          type: 'llm_judgment',
          agentId: 'reviewer',
          providerId: '',
          prompt: '是否通过',
          inputNodeIds: ['stage'],
        },
      },
      { id: 'condition-default', source: 'condition', target: 'end-default', type: 'default' },
    ],
  };
}

describe('Agent 流程图校验', () => {
  test('合法 Agent 阶段和条件出口通过', () => {
    assert.doesNotThrow(() => validateWorkflowGraph(graph()));
  });

  test('阶段 Agent 必填，接收信息必须是上游节点', () => {
    const invalidAgent = graph();
    const stage = invalidAgent.nodes[1];
    assert.equal(stage?.type, 'stage');
    if (stage?.type !== 'stage') throw new Error('测试阶段缺失');
    stage.agentId = '';
    assert.throws(() => validateWorkflowGraph(invalidAgent), /必须选择 Agent/);

    const invalidInput = graph();
    const inputStage = invalidInput.nodes[1];
    assert.equal(inputStage?.type, 'stage');
    if (inputStage?.type !== 'stage') throw new Error('测试阶段缺失');
    inputStage.inputNodeIds = ['end-ok'];
    assert.throws(() => validateWorkflowGraph(invalidInput), /不是图上游节点/);
  });

  test('条件出口要求 Agent、提示词且引用为接收信息子集', () => {
    const invalid = graph();
    const edge = invalid.edges[2];
    assert.equal(edge?.type, 'condition');
    if (edge?.type !== 'condition') throw new Error('测试条件出口缺失');
    edge.condition.agentId = '';
    assert.throws(() => validateWorkflowGraph(invalid), /agentId 不能为空/);

    edge.condition.agentId = 'reviewer';
    edge.condition.inputNodeIds = ['start'];
    assert.throws(() => validateWorkflowGraph(invalid), /引用了未接收的信息/);
  });

  test('条件节点要求一至五个条件出口和一个默认出口', () => {
    const invalid = graph();
    const base = invalid.edges[2];
    assert.equal(base?.type, 'condition');
    if (base?.type !== 'condition') throw new Error('测试条件出口缺失');
    for (let index = 1; index <= 5; index += 1) {
      invalid.nodes.push({ id: `end-${index}`, type: 'end' });
      invalid.edges.push({
        ...structuredClone(base),
        id: `condition-${index}`,
        target: `end-${index}`,
      });
    }
    assert.throws(() => validateWorkflowGraph(invalid), /必须有一至五个条件出口/);
  });

  test('配对循环只接受固定次数或不限次数', () => {
    const makeLoop = (maxIterations: unknown) => ({
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'loop-start', type: 'loop_start', loopId: 'review', maxIterations },
        { id: 'stage', type: 'stage', stage: 'review', name: '评审', description: '', agentId: 'reviewer', inputNodeIds: [], prompt: '' },
        {
          id: 'loop-end',
          type: 'loop_end',
          loopId: 'review',
          startNodeId: 'loop-start',
          name: '循环判断',
          description: '',
          inputNodeIds: ['stage'],
          exitCondition: { type: 'llm_judgment', agentId: 'reviewer', providerId: '', prompt: '是否结束', inputNodeIds: ['stage'] },
        },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { id: 'start-loop', source: 'start', target: 'loop-start', type: 'default' },
        { id: 'loop-stage', source: 'loop-start', target: 'stage', type: 'default' },
        { id: 'stage-end', source: 'stage', target: 'loop-end', type: 'default' },
        { id: 'back', source: 'loop-end', target: 'loop-start', type: 'loop_back' },
        { id: 'exit', source: 'loop-end', target: 'end', type: 'default' },
      ],
    }) as WorkflowGraph;
    for (const count of [3, 10, 20, 40, 100, null]) {
      assert.doesNotThrow(() => validateWorkflowGraph(makeLoop(count)), String(count));
    }
    for (const count of [undefined, -1, 0, 1, 2, 4, 101, '3', '__proto__']) {
      assert.throws(() => validateWorkflowGraph(makeLoop(count)), /循环次数/);
    }
  });

  test('上游查找与 hostile 节点 ID 安全', () => {
    assert.deepEqual(getReachableUpstreamNodeIds(graph(), 'condition'), ['start', 'stage']);
    for (const id of [undefined, null, '', '   ', '__proto__', 'constructor']) {
      assert.deepEqual(getReachableUpstreamNodeIds(graph(), id as never), []);
    }
  });
});

describe('旧图规范化', () => {
  test('旧模板阶段变为待选 Agent 的阶段节点', () => {
    const normalized = normalizeWorkflowGraph({
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'stage',
          type: 'stage',
          stage: 'prd',
          templates: [{ title: '写 PRD', promptTemplate: '产出需求文档' }],
        },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { id: 'start-stage', source: 'start', target: 'stage', type: 'default' },
        { id: 'stage-end', source: 'stage', target: 'end', type: 'default' },
      ],
    });
    const stage = normalized.nodes.find(node => node.id === 'stage');
    assert.equal(stage?.type, 'stage');
    if (stage?.type !== 'stage') throw new Error('迁移阶段缺失');
    assert.equal(stage.agentId, '');
    assert.equal(stage.prompt, '产出需求文档');
    assert.deepEqual(stage.inputNodeIds, []);
    assert.throws(() => validateWorkflowGraph(normalized), /必须选择 Agent/);
  });

  test('旧审批迁移为条件节点、条件出口和默认出口', () => {
    const normalized = normalizeWorkflowGraph({
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'approval', type: 'scheduler_approval', providerId: 'old-provider', prompt: '审批' },
        { id: 'ok', type: 'end' },
        { id: 'fallback', type: 'end' },
      ],
      edges: [
        { id: 'enter', source: 'start', target: 'approval', type: 'default' },
        { id: 'approved', source: 'approval', target: 'ok', type: 'approved' },
        { id: 'rejected', source: 'approval', target: 'fallback', type: 'rejected' },
      ],
    });
    const node = normalized.nodes.find(item => item.id === 'approval');
    assert.equal(node?.type, 'condition');
    const output = normalized.edges.find(edge => edge.id === 'approved');
    assert.equal(output?.type, 'condition');
    const fallback = normalized.edges.find(edge => edge.id === 'rejected');
    assert.equal(fallback?.type, 'default');
    assert.throws(() => validateWorkflowGraph(normalized), /agentId 不能为空/);
  });
});
