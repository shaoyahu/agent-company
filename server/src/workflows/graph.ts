import type { WorkflowTaskTemplate } from '../types/company.js';
import type {
  LlmCondition,
  WorkflowCondition,
  WorkflowConditionContext,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from './model.js';

const LOOP_ITERATION_LIMITS = new Set([3, 10, 20, 40, 100]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function inputIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonBlankString) : [];
}

function position(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') return undefined;
  return { x: value.x, y: value.y };
}

function maxIterations(value: unknown): 3 | 10 | 20 | 40 | 100 | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  if (LOOP_ITERATION_LIMITS.has(value)) return value as 3 | 10 | 20 | 40 | 100;
  if (value <= 3) return 3;
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 40) return 40;
  return 100;
}

function normalizeLlmCondition(value: unknown): LlmCondition {
  const raw = isRecord(value) ? value : {};
  return {
    type: 'llm_judgment',
    agentId: typeof raw.agentId === 'string' ? raw.agentId : '',
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    inputNodeIds: inputIds(raw.inputNodeIds),
  };
}

type LegacyLoop = {
  id: string;
  startId: string;
  targetNodeId: string;
};

/**
 * 唯一的旧图读取边界。返回值只含当前 Agent 驱动 schema；迁移后缺失 Agent
 * 会由严格校验拒绝保存或启动，绝不伪造可执行配置。
 */
