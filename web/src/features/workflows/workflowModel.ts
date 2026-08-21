import type { Edge, Node } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { WorkflowCondition, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../api/client';

export type WorkflowNodeData = { workflowNode: WorkflowNode };
export type WorkflowEdgeData = { workflowEdge: WorkflowEdge };
export type WorkflowFlowNode = Node<WorkflowNodeData, 'workflow'>;
export type WorkflowFlowEdge = Edge<WorkflowEdgeData, 'smoothstep'> & {
  selectable?: boolean;
  deletable?: boolean;
};

export interface WorkflowConnectionDraft {
  source: string;
  target: string;
  kind: WorkflowEdge['type'];
  condition?: WorkflowCondition;
}

const LOOP_LIMITS = new Set([3, 10, 20, 40, 100]);
const NODE_WIDTH = 220;
const NODE_HEIGHT = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function cloneWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  return clone(graph);
}

export function getReachableUpstreamNodes(graph: WorkflowGraph, nodeId: string): WorkflowNode[] {
  if (!isNonBlank(nodeId)) return [];
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type === 'loop_back') continue;
    const items = incoming.get(edge.target) ?? [];
    items.push(edge.source);
    incoming.set(edge.target, items);
  }
  const ids = new Set<string>();
  const pending = [...(incoming.get(nodeId) ?? [])];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    pending.push(...(incoming.get(id) ?? []));
  }
  return graph.nodes.filter(node => ids.has(node.id));
}

function edgeSourceHandle(edge: WorkflowEdge, source: WorkflowNode | undefined, graph: WorkflowGraph): string {
  if (edge.type === 'loop_back') return 'loop_back';
  if (edge.type === 'condition') {
    const index = graph.edges.filter(item => item.source === edge.source && item.type === 'condition').findIndex(item => item.id === edge.id);
    return `condition-${index + 1}`;
  }
  return source?.type === 'loop_end' ? 'default' : 'default';
}

export function toReactFlow(graph: WorkflowGraph): { nodes: WorkflowFlowNode[]; edges: WorkflowFlowEdge[] } {
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  return {
    nodes: graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'workflow',
      position: node.position ? clone(node.position) : { x: index * 300, y: 80 },
      data: { workflowNode: clone(node) },
      draggable: node.type !== 'start',
      deletable: node.type !== 'start',
    })),
    edges: graph.edges.map((edge) => {
      const loopBack = edge.type === 'loop_back';
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edgeSourceHandle(edge, nodesById.get(edge.source), graph),
        targetHandle: loopBack && nodesById.get(edge.target)?.type === 'loop_start' ? 'loop-top' : 'target',
        type: 'smoothstep',
        label: edge.label,
        data: { workflowEdge: clone(edge) },
        selectable: !loopBack,
        deletable: !loopBack,
        className: loopBack ? 'workflow-edge--loop-back' : undefined,
      };
    }),
  };
}

export function fromReactFlow(nodes: WorkflowFlowNode[], edges: WorkflowFlowEdge[]): WorkflowGraph {
  return {
    version: 1,
    nodes: nodes.map(node => {
      if (!isRecord(node.data) || !isRecord(node.data.workflowNode)) throw new Error(`React Flow 节点“${node.id}”缺少领域数据`);
      return { ...clone(node.data.workflowNode as WorkflowNode), id: node.id, position: { x: node.position.x, y: node.position.y } };
    }),
    edges: edges.map(edge => {
      if (!isRecord(edge.data) || !isRecord(edge.data.workflowEdge)) throw new Error(`React Flow 边“${edge.id}”缺少领域数据`);
      return { ...clone(edge.data.workflowEdge as WorkflowEdge), id: edge.id, source: edge.source, target: edge.target };
    }),
  };
}

export function createWorkflowGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 } }, { id: 'end', type: 'end', position: { x: 360, y: 0 } }],
    edges: [{ id: 'start-end', source: 'start', target: 'end', type: 'default' }],
  };
}

