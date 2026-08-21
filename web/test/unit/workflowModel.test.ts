import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkflowGraph } from '../../src/api/client.js';
import {
  addWorkflowConnection,
  createWorkflowGraph,
  fromReactFlow,
  getReachableUpstreamNodes,
  removeWorkflowNode,
  toReactFlow,
  validateWorkflowConnection,
  validateWorkflowDraft,
} from '../../src/features/workflows/workflowModel.js';

function graph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      {
        id: 'stage',
        type: 'stage',
        stage: 'build',
        name: '构建',
        description: '',
        agentId: 'builder',
        inputNodeIds: ['start'],
        prompt: '',
        position: { x: 160, y: 0 },
      },
      {
        id: 'condition',
        type: 'condition',
        name: '检查',
        description: '',
        inputNodeIds: ['stage'],
        position: { x: 320, y: 0 },
      },
      { id: 'end-ok', type: 'end', position: { x: 480, y: -80 } },
      { id: 'end-default', type: 'end', position: { x: 480, y: 80 } },
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

test('接收信息候选仅包含图上游节点并安全拒绝 hostile 节点 ID', () => {
  assert.deepEqual(getReachableUpstreamNodes(graph(), 'condition').map(node => node.id), ['start', 'stage']);
  for (const nodeId of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.deepEqual(getReachableUpstreamNodes(graph(), nodeId as never), []);
  }
});

test('草稿校验要求阶段 Agent 与条件 Agent', () => {
  const invalid = graph();
  const stage = invalid.nodes[1];
  assert.equal(stage?.type, 'stage');
  if (stage?.type !== 'stage') throw new Error('测试阶段缺失');
  stage.agentId = '';
  assert.match(validateWorkflowDraft(invalid).join('；'), /Agent/);

  stage.agentId = 'builder';
  const edge = invalid.edges[2];
  assert.equal(edge?.type, 'condition');
  if (edge?.type !== 'condition') throw new Error('测试条件出口缺失');
  edge.condition.inputNodeIds = ['start'];
  assert.match(validateWorkflowDraft(invalid).join('；'), /引用了未接收的信息/);
});

test('条件节点仅允许一至五个条件出口和一个默认出口', () => {
  const invalid = graph();
  const seed = invalid.edges[2];
  assert.equal(seed?.type, 'condition');
  if (seed?.type !== 'condition') throw new Error('测试条件出口缺失');
  for (let index = 1; index <= 5; index += 1) {
    invalid.nodes.push({ id: `end-${index}`, type: 'end' });
    invalid.edges.push({ ...structuredClone(seed), id: `extra-${index}`, target: `end-${index}` });
  }
  assert.match(validateWorkflowDraft(invalid).join('；'), /必须有一至五个条件出口/);
});

test('React Flow 往返保留 Agent、输入引用和条件配置', () => {
  const original = graph();
  const flow = toReactFlow(original);
  const restored = fromReactFlow(flow.nodes, flow.edges);
  assert.deepEqual(restored, original);
  assert.notStrictEqual(restored.nodes, original.nodes);
  assert.notStrictEqual(restored.edges, original.edges);
});

test('循环回线进入循环开始节点顶部中央 Handle', () => {
  const graph: WorkflowGraph = {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'loop-start', type: 'loop_start', loopId: 'loop-1', maxIterations: 3 },
      {
        id: 'loop-end',
        type: 'loop_end',
        loopId: 'loop-1',
        startNodeId: 'loop-start',
        name: '循环判断',
        description: '',
        inputNodeIds: [],
        exitCondition: {
          type: 'llm_judgment',
          agentId: 'reviewer',
          providerId: '',
          prompt: '是否结束',
          inputNodeIds: [],
        },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start-loop', source: 'start', target: 'loop-start', type: 'default' },
      { id: 'loop-end-start', source: 'loop-end', target: 'loop-start', type: 'loop_back' },
      { id: 'loop-end-end', source: 'loop-end', target: 'end', type: 'default' },
    ],
  };

  const flow = toReactFlow(graph);
  assert.equal(
    flow.edges.find(edge => edge.id === 'loop-end-start')?.targetHandle,
    'loop-top',
  );
});

test('连接拒绝自连、重复边和普通环', () => {
  const base = graph();
  assert.match(
    validateWorkflowConnection(base, { source: 'stage', target: 'stage', kind: 'default' }) ?? '',
    /自连/,
  );
  assert.match(
    validateWorkflowConnection(base, { source: 'start', target: 'stage', kind: 'default' }) ?? '',
    /重复/,
  );
  assert.match(
    validateWorkflowConnection(base, { source: 'condition', target: 'stage', kind: 'default' }) ?? '',
    /环/,
  );
});

test('新增条件连接显式保存 LLM 判断配置', () => {
  const base = createWorkflowGraph();
  const result = addWorkflowConnection(base, {
    source: 'start',
    target: 'end',
    kind: 'default',
  });
  assert.equal(result.error, '两个节点之间不允许重复边');
});

test('删除节点同步删除关联边并拒绝删除开始节点', () => {
  const removed = removeWorkflowNode(graph(), 'condition');
  assert.equal(removed.error, null);
  assert.ok(removed.graph.nodes.every(node => node.id !== 'condition'));
  assert.ok(removed.graph.edges.every(edge => edge.source !== 'condition' && edge.target !== 'condition'));
  assert.match(removeWorkflowNode(graph(), 'start').error ?? '', /开始节点不能删除/);
});

test('循环次数拒绝非固定选项和 hostile 输入', () => {
  for (const value of [undefined, -1, 0, 1, 2, 4, 101, '__proto__', 'constructor']) {
    const loop: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'loop-start', type: 'loop_start', loopId: 'a', maxIterations: value as never },
        { id: 'stage', type: 'stage', stage: 'a', name: '阶段', description: '', agentId: 'a', inputNodeIds: [], prompt: '' },
        { id: 'loop-end', type: 'loop_end', loopId: 'a', startNodeId: 'loop-start', name: '判断', description: '', inputNodeIds: ['stage'], exitCondition: { type: 'llm_judgment', agentId: 'a', providerId: '', prompt: '是否结束', inputNodeIds: ['stage'] } },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { id: 'a', source: 'start', target: 'loop-start', type: 'default' },
        { id: 'b', source: 'loop-start', target: 'stage', type: 'default' },
        { id: 'c', source: 'stage', target: 'loop-end', type: 'default' },
        { id: 'd', source: 'loop-end', target: 'loop-start', type: 'loop_back' },
        { id: 'e', source: 'loop-end', target: 'end', type: 'default' },
      ],
    };
    assert.match(validateWorkflowDraft(loop).join('；'), /循环次数/);
  }
});