export function normalizeWorkflowGraph(value: unknown): WorkflowGraph {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('流程图必须包含 version=1、nodes 数组和 edges 数组');
  }

  const legacyLoops = new Map<string, LegacyLoop>();
  const nodes: WorkflowNode[] = [];
  for (const [index, rawValue] of value.nodes.entries()) {
    if (!isRecord(rawValue) || !isNonBlankString(rawValue.id) || !isNonBlankString(rawValue.type)) {
      throw new Error(`第 ${index + 1} 个流程图节点格式无效`);
    }
    const base = { id: rawValue.id, ...(position(rawValue.position) ? { position: position(rawValue.position) } : {}) };
    switch (rawValue.type) {
      case 'start':
      case 'end':
        nodes.push({ ...base, type: rawValue.type });
        break;
      case 'stage': {
        const templates = Array.isArray(rawValue.templates) ? rawValue.templates : [];
        const legacyPrompt = templates
          .filter(isRecord)
          .map(item => typeof item.promptTemplate === 'string' ? item.promptTemplate : '')
          .filter(Boolean)
          .join('\n\n');
        nodes.push({
          ...base,
          type: 'stage',
          stage: isNonBlankString(rawValue.stage) ? rawValue.stage : rawValue.id,
          name: isNonBlankString(rawValue.name) ? rawValue.name : (isNonBlankString(rawValue.stage) ? rawValue.stage : rawValue.id),
          description: typeof rawValue.description === 'string' ? rawValue.description : '',
          agentId: typeof rawValue.agentId === 'string' ? rawValue.agentId : '',
          inputNodeIds: inputIds(rawValue.inputNodeIds),
          prompt: typeof rawValue.prompt === 'string' ? rawValue.prompt : legacyPrompt,
        });
        break;
      }
      case 'condition':
      case 'scheduler_approval':
        nodes.push({
          ...base,
          type: 'condition',
          name: isNonBlankString(rawValue.name) ? rawValue.name : rawValue.type === 'scheduler_approval' ? '审批判断' : rawValue.id,
          description: typeof rawValue.description === 'string' ? rawValue.description : '',
          inputNodeIds: inputIds(rawValue.inputNodeIds),
        });
        break;
      case 'loop_start':
        nodes.push({
          ...base,
          type: 'loop_start',
          loopId: isNonBlankString(rawValue.loopId) ? rawValue.loopId : rawValue.id,
          maxIterations: maxIterations(rawValue.maxIterations),
        });
        break;
      case 'loop_end':
        nodes.push({
          ...base,
          type: 'loop_end',
          loopId: isNonBlankString(rawValue.loopId) ? rawValue.loopId : rawValue.id,
          startNodeId: isNonBlankString(rawValue.startNodeId) ? rawValue.startNodeId : '',
          name: isNonBlankString(rawValue.name) ? rawValue.name : '循环判断',
          description: typeof rawValue.description === 'string' ? rawValue.description : '',
          inputNodeIds: inputIds(rawValue.inputNodeIds),
          exitCondition: normalizeLlmCondition(rawValue.exitCondition),
        });
        break;
      case 'loop': {
        const startId = `${rawValue.id}-start`;
        const loopId = rawValue.id;
        legacyLoops.set(rawValue.id, {
          id: rawValue.id,
          startId,
          targetNodeId: isNonBlankString(rawValue.targetNodeId) ? rawValue.targetNodeId : '',
        });
        nodes.push({
          id: startId,
          type: 'loop_start',
          loopId,
          maxIterations: maxIterations(rawValue.maxIterations),
          ...(position(rawValue.position) ? { position: position(rawValue.position) } : {}),
        });
        nodes.push({
          ...base,
          type: 'loop_end',
          loopId,
          startNodeId: startId,
          name: isNonBlankString(rawValue.name) ? rawValue.name : '循环判断',
          description: typeof rawValue.description === 'string' ? rawValue.description : '',
          inputNodeIds: inputIds(rawValue.inputNodeIds),
          exitCondition: normalizeLlmCondition(rawValue.exitCondition),
        });
        break;
      }
      default:
        throw new Error(`不支持的流程图节点类型：${rawValue.type}`);
    }
  }

  const edges: WorkflowEdge[] = [];
  for (const [index, rawValue] of value.edges.entries()) {
    if (!isRecord(rawValue) || !isNonBlankString(rawValue.id) || !isNonBlankString(rawValue.source) || !isNonBlankString(rawValue.target)) {
      throw new Error(`第 ${index + 1} 条流程图边格式无效`);
    }
    const targetLoop = [...legacyLoops.values()].find(loop => (
      rawValue.type !== 'loop_back' && rawValue.target === loop.targetNodeId
    ));
    const source = rawValue.source;
    const target = targetLoop?.startId ?? rawValue.target;
    const base = {
      id: rawValue.id,
      source,
      target,
      ...(typeof rawValue.label === 'string' ? { label: rawValue.label } : {}),
    };
    if (rawValue.type === 'condition' || rawValue.type === 'approved') {
      edges.push({ ...base, type: 'condition', condition: normalizeLlmCondition(rawValue.condition) });
    } else if (rawValue.type === 'loop_back') {
      const legacy = legacyLoops.get(source);
      edges.push({
        ...base,
        source,
        target: legacy?.startId ?? rawValue.target,
        type: 'loop_back',
      });
    } else {
      edges.push({ ...base, type: 'default' });
    }
  }

  for (const loop of legacyLoops.values()) {
    if (!isNonBlankString(loop.targetNodeId)) continue;
    edges.push({
      id: `${loop.id}-enter`,
      source: loop.startId,
      target: loop.targetNodeId,
      type: 'default',
    });
  }
  return { version: 1, nodes, edges };
}