function validateCondition(condition: unknown, label: string, errors: string[]): condition is WorkflowCondition {
  if (!isRecord(condition) || condition.type !== 'llm_judgment') {
    errors.push(`${label}必须使用 LLM 判断`);
    return false;
  }
  if (!isNonBlank(condition.agentId)) errors.push(`${label}必须选择 Agent`);
  if (!isNonBlank(condition.prompt)) errors.push(`${label}的提示词不能为空`);
  if (!Array.isArray(condition.inputNodeIds) || condition.inputNodeIds.some(id => !isNonBlank(id))) errors.push(`${label}的接收信息无效`);
  return true;
}

export function validateWorkflowDraft(graph: WorkflowGraph): string[] {
  if (!isRecord(graph) || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return ['流程图必须包含 version=1、nodes 数组和 edges 数组'];
  const errors: string[] = [];
  const ids = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (!isNonBlank(node.id)) { errors.push('节点 ID 不能为空'); continue; }
    if (ids.has(node.id)) errors.push(`存在重复的节点 ID“${node.id}”`);
    ids.set(node.id, node);
    if (node.type === 'stage' && (!isNonBlank(node.name) || !isNonBlank(node.stage) || !isNonBlank(node.agentId))) errors.push(`阶段节点“${node.id}”必须填写名称、标识和 Agent`);
    if (node.type === 'condition' && !isNonBlank(node.name)) errors.push(`条件节点“${node.id}”的名称不能为空`);
    if (node.type === 'loop_start' && (!isNonBlank(node.loopId) || (node.maxIterations !== null && !LOOP_LIMITS.has(node.maxIterations)))) errors.push(`循环开始节点“${node.id}”的循环次数无效`);
    if (node.type === 'loop_end') validateCondition(node.exitCondition, `循环判断节点“${node.id}”`, errors);
  }
  if (graph.nodes.filter(node => node.type === 'start').length !== 1) errors.push('流程图必须恰好有一个 start 节点');
  if (graph.nodes.filter(node => node.type === 'end').length < 1) errors.push('流程图至少需要一个 end 节点');
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    if (!isNonBlank(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) errors.push(`边“${edge.id}”引用了不存在的节点`);
    if (edge.type === 'condition') validateCondition(edge.condition, `条件边“${edge.id}”`, errors);
    if (edge.type === 'loop_back' && ids.get(edge.source)?.type !== 'loop_end') errors.push(`loop_back 边“${edge.id}”必须从循环判断节点发出`);
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }
  for (const node of graph.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if ((node.type === 'start' || node.type === 'stage' || node.type === 'loop_start') && (edges.length !== 1 || edges[0]?.type !== 'default')) errors.push(`节点“${node.id}”必须有且仅有一个默认出口`);
    if (node.type === 'condition') {
      const count = edges.filter(edge => edge.type === 'condition').length;
      if (count < 1 || count > 5 || edges.filter(edge => edge.type === 'default').length !== 1 || edges.length !== count + 1) errors.push(`条件节点“${node.id}”必须有一至五个条件出口和一个默认出口`);
    }
    if (node.type === 'loop_end' && (edges.filter(edge => edge.type === 'default').length !== 1 || edges.filter(edge => edge.type === 'loop_back').length !== 1 || edges.length !== 2)) errors.push(`循环判断节点“${node.id}”必须各有一个默认和循环回边出口`);
  }
  for (const node of graph.nodes.filter((item): item is Extract<WorkflowNode, { type: 'loop_end' }> => item.type === 'loop_end')) {
    const start = ids.get(node.startNodeId);
    if (!start || start.type !== 'loop_start' || start.loopId !== node.loopId) errors.push(`循环判断节点“${node.id}”未匹配循环开始节点`);
    if (!graph.edges.some(edge => edge.type === 'loop_back' && edge.source === node.id && edge.target === node.startNodeId)) errors.push(`循环判断节点“${node.id}”缺少回边`);
  }
  for (const edge of graph.edges) {
    if (edge.type !== 'condition') continue;
    const source = ids.get(edge.source);
    if (source?.type !== 'condition') { errors.push(`条件边“${edge.id}”必须从条件节点发出`); continue; }
    const accepted = new Set(source.inputNodeIds);
    if ((Array.isArray(edge.condition.inputNodeIds) ? edge.condition.inputNodeIds : []).some(id => !accepted.has(id))) errors.push(`条件边“${edge.id}”引用了未接收的信息`);
  }
  return [...new Set(errors)];
}

