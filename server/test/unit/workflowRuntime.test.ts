import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkflowRuntime,
  resolveNextNode,
  resolveNextNodeAsync,
} from '../../src/workflows/runtime.js';
import type { WorkflowGraph } from '../../src/workflows/model.js';
import type { WorkflowRuntimeState } from '../../src/types/company.js';

function makeLinearGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'stage-prd',
        type: 'stage',
        stage: 'prd',
        name: '需求',
        description: '',
        agentId: 'product',
        inputNodeIds: [],
        prompt: '',
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: 'stage-prd', type: 'default' },
      { id: 'edge-end', source: 'stage-prd', target: 'end', type: 'default' },
    ],
  };
}

function makeConditionGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'condition', type: 'condition', name: '路由', description: '', inputNodeIds: [] },
      {
        id: 'stage-first',
        type: 'stage',
        stage: 'first',
        name: '第一分支',
        description: '',
        agentId: 'reviewer',
        inputNodeIds: [],
        prompt: '',
      },
      {
        id: 'stage-second',
        type: 'stage',
        stage: 'second',
        name: '第二分支',
        description: '',
        agentId: 'reviewer',
        inputNodeIds: [],
        prompt: '',
      },
      {
        id: 'stage-default',
        type: 'stage',
        stage: 'fallback',
        name: '默认分支',
        description: '',
        agentId: 'reviewer',
        inputNodeIds: [],
        prompt: '',
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: 'condition', type: 'default' },
      {
        id: 'edge-first',
        source: 'condition',
        target: 'stage-first',
        type: 'condition',
        condition: {
          type: 'llm_judgment',
          agentId: 'reviewer',
          prompt: '第一条件',
          inputNodeIds: [],
        },
      },
      {
        id: 'edge-second',
        source: 'condition',
        target: 'stage-second',
        type: 'condition',
        condition: {
          type: 'llm_judgment',
          agentId: 'reviewer',
          prompt: '第二条件',
          inputNodeIds: [],
        },
      },
      { id: 'edge-default', source: 'condition', target: 'stage-default', type: 'default' },
      { id: 'edge-first-end', source: 'stage-first', target: 'end', type: 'default' },
      { id: 'edge-second-end', source: 'stage-second', target: 'end', type: 'default' },
      { id: 'edge-default-end', source: 'stage-default', target: 'end', type: 'default' },
    ],
  };
}

function makeLoopGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'loop-start', type: 'loop_start', loopId: 'review', maxIterations: 3 },
      {
        id: 'work',
        type: 'stage',
        stage: 'review',
        name: '评审',
        description: '',
        agentId: 'reviewer',
        inputNodeIds: [],
        prompt: '',
      },
      {
        id: 'loop-end',
        type: 'loop_end',
        loopId: 'review',
        startNodeId: 'loop-start',
        name: '循环判断',
        description: '',
        inputNodeIds: ['work'],
        exitCondition: {
          type: 'llm_judgment',
          agentId: 'reviewer',
          prompt: '是否结束循环',
          inputNodeIds: ['work'],
        },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: 'loop-start', type: 'default' },
      { id: 'edge-enter', source: 'loop-start', target: 'work', type: 'default' },
      { id: 'edge-check', source: 'work', target: 'loop-end', type: 'default' },
      { id: 'edge-continue', source: 'loop-end', target: 'loop-start', type: 'loop_back' },
      { id: 'edge-exit', source: 'loop-end', target: 'end', type: 'default' },
    ],
  };
}

function makeRuntime(overrides: Partial<WorkflowRuntimeState> = {}): WorkflowRuntimeState {
  return {
    currentNodeId: 'loop-end',
    currentIteration: 0,
    nodeRuns: [],
    loopCounts: {},
    schedulerDecisions: [],
    ...overrides,
  };
}

test('createWorkflowRuntime 从唯一 start 初始化独立状态', () => {
  const graph = makeLinearGraph();

  const first = createWorkflowRuntime(graph);
  const second = createWorkflowRuntime(graph);

  assert.deepEqual(first, {
    currentNodeId: 'start',
    currentIteration: 0,
    nodeRuns: [],
    loopCounts: {},
    schedulerDecisions: [],
  });
  assert.deepEqual(second, first);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.nodeRuns, second.nodeRuns);
  assert.notStrictEqual(first.loopCounts, second.loopCounts);
});

test('start 和 stage 沿唯一默认出口推进', () => {
  const graph = makeLinearGraph();

  const fromStart = resolveNextNode(graph, 'start', {});
  assert.equal(fromStart?.edge.id, 'edge-start');
  assert.equal(fromStart?.targetNode.id, 'stage-prd');

  const fromStage = resolveNextNode(graph, 'stage-prd', {});
  assert.equal(fromStage?.edge.id, 'edge-end');
  assert.equal(fromStage?.targetNode.id, 'end');
});