function errorsForGraph(graph: WorkflowGraph): string[] {
  const errors: string[] = [];
  if (!isRecord(graph) || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return ['流程图必须包含 version=1、nodes 数组和 edges 数组'];
  }
  const nodes = graph.nodes;
  const edges = graph.edges;
  const nodesById = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (!isNonBlankString(node.id)) {
      errors.push('节点 ID 不能为空');
      continue;
    }
    if (nodesById.has(node.id)) errors.push(`存在重复的节点 ID“${node.id}”`);
    nodesById.set(node.id, node);
    if (node.type === 'stage') {
      if (!isNonBlankString(node.stage) || !isNonBlankString(node.name)) errors.push(`阶段节点“${node.id}”的标识和名称不能为空`);
      if (!isNonBlankString(node.agentId)) errors.push(`阶段节点“${node.id}”必须选择 Agent`);
      if (!Array.isArray(node.inputNodeIds) || node.inputNodeIds.some(id => !isNonBlankString(id))) errors.push(`阶段节点“${node.id}”的接收信息必须是节点 ID 数组`);
    }
    if (node.type === 'condition') {
      if (!isNonBlankString(node.name)) errors.push(`条件节点“${node.id}”的名称不能为空`);
      if (!Array.isArray(node.inputNodeIds) || node.inputNodeIds.some(id => !isNonBlankString(id))) errors.push(`条件节点“${node.id}”的接收信息必须是节点 ID 数组`);
    }
    if (node.type === 'loop_start') {
      if (!isNonBlankString(node.loopId) || !LOOP_ITERATION_LIMITS.has(node.maxIterations ?? -1) && node.maxIterations !== null) {
        errors.push(`循环开始节点“${node.id}”的循环次数无效`);
      }
    }
    if (node.type === 'loop_end') {
      if (!isNonBlankString(node.loopId) || !isNonBlankString(node.startNodeId) || !isNonBlankString(node.name)) errors.push(`循环判断节点“${node.id}”的配置无效`);
      if (!Array.isArray(node.inputNodeIds) || node.inputNodeIds.some(id => !isNonBlankString(id))) errors.push(`循环判断节点“${node.id}”的接收信息必须是节点 ID 数组`);
      validateCondition(node.exitCondition, `循环判断节点“${node.id}”`, errors);
    }
  }
  if (nodes.filter(node => node.type === 'start').length !== 1) errors.push('流程图必须恰好有一个 start 节点');
  if (nodes.filter(node => node.type === 'end').length < 1) errors.push('流程图至少需要一个 end 节点');

  const edgesBySource = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (!isNonBlankString(edge.id) || !isNonBlankString(edge.source) || !isNonBlankString(edge.target)) {
      errors.push('边 ID、起点和终点不能为空');
      continue;
    }
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) errors.push(`边“${edge.id}”引用了不存在的节点`);
    if (edge.type === 'condition') validateCondition(edge.condition, `条件边“${edge.id}”`, errors);
    if (edge.type === 'loop_back') {
      const source = nodesById.get(edge.source);
      if (!source || source.type !== 'loop_end') errors.push(`loop_back 边“${edge.id}”必须从循环判断节点发出`);
    }
    const sourceEdges = edgesBySource.get(edge.source) ?? [];
    sourceEdges.push(edge);
    edgesBySource.set(edge.source, sourceEdges);
  }

  for (const node of nodes) {
    const outgoing = edgesBySource.get(node.id) ?? [];
    if ((node.type === 'start' || node.type === 'stage' || node.type === 'loop_start') && (outgoing.length !== 1 || outgoing[0]?.type !== 'default')) {
      errors.push(`节点“${node.id}”必须有且仅有一个默认出口`);
    }
    if (node.type === 'condition') {
      const conditions = outgoing.filter(edge => edge.type === 'condition').length;
      const defaults = outgoing.filter(edge => edge.type === 'default').length;
      if (conditions < 1 || conditions > 5 || defaults !== 1 || outgoing.length !== conditions + defaults) errors.push(`条件节点“${node.id}”必须有一至五个条件出口和一个默认出口`);
    }
    if (node.type === 'loop_end') {
      if (outgoing.filter(edge => edge.type === 'default').length !== 1 || outgoing.filter(edge => edge.type === 'loop_back').length !== 1 || outgoing.length !== 2) errors.push(`循环判断节点“${node.id}”必须各有一个默认和循环回边出口`);
    }
    if (node.type === 'end' && outgoing.length > 0) errors.push(`结束节点“${node.id}”不能有出口`);
  }

  const normalEdges = edges.filter(edge => edge.type !== 'loop_back');
  const incoming = new Map<string, string[]>();
  for (const edge of normalEdges) {
    const values = incoming.get(edge.target) ?? [];
    values.push(edge.source);
    incoming.set(edge.target, values);
  }
  for (const node of nodes) {
    if (node.type !== 'stage' && node.type !== 'condition' && node.type !== 'loop_end') continue;
    const upstream = new Set<string>();
    const pending = [...(incoming.get(node.id) ?? [])];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || upstream.has(current)) continue;
      upstream.add(current);
      pending.push(...(incoming.get(current) ?? []));
    }
    for (const inputNodeId of Array.isArray(node.inputNodeIds) ? node.inputNodeIds : []) {
      if (!upstream.has(inputNodeId)) errors.push(`节点“${node.id}”的接收信息“${inputNodeId}”不是图上游节点`);
    }
  }
  for (const edge of edges) {
    if (edge.type !== 'condition') continue;
    const source = nodesById.get(edge.source);
    if (!source || source.type !== 'condition') continue;
    const accepted = new Set(source.inputNodeIds);
    for (const inputNodeId of edge.condition.inputNodeIds) {
      if (!accepted.has(inputNodeId)) errors.push(`条件边“${edge.id}”引用了未接收的信息`);
    }
  }

  const starts = nodes.filter((node): node is Extract<WorkflowNode, { type: 'loop_start' }> => node.type === 'loop_start');
  const ends = nodes.filter((node): node is Extract<WorkflowNode, { type: 'loop_end' }> => node.type === 'loop_end');
  for (const start of starts) {
    const end = ends.filter(item => item.loopId === start.loopId);
    if (end.length !== 1 || end[0]?.startNodeId !== start.id) errors.push(`循环开始节点“${start.id}”必须匹配唯一循环判断节点`);
  }
  for (const end of ends) {
    const start = nodesById.get(end.startNodeId);
    if (!start || start.type !== 'loop_start' || start.loopId !== end.loopId) errors.push(`循环判断节点“${end.id}”引用的循环开始节点无效`);
    if (!edges.some(edge => edge.type === 'loop_back' && edge.source === end.id && edge.target === end.startNodeId)) errors.push(`循环判断节点“${end.id}”缺少回到循环开始节点的回边`);
  }
  return [...new Set(errors)];
}