function ordinaryReachable(graph: WorkflowGraph, source: string, target: string): boolean {
  const pending = [source];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    pending.push(...graph.edges.filter(edge => edge.source === current && edge.type !== 'loop_back').map(edge => edge.target));
  }
  return false;
}

export function validateWorkflowConnection(graph: WorkflowGraph, connection: WorkflowConnectionDraft): string | null {
  const source = graph.nodes.find(node => node.id === connection.source);
  const target = graph.nodes.find(node => node.id === connection.target);
  if (!source || !target) return '连接引用的节点不存在';
  if (source.id === target.id) return '节点不允许自连';
  if (graph.edges.some(edge => edge.source === source.id && edge.target === target.id)) return '两个节点之间不允许重复边';
  if (connection.kind === 'loop_back') {
    return source.type === 'loop_end' && target.type === 'loop_start' && target.id === source.startNodeId ? null : '循环回边必须连接对应的循环开始节点';
  }
  if (connection.kind === 'condition' && source.type !== 'condition') return '条件出口只能从条件节点发出';
  if (connection.kind === 'default' && source.type === 'end') return '结束节点不能创建出口';
  if (ordinaryReachable(graph, target.id, source.id)) return '普通边不允许形成环';
  return null;
}

function kinds(source: WorkflowNode): WorkflowEdge['type'][] {
  if (source.type === 'condition') return ['condition', 'default'];
  if (source.type === 'loop_end') return ['loop_back', 'default'];
  if (source.type === 'end') return [];
  return ['default'];
}

export function availableWorkflowEdgeKinds(graph: WorkflowGraph, sourceId: string, targetId: string, ignoredEdgeId?: string): WorkflowEdge['type'][] {
  const source = graph.nodes.find(node => node.id === sourceId);
  if (!source) return [];
  const without = ignoredEdgeId ? { ...graph, edges: graph.edges.filter(edge => edge.id !== ignoredEdgeId) } : graph;
  return kinds(source).filter(kind => validateWorkflowConnection(without, { source: sourceId, target: targetId, kind }) === null);
}

export function defaultCondition(): WorkflowCondition {
  return { type: 'llm_judgment', agentId: '', prompt: '', inputNodeIds: [] };
}

export function addWorkflowConnection(graph: WorkflowGraph, connection: WorkflowConnectionDraft): { graph: WorkflowGraph; error: string | null } {
  const error = validateWorkflowConnection(graph, connection);
  if (error) return { graph, error };
  const id = `edge-${graph.edges.length + 1}`;
  const edge: WorkflowEdge = connection.kind === 'condition'
    ? { id, source: connection.source, target: connection.target, type: 'condition', condition: clone(connection.condition ?? defaultCondition()) }
    : { id, source: connection.source, target: connection.target, type: connection.kind };
  return { graph: { ...clone(graph), edges: [...clone(graph.edges), edge] }, error: null };
}

export function removeWorkflowNode(graph: WorkflowGraph, nodeId: string): { graph: WorkflowGraph; error: string | null } {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node) return { graph, error: `节点“${nodeId}”不存在` };
  if (node.type === 'start') return { graph, error: '开始节点不能删除' };
  const removed = new Set([nodeId]);
  if (node.type === 'loop_start' || node.type === 'loop_end') {
    graph.nodes.filter(item => (item.type === 'loop_start' || item.type === 'loop_end') && item.loopId === node.loopId).forEach(item => removed.add(item.id));
  }
  return { graph: { ...clone(graph), nodes: graph.nodes.filter(node => !removed.has(node.id)), edges: graph.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)) }, error: null };
}

const elk = new ELK();
export async function autoLayoutWorkflow(graph: WorkflowGraph): Promise<WorkflowGraph> {
  const layout = await elk.layout({
    id: 'workflow',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '52', 'elk.layered.spacing.nodeNodeBetweenLayers': '88' },
    children: graph.nodes.map(node => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: graph.edges.filter(edge => edge.type !== 'loop_back').map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  const positions = new Map((layout.children ?? []).map(node => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
  return { ...clone(graph), nodes: graph.nodes.map(node => ({ ...clone(node), position: positions.get(node.id) ?? node.position ?? { x: 0, y: 0 } })) };
}