test('condition 仅允许通过 resolveNextNodeAsync 解析', () => {
  assert.throws(
    () => resolveNextNode(makeConditionGraph(), 'condition', {}),
    /LLM 判断条件必须异步执行/,
  );
});

test('condition 条件依次否、否后走默认出口', async () => {
  const prompts: string[] = [];

  const transition = await resolveNextNodeAsync(
    makeConditionGraph(),
    'condition',
    {},
    undefined,
    {
      async matches(condition) {
        prompts.push(condition.prompt);
        return { matched: false, reason: `${condition.prompt} 未命中` };
      },
    },
  );

  assert.deepEqual(prompts, ['第一条件', '第二条件']);
  assert.equal(transition?.edge.id, 'edge-default');
  assert.equal(transition?.targetNode.id, 'stage-default');
  assert.equal(transition?.reason, '第二条件 未命中');
});

test('condition 首个条件否、第二个条件是时选择第二出口', async () => {
  const prompts: string[] = [];

  const transition = await resolveNextNodeAsync(
    makeConditionGraph(),
    'condition',
    {},
    undefined,
    {
      async matches(condition) {
        prompts.push(condition.prompt);
        return {
          matched: condition.prompt === '第二条件',
          reason: `${condition.prompt} ${condition.prompt === '第二条件' ? '命中' : '未命中'}`,
        };
      },
    },
  );

  assert.deepEqual(prompts, ['第一条件', '第二条件']);
  assert.equal(transition?.edge.id, 'edge-second');
  assert.equal(transition?.targetNode.id, 'stage-second');
  assert.equal(transition?.reason, '第二条件 命中');
});

test('loop_start 沿默认出口进入循环体', () => {
  const transition = resolveNextNode(makeLoopGraph(), 'loop-start', {});

  assert.equal(transition?.edge.id, 'edge-enter');
  assert.equal(transition?.targetNode.id, 'work');
});

test('loop_end 未退出时通过 loop_back 返回 loop_start 并增加轮次', async () => {
  const runtime = makeRuntime();

  const transition = await resolveNextNodeAsync(
    makeLoopGraph(),
    'loop-end',
    {},
    runtime,
    { async matches() { return { matched: false, reason: '继续循环' }; } },
  );

  assert.equal(transition?.edge.id, 'edge-continue');
  assert.equal(transition?.targetNode.id, 'loop-start');
  assert.deepEqual(transition?.loopCounts, { review: 1 });
  assert.equal(transition?.iteration, 1);
  assert.deepEqual(runtime.loopCounts, {});
});

test('loop_end LLM 判断退出时离开循环到 end', async () => {
  const transition = await resolveNextNodeAsync(
    makeLoopGraph(),
    'loop-end',
    {},
    makeRuntime({ currentIteration: 1, loopCounts: { review: 1 } }),
    { async matches() { return { matched: true, reason: '循环已完成' }; } },
  );

  assert.equal(transition?.edge.id, 'edge-exit');
  assert.equal(transition?.targetNode.id, 'end');
  assert.deepEqual(transition?.loopCounts, { review: 1 });
  assert.equal(transition?.reason, '循环已完成');
});

test('loop_end 到达上限后退出循环', async () => {
  const transition = await resolveNextNodeAsync(
    makeLoopGraph(),
    'loop-end',
    {},
    makeRuntime({ currentIteration: 3, loopCounts: { review: 3 } }),
    { async matches() { return { matched: false, reason: '继续循环' }; } },
  );

  assert.equal(transition?.edge.id, 'edge-exit');
  assert.equal(transition?.targetNode.id, 'end');
  assert.deepEqual(transition?.loopCounts, { review: 3 });
});

test('loop_end 的非法 runtime 轮次返回中文错误', async () => {
  for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '', '   ', '__proto__', 'constructor', {}, []]) {
    await assert.rejects(
      () => resolveNextNodeAsync(
        makeLoopGraph(),
        'loop-end',
        {},
        makeRuntime({ loopCounts: { review: count } } as unknown as Partial<WorkflowRuntimeState>),
        { async matches() { return { matched: false, reason: '继续循环' }; } },
      ),
      /循环判断节点“loop-end”的运行次数无效/,
      String(count),
    );
  }
});

test('end 节点没有下一节点', () => {
  assert.equal(resolveNextNode(makeLinearGraph(), 'end', {}), null);
});

test('不存在和 hostile nodeId 返回中文错误', () => {
  const graph = makeLinearGraph();
  for (const nodeId of ['missing', '', '   ', '__proto__', 'constructor']) {
    assert.throws(
      () => resolveNextNode(graph, nodeId, {}),
      new RegExp(`流程图节点“${nodeId}”不存在`),
    );
  }
});

test('出口目标不存在时返回中文错误', () => {
  const graph = makeLinearGraph();
  graph.edges[0] = {
    id: 'edge-broken',
    source: 'start',
    target: 'missing',
    type: 'default',
  };

  assert.throws(
    () => resolveNextNode(graph, 'start', {}),
    /边“edge-broken”的目标节点“missing”不存在/,
  );
});