function validateCondition(condition: LlmCondition, label: string, errors: string[]): void {
  if (!isRecord(condition) || condition.type !== 'llm_judgment') {
    errors.push(`${label}必须使用 LLM 判断`);
    return;
  }
  if (!isNonBlankString(condition.agentId)) errors.push(`${label}的 agentId 不能为空`);
  if (!isNonBlankString(condition.prompt)) errors.push(`${label}的 prompt 不能为空`);
  if (!Array.isArray(condition.inputNodeIds) || condition.inputNodeIds.some(id => !isNonBlankString(id))) errors.push(`${label}的 inputNodeIds 必须是节点 ID 数组`);
}

export function validateWorkflowGraph(graph: WorkflowGraph): void {
  const errors = errorsForGraph(graph);
  if (errors.length > 0) throw new Error(errors.join('；'));
}

export function getReachableUpstreamNodeIds(graph: WorkflowGraph, nodeId: string): string[] {
  if (!isNonBlankString(nodeId)) return [];
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type === 'loop_back') continue;
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }
  const result = new Set<string>();
  const pending = [...(incoming.get(nodeId) ?? [])];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || result.has(current)) continue;
    result.add(current);
    pending.push(...(incoming.get(current) ?? []));
  }
  return graph.nodes.filter(node => result.has(node.id)).map(node => node.id);
}

export function linearWorkflowToGraph(
  stages: string[],
  templates: Record<string, WorkflowTaskTemplate[]>,
): WorkflowGraph {
  if (!Array.isArray(stages) || !isRecord(templates)) throw new Error('旧流程配置格式无效');
  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start' },
    ...stages.map((stage, index) => ({
      id: `stage-${index}`,
      type: 'stage' as const,
      stage,
      name: stage,
      description: '',
      agentId: '',
      inputNodeIds: [],
      prompt: '',
    })),
    { id: 'end', type: 'end' },
  ];
  return {
    version: 1,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `edge-${index}`,
      source: node.id,
      target: nodes[index + 1]!.id,
      type: 'default' as const,
    })),
  };
}

export function evaluateWorkflowCondition(
  _condition: WorkflowCondition,
  _context: WorkflowConditionContext,
): boolean {
  throw new Error('LLM 判断条件必须异步执行');
}
