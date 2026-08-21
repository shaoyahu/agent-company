import type { WorkflowNodeControlResult, WorkflowRuntimeState } from '../types/company.js';
import { validateWorkflowGraph } from './graph.js';
import type { LlmCondition, WorkflowConditionContext, WorkflowEdge, WorkflowGraph, WorkflowNode } from './model.js';

export interface WorkflowTransition {
  edge: WorkflowEdge;
  targetNode: WorkflowNode;
  loopCounts?: Record<string, number>;
  iteration?: number;
  reason?: string;
  controlResult?: WorkflowNodeControlResult;
}

export interface LlmConditionMatcher {
  matches(condition: LlmCondition): Promise<{
    matched: boolean;
    reason: string;
    controlResult?: WorkflowNodeControlResult;
  }>;
}

export function createWorkflowRuntime(graph: WorkflowGraph): WorkflowRuntimeState {
  validateWorkflowGraph(graph);
  const start = graph.nodes.find(node => node.type === 'start');
  if (!start) throw new Error('流程图缺少 start 节点');
  return {
    currentNodeId: start.id,
    currentIteration: 0,
    nodeRuns: [],
    loopCounts: {},
    schedulerDecisions: [],
  };
}

function transitionForEdge(graph: WorkflowGraph, edge: WorkflowEdge): WorkflowTransition {
  const targetNode = graph.nodes.find(node => node.id === edge.target);
  if (!targetNode) throw new Error(`边“${edge.id}”的目标节点“${edge.target}”不存在`);
  return { edge, targetNode };
}

function singleTransition(graph: WorkflowGraph, node: WorkflowNode): WorkflowTransition {
  const outgoing = graph.edges.filter(edge => edge.source === node.id);
  if (outgoing.length !== 1 || outgoing[0]?.type !== 'default') throw new Error(`节点“${node.id}”必须有且仅有一个默认出口`);
  return transitionForEdge(graph, outgoing[0]);
}

function resolveLoopTransition(
  graph: WorkflowGraph,
  node: Extract<WorkflowNode, { type: 'loop_end' }>,
  runtime: WorkflowRuntimeState,
  shouldExit: boolean,
): WorkflowTransition {
  const start = graph.nodes.find(
    (item): item is Extract<WorkflowNode, { type: 'loop_start' }> => (
      item.id === node.startNodeId && item.type === 'loop_start'
    ),
  );
  if (!start) throw new Error(`循环判断节点“${node.id}”找不到对应的循环开始节点`);
  const count = runtime.loopCounts[start.loopId] ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`循环判断节点“${node.id}”的运行次数无效`);
  const outgoing = graph.edges.filter(edge => edge.source === node.id);
  const exit = outgoing.find(edge => edge.type === 'default');
  const back = outgoing.find(edge => edge.type === 'loop_back');
  if (!exit || !back) throw new Error(`循环判断节点“${node.id}”缺少退出或返回出口`);
  if (shouldExit || (start.maxIterations !== null && count >= start.maxIterations)) {
    return {
      ...transitionForEdge(graph, exit),
      loopCounts: { ...runtime.loopCounts },
      iteration: 0,
      ...(shouldExit ? {} : { reason: `已达到循环次数上限 ${start.maxIterations}` }),
    };
  }
  const nextIteration = count + 1;
  return {
    ...transitionForEdge(graph, back),
    loopCounts: { ...runtime.loopCounts, [start.loopId]: nextIteration },
    iteration: nextIteration,
  };
}

export function resolveNextNode(
  graph: WorkflowGraph,
  nodeId: string,
  _context: WorkflowConditionContext,
  runtime?: WorkflowRuntimeState,
): WorkflowTransition | null {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error(`流程图节点“${nodeId}”不存在`);
  if (node.type === 'end') return null;
  if (node.type === 'start' || node.type === 'stage' || node.type === 'loop_start') return singleTransition(graph, node);
  if (node.type === 'condition' || node.type === 'loop_end') {
    if (!runtime && node.type === 'loop_end') throw new Error(`循环判断节点“${node.id}”缺少运行时状态`);
    throw new Error('LLM 判断条件必须异步执行');
  }
  const unsupported: never = node;
  throw new Error(`节点类型无效：${unsupported}`);
}

export async function resolveNextNodeAsync(
  graph: WorkflowGraph,
  nodeId: string,
  context: WorkflowConditionContext,
  runtime: WorkflowRuntimeState | undefined,
  llmMatcher: LlmConditionMatcher,
): Promise<WorkflowTransition | null> {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error(`流程图节点“${nodeId}”不存在`);
  if (node.type === 'condition') {
    const outgoing = graph.edges.filter(edge => edge.source === node.id);
    let reason: string | undefined;
    for (const edge of outgoing) {
      if (edge.type !== 'condition') continue;
      const result = await llmMatcher.matches(edge.condition);
      if (result.matched) return { ...transitionForEdge(graph, edge), reason: result.reason, controlResult: result.controlResult };
      reason = result.reason;
    }
    const fallback = outgoing.find(edge => edge.type === 'default');
    if (!fallback) throw new Error(`条件节点“${node.id}”缺少默认出口`);
    return { ...transitionForEdge(graph, fallback), ...(reason ? { reason } : {}) };
  }
  if (node.type === 'loop_end') {
    if (!runtime) throw new Error(`循环判断节点“${node.id}”缺少运行时状态`);
    const result = await llmMatcher.matches(node.exitCondition);
    return {
      ...resolveLoopTransition(graph, node, runtime, result.matched),
      controlResult: result.controlResult,
      reason: result.reason,
    };
  }
  return resolveNextNode(graph, nodeId, context, runtime);
}
