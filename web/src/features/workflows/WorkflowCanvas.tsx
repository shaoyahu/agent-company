import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import {
  CheckCircle2,
  CircleStop,
  GitBranch,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../api/client';
import {
  addWorkflowConnection,
  defaultCondition,
  fromReactFlow,
  removeWorkflowNode,
  toReactFlow,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
} from './workflowModel';
import {
  WorkflowInspector,
  type SelectedWorkflowElement,
  type WorkflowProviderOption,
  type WorkflowAgentOption,
} from './WorkflowInspector';
import { WorkflowNodeCard } from './WorkflowNode';

const NODE_TYPES = {
  workflow: WorkflowNodeCard,
} satisfies NodeTypes;

const NODE_WIDTH = 184;
const NODE_HEIGHT = 82;
const NODE_GAP = 24;
const DEFAULT_CANVAS_SIZE = { width: 900, height: 600 };
const MAX_NODE_POSITION_SEARCH_ATTEMPTS = 10_000;

interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  providers?: WorkflowProviderOption[];
  agents?: WorkflowAgentOption[];
  providerLabel: (providerId: string, providers?: WorkflowProviderOption[]) => string;
  errors: string[];
  onChange: (graph: WorkflowGraph) => void;
  onError: (message: string) => void;
}

type AddableNodeType = 'stage' | 'condition' | 'end' | 'loop';

const TOOLBAR_ITEMS: Array<{
  type: AddableNodeType;
  label: string;
  icon: typeof CheckCircle2;
}> = [
  { type: 'stage', label: '添加阶段', icon: CheckCircle2 },
  { type: 'condition', label: '添加条件', icon: GitBranch },
  { type: 'loop', label: '添加循环', icon: RefreshCw },
  { type: 'end', label: '添加结束', icon: CircleStop },
];

function nextElementId(
  graph: WorkflowGraph,
  prefix: string,
  collection: 'nodes' | 'edges',
): string {
  const ids = new Set(graph[collection].map(item => item.id));
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function findVisibleNodePosition(
  nodes: Array<Pick<WorkflowNode, 'position'>>,
  viewport: Viewport,
  canvasSize = DEFAULT_CANVAS_SIZE,
): { x: number; y: number } {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0
    ? viewport.zoom
    : 1;
  const width = Number.isFinite(canvasSize.width) && canvasSize.width > 0
    ? canvasSize.width
    : DEFAULT_CANVAS_SIZE.width;
  const height = Number.isFinite(canvasSize.height) && canvasSize.height > 0
    ? canvasSize.height
    : DEFAULT_CANVAS_SIZE.height;
  const center = {
    x: (width / 2 - viewport.x) / zoom - NODE_WIDTH / 2,
    y: (height / 2 - viewport.y) / zoom - NODE_HEIGHT / 2,
  };
  const overlaps = (position: { x: number; y: number }): boolean => nodes.some(node => {
    if (!node.position) return false;
    return (
      position.x < node.position.x + NODE_WIDTH + NODE_GAP
      && position.x + NODE_WIDTH + NODE_GAP > node.position.x
      && position.y < node.position.y + NODE_HEIGHT + NODE_GAP
      && position.y + NODE_HEIGHT + NODE_GAP > node.position.y
    );
  });

  let attempts = 0;
  for (let ring = 0; ; ring += 1) {
    for (let row = -ring; row <= ring; row += 1) {
      for (let column = -ring; column <= ring; column += 1) {
        if (ring > 0 && Math.abs(row) !== ring && Math.abs(column) !== ring) continue;
        if (attempts >= MAX_NODE_POSITION_SEARCH_ATTEMPTS) {
          throw new Error('未能找到可用的节点位置');
        }
        attempts += 1;
        const position = {
          x: center.x + column * (NODE_WIDTH + NODE_GAP),
          y: center.y + row * (NODE_HEIGHT + NODE_GAP),
        };
        if (!overlaps(position)) return position;
      }
    }
  }
}

function makeNode(
  type: AddableNodeType,
  graph: WorkflowGraph,
  position: { x: number; y: number },
): WorkflowNode {
  const id = nextElementId(graph, type.replace('_approval', ''), 'nodes');
  switch (type) {
    case 'stage':
      return {
          id, type, name: '新阶段', description: '', stage: id,
          agentId: '', inputNodeIds: [], prompt: '', position,
      };
    case 'condition':
      return { id, type, name: '新条件', description: '', inputNodeIds: [], position };
    case 'end':
      return { id, type, name: '结束', position };
    case 'loop':
      throw new Error('循环节点必须创建为开始和判断节点');
  }
}

function makeLoopPair(
  graph: WorkflowGraph,
  position: { x: number; y: number },
): { nodes: WorkflowNode[]; edge: WorkflowEdge } {
  const loopId = nextElementId(graph, 'loop', 'nodes');
  const startId = `${loopId}-start`;
  const endId = `${loopId}-end`;
  const start: WorkflowNode = {
    id: startId,
    type: 'loop_start',
    loopId,
    maxIterations: 3,
    position,
  };
  const end: WorkflowNode = {
    id: endId,
    type: 'loop_end',
    loopId,
    startNodeId: startId,
    name: '循环判断',
    description: '',
    inputNodeIds: [],
    exitCondition: { type: 'llm_judgment', agentId: '', prompt: '', inputNodeIds: [] },
    position: { x: position.x + NODE_WIDTH + NODE_GAP * 5, y: position.y },
  };
  return {
    nodes: [start, end],
    edge: {
      id: `${loopId}-back`,
      source: endId,
      target: startId,
      type: 'loop_back',
    },
  };
}

function connectionKind(sourceHandle: string | null): WorkflowEdge['type'] {
  if (sourceHandle?.startsWith('condition-')) return 'condition';
  switch (sourceHandle) {
    case 'condition':
      return 'condition';
    case 'loop_back':
      return 'loop_back';
    case 'exit':
    case 'default':
    default:
      return 'default';
  }
}

export function handleWorkflowNodeChanges(
  nodes: WorkflowFlowNode[],
  edges: WorkflowFlowEdge[],
  changes: NodeChange<WorkflowFlowNode>[],
  onPositionChange: (graph: WorkflowGraph) => void,
  onGraphChange: (graph: WorkflowGraph) => void,
): { nodes: WorkflowFlowNode[]; edges: WorkflowFlowEdge[] } {
  const safeChanges = changes.filter(change => {
    if (change.type !== 'remove') return true;
    const node = nodes.find(candidate => candidate.id === change.id);
    return node?.data.workflowNode.type !== 'start';
  });
  const removed = new Set(
    safeChanges.flatMap(change => change.type === 'remove' ? [change.id] : []),
  );
  for (const node of nodes) {
    if (!removed.has(node.id)) continue;
    const workflowNode = node.data.workflowNode;
    if (workflowNode.type !== 'loop_start' && workflowNode.type !== 'loop_end') continue;
    for (const candidate of nodes) {
      const paired = candidate.data.workflowNode;
      if (
        (paired.type === 'loop_start' || paired.type === 'loop_end')
        && paired.loopId === workflowNode.loopId
      ) {
        removed.add(candidate.id);
      }
    }
  }
  const nextNodes = applyNodeChanges(safeChanges, nodes)
    .filter(node => !removed.has(node.id));
  const nextEdges = removed.size > 0
    ? edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target))
    : edges;
  if (safeChanges.some(change => change.type === 'remove')) {
    onGraphChange(fromReactFlow(nextNodes, nextEdges));
  } else if (safeChanges.some(change => change.type === 'position')) {
    onPositionChange(fromReactFlow(nextNodes, nextEdges));
  }
  return { nodes: nextNodes, edges: nextEdges };
}

function isProtectedLoopBack(edge: WorkflowFlowEdge | undefined): boolean {
  return edge?.data?.workflowEdge.type === 'loop_back';
}

export function applyWorkflowEdgeChanges(
  edges: WorkflowFlowEdge[],
  changes: EdgeChange<WorkflowFlowEdge>[],
): WorkflowFlowEdge[] {
  const allowedChanges = changes.filter((change) => {
    if (change.type === 'add') return true;
    const edge = edges.find(candidate => candidate.id === change.id);
    return !isProtectedLoopBack(edge);
  });
  return applyEdgeChanges(allowedChanges, edges);
}

export function handleWorkflowConnection(
  nodes: WorkflowFlowNode[],
  edges: WorkflowFlowEdge[],
  connection: Connection,
  onGraphChange: (graph: WorkflowGraph) => void,
  onError: (message: string) => void,
): WorkflowGraph | null {
  if (!connection.source || !connection.target) {
    onError('连接缺少起点或终点');
    return null;
  }
  const currentGraph = fromReactFlow(nodes, edges);
  const result = addWorkflowConnection(currentGraph, {
    source: connection.source,
    target: connection.target,
    kind: connectionKind(connection.sourceHandle),
  });
  if (result.error) {
    onError(result.error);
    return null;
  }
  onGraphChange(result.graph);
  return result.graph;
}

export function WorkflowCanvas({
  graph,
  providers,
  agents,
  providerLabel,
  errors,
  onChange,
  onError,
}: WorkflowCanvasProps) {
  const initial = toReactFlow(graph);
  const [nodes, setNodes] = useState<WorkflowFlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<WorkflowFlowEdge[]>(initial.edges);
  const [selectedElement, setSelectedElement] = useState<SelectedWorkflowElement | null>(null);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<WorkflowFlowNode, WorkflowFlowEdge> | null>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  const syncLocalGraph = useCallback((nextGraph: WorkflowGraph) => {
    const flow = toReactFlow(nextGraph);
    nodesRef.current = flow.nodes;
    edgesRef.current = flow.edges;
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, []);

  useEffect(() => {
    syncLocalGraph(graph);
    setSelectedElement(current => {
      if (!current) return null;
      const exists = current.kind === 'node'
        ? graph.nodes.some(node => node.id === current.id)
        : graph.edges.some(edge => edge.id === current.id);
      return exists ? current : null;
    });
  }, [graph, syncLocalGraph]);

  useEffect(() => {
    if (!nodeMenuOpen && !errorsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (paletteRef.current?.contains(event.target as Node)) return;
      setNodeMenuOpen(false);
      setErrorsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [errorsOpen, nodeMenuOpen]);

  const commit = useCallback((
    nextNodes: WorkflowFlowNode[],
    nextEdges: WorkflowFlowEdge[],
  ) => {
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    onChange(fromReactFlow(nextNodes, nextEdges));
  }, [onChange]);

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    const next = handleWorkflowNodeChanges(
      nodesRef.current,
      edgesRef.current,
      changes,
      onChange,
      onChange,
    );
    nodesRef.current = next.nodes;
    edgesRef.current = next.edges;
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [onChange]);

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowFlowEdge>[]) => {
    const nextEdges = applyWorkflowEdgeChanges(edgesRef.current, changes);
    const hasRemoved = nextEdges.length !== edgesRef.current.length;
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
    if (hasRemoved) {
      commit(nodesRef.current, nextEdges);
    }
  }, [commit]);

  const handleConnect = useCallback((connection: Connection) => {
    const nextGraph = handleWorkflowConnection(
      nodesRef.current,
      edgesRef.current,
      connection,
      onChange,
      onError,
    );
    if (nextGraph) syncLocalGraph(nextGraph);
  }, [onChange, onError, syncLocalGraph]);

  const addNode = (type: AddableNodeType) => {
    const currentGraph = fromReactFlow(nodesRef.current, edgesRef.current);
    const bounds = canvasRef.current?.getBoundingClientRect();
    const viewport = flowInstanceRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    const position = findVisibleNodePosition(
      currentGraph.nodes,
      viewport,
      bounds ? { width: bounds.width, height: bounds.height } : undefined,
    );
    const pair = type === 'loop' ? makeLoopPair(currentGraph, position) : null;
      const created = pair ? null : makeNode(type as Exclude<AddableNodeType, 'loop'>, currentGraph, position);
      const node = created?.type === 'stage' && !created.agentId && agents?.[0]
        ? { ...created, agentId: agents[0].id }
        : created;
      const preparedPair = pair && agents?.[0]
        ? {
            ...pair,
            nodes: pair.nodes.map(item => item.type === 'loop_end'
              ? { ...item, exitCondition: { ...item.exitCondition, agentId: agents[0]!.id } }
              : item),
          }
        : pair;
      const nextGraph: WorkflowGraph = preparedPair
      ? {
          ...currentGraph,
            nodes: [...currentGraph.nodes, ...preparedPair.nodes],
            edges: [...currentGraph.edges, preparedPair.edge],
        }
      : {
          ...currentGraph,
          nodes: [...currentGraph.nodes, node!],
        };
      setSelectedElement({ kind: 'node', id: preparedPair ? preparedPair.nodes[0]!.id : node!.id });
    setNodeMenuOpen(false);
    syncLocalGraph(nextGraph);
    onChange(nextGraph);
  };

  const deleteElement = (selected: SelectedWorkflowElement) => {
    const currentGraph = fromReactFlow(nodesRef.current, edgesRef.current);
    if (selected.kind === 'node') {
      const result = removeWorkflowNode(currentGraph, selected.id);
      if (result.error) {
        onError(result.error);
        return;
      }
      setSelectedElement(null);
      syncLocalGraph(result.graph);
      onChange(result.graph);
      return;
    }
    const edge = currentGraph.edges.find(candidate => candidate.id === selected.id);
    if (edge?.type === 'loop_back') {
      onError('循环回边不可删除');
      return;
    }
    const nextGraph = {
      ...currentGraph,
      edges: currentGraph.edges.filter(edge => edge.id !== selected.id),
    };
    setSelectedElement(null);
    syncLocalGraph(nextGraph);
    onChange(nextGraph);
  };

  const updateGraph = (nextGraph: WorkflowGraph) => {
    syncLocalGraph(nextGraph);
    onChange(nextGraph);
  };

  return (
    <div className="workflow-canvas-shell">
      <div ref={paletteRef} className="workflow-palette" aria-label="添加流程节点">
        <button
          type="button"
          title="添加节点"
          aria-label="添加节点"
          onClick={() => {
            setErrorsOpen(false);
            setNodeMenuOpen(open => !open);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          <span>添加</span>
        </button>
        <button
          type="button"
          title="查看校验问题"
          aria-label="查看校验问题"
          onClick={() => {
            setNodeMenuOpen(false);
            setErrorsOpen(open => !open);
          }}
        >
          <TriangleAlert size={16} aria-hidden="true" />
          <span>报错</span>
          {errors.length > 0 && <span className="workflow-validation-badge">{errors.length}</span>}
        </button>
        {nodeMenuOpen && (
          <div className="workflow-node-menu">
            {TOOLBAR_ITEMS.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => addNode(item.type)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {item.label.replace('添加', '')}
                </button>
              );
            })}
          </div>
        )}
        {errorsOpen && (
          <aside className="workflow-validation-panel" aria-label="校验问题列表">
            <strong>校验问题 {errors.length}</strong>
            {errors.length > 0 ? (
              <ul>
                {errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            ) : (
              <span>当前没有校验问题</span>
            )}
          </aside>
        )}
      </div>

      <div ref={canvasRef} className="workflow-canvas">
        <ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onInit={instance => { flowInstanceRef.current = instance; }}
          onNodeClick={(_event, node) => setSelectedElement({ kind: 'node', id: node.id })}
          onEdgeClick={(_event, edge) => {
            if (isProtectedLoopBack(edge)) return;
            setSelectedElement({ kind: 'edge', id: edge.id });
          }}
          onPaneClick={() => setSelectedElement(null)}
          fitView
          minZoom={0.25}
          maxZoom={1.8}
          deleteKeyCode={['Backspace', 'Delete']}
          defaultEdgeOptions={{
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
            style: { strokeWidth: 1.4, stroke: 'var(--subtle)' },
            labelStyle: { fontSize: 11, fill: 'var(--muted)' },
            labelBgStyle: { fill: 'var(--surface)' },
            labelShowBg: true,
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeStrokeWidth={2}
            maskColor="color-mix(in srgb, var(--canvas) 72%, transparent)"
          />
        </ReactFlow>
      </div>

      {selectedElement && (
        <WorkflowInspector
          graph={graph}
          selectedElement={selectedElement}
          providers={providers}
            agents={agents}
          providerLabel={providerLabel}
          onChange={updateGraph}
          onClose={() => setSelectedElement(null)}
          onDelete={deleteElement}
        />
      )}
    </div>
  );
}
