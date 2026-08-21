import { Plus, X } from 'lucide-react';
import type { WorkflowCondition, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Select, type SelectOption } from '../../components/ui/Select';
import { availableWorkflowEdgeKinds } from './workflowModel';
import { NodeInputSelector } from './NodeInputSelector';

type LlmCondition = Extract<WorkflowCondition, { type: 'llm_judgment' }>;

export type SelectedWorkflowElement = { kind: 'node'; id: string } | { kind: 'edge'; id: string };
export interface WorkflowProviderOption { id: string; model?: string; }
export interface WorkflowAgentOption { id: string; name: string; role: string; }

interface WorkflowInspectorProps {
  graph: WorkflowGraph;
  selectedElement: SelectedWorkflowElement;
  providers?: WorkflowProviderOption[];
  agents?: WorkflowAgentOption[];
  providerLabel: (providerId: string, providers?: WorkflowProviderOption[]) => string;
  onChange: (graph: WorkflowGraph) => void;
  onClose: () => void;
  onDelete: (selected: SelectedWorkflowElement) => void;
}

const EDGE_OPTIONS: SelectOption[] = [
  { value: 'default', label: '默认出口' },
  { value: 'condition', label: '条件出口' },
  { value: 'loop_back', label: '循环回边' },
];
const LOOP_OPTIONS: SelectOption[] = [
  { value: '3', label: '小于 3 次' }, { value: '10', label: '小于 10 次' },
  { value: '20', label: '小于 20 次' }, { value: '40', label: '小于 40 次' },
  { value: '100', label: '小于 100 次' }, { value: 'unlimited', label: '不限次数' },
];

function newLlmCondition(): LlmCondition {
  return { type: 'llm_judgment' as const, agentId: '', prompt: '', inputNodeIds: [] };
}


function AgentSelect({ value, agents, label, onChange }: {
  value: string; agents: WorkflowAgentOption[]; label: string; onChange: (value: string) => void;
}) {
  return <div className="workflow-node-agent">
    <span className="workflow-inspector__label">{label}</span>
    <Select aria-label={label} value={value} placeholder="请选择 Agent"
      options={agents.map(agent => ({ value: agent.id, label: `${agent.name} · ${agent.role}` }))}
      onChange={onChange} />
  </div>;
}

function CommonFields({ node, onChange }: { node: WorkflowNode; onChange: (next: WorkflowNode) => void }) {
  if (node.type === 'start' || node.type === 'end' || node.type === 'loop_start') return null;
  return <>
    <Input label="名称" value={node.name ?? ''} placeholder="请输入" size="sm" onChange={event => onChange({ ...node, name: event.target.value })} />
    <Textarea label="说明" value={node.description ?? ''} placeholder="请输入" rows={2} onChange={event => onChange({ ...node, description: event.target.value })} />
  </>;
}

function StageFields({ node, graph, agents, onChange }: {
  node: Extract<WorkflowNode, { type: 'stage' }>; graph: WorkflowGraph;
  agents: WorkflowAgentOption[]; onChange: (next: WorkflowNode) => void;
}) {
  return <>
    <div className="workflow-inspector__readonly-field"><span className="workflow-inspector__label">节点标识</span><div className="workflow-inspector__readonly">{node.stage}</div></div>
    <NodeInputSelector graph={graph} nodeId={node.id} selectedIds={node.inputNodeIds ?? []} onChange={inputNodeIds => onChange({ ...node, inputNodeIds })} />
    <Textarea label="提示词" value={node.prompt ?? ''} placeholder="请输入" maxLength={4000} rows={5} hint={`${[...(node.prompt ?? '')].length}/4000`} onChange={event => onChange({ ...node, prompt: event.target.value })} />
    <AgentSelect label="选择 Agent" value={node.agentId ?? ''} agents={agents} onChange={agentId => onChange({ ...node, agentId })} />
  </>;
}

function ConditionConfig({ condition, agents, graph, nodeId, allowedInputIds, onChange }: {
  condition: LlmCondition;
  agents: WorkflowAgentOption[]; graph: WorkflowGraph; nodeId: string; allowedInputIds: string[];
  onChange: (next: LlmCondition) => void;
}) {
  return <div className="workflow-inspector__fields">
    <Select aria-label="判断方式" value="llm_judgment" options={[{ value: 'llm_judgment', label: 'LLM 判断' }]} disabled onChange={() => undefined} />
    <AgentSelect label="选择 Agent" value={condition.agentId ?? ''} agents={agents} onChange={agentId => onChange({ ...condition, agentId })} />
    <Textarea label="判断提示词" value={condition.prompt} placeholder="请输入" maxLength={4000} rows={5} hint={`${[...condition.prompt].length}/4000`} onChange={event => onChange({ ...condition, prompt: event.target.value })} />
    <div className="workflow-inspector__input-references">{(condition.inputNodeIds ?? []).map(id => <span key={id}>{id}</span>)}</div>
    <NodeInputSelector graph={graph} nodeId={nodeId} selectedIds={condition.inputNodeIds ?? []} availableIds={allowedInputIds} onChange={inputNodeIds => onChange({ ...condition, inputNodeIds })} />
  </div>;
}

function ConditionNodeFields({ node, graph, agents, onGraphChange }: {
  node: Extract<WorkflowNode, { type: 'condition' }>; graph: WorkflowGraph;
  agents: WorkflowAgentOption[]; onGraphChange: (graph: WorkflowGraph) => void;
}) {
  const outgoing = graph.edges.filter(edge => edge.source === node.id);
  const conditional = outgoing.filter((edge): edge is Extract<WorkflowEdge, { type: 'condition' }> => edge.type === 'condition');
  const updateNode = (inputNodeIds: string[]) => onGraphChange({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...node, inputNodeIds } : item) });
  const updateEdge = (next: Extract<WorkflowEdge, { type: 'condition' }>) => onGraphChange({ ...graph, edges: graph.edges.map(edge => edge.id === next.id ? next : edge) });
  const addCondition = () => {
    if (conditional.length >= 5) return;
    const suffix = conditional.length + 1;
    const targetId = `${node.id}-condition-end-${suffix}`;
    const edgeId = `${node.id}-condition-${suffix}`;
    if (graph.nodes.some(item => item.id === targetId) || graph.edges.some(item => item.id === edgeId)) return;
    onGraphChange({
      ...graph,
      nodes: [...graph.nodes, {
        id: targetId, type: 'end', name: `条件 ${suffix} 结束`,
        position: { x: (node.position?.x ?? 0) + 300, y: (node.position?.y ?? 0) + suffix * 110 },
      }],
      edges: [...graph.edges, {
        id: edgeId, source: node.id, target: targetId, type: 'condition', condition: newLlmCondition(),
      }],
    });
  };
  return <>
    <NodeInputSelector graph={graph} nodeId={node.id} selectedIds={node.inputNodeIds ?? []} onChange={updateNode} />
    <div className="workflow-inspector__section-title"><span>条件出口</span><Button type="button" size="sm" variant="ghost" icon={<Plus size={13} />} disabled={conditional.length >= 5} onClick={addCondition}>添加</Button></div>
    {conditional.map((edge, index) => <div className="workflow-template" key={edge.id}>
      <div className="workflow-template__header">条件 {index + 1}</div>
      <ConditionConfig condition={edge.condition as LlmCondition} agents={agents} graph={graph} nodeId={node.id} allowedInputIds={node.inputNodeIds ?? []} onChange={condition => updateEdge({ ...edge, condition })} />
    </div>)}
    <div className="workflow-template"><div className="workflow-template__header">默认出口</div><div className="workflow-inspector__empty">{outgoing.find(edge => edge.type === 'default')?.target ?? '尚未连接'}</div></div>
  </>;
}

function LoopStartFields({ node, onChange }: {
  node: Extract<WorkflowNode, { type: 'loop_start' }>; onChange: (next: WorkflowNode) => void;
}) {
  return <Select aria-label="循环次数" value={node.maxIterations === null ? 'unlimited' : String(node.maxIterations)}
    options={LOOP_OPTIONS} onChange={value => onChange({ ...node, maxIterations: (value === 'unlimited' ? null : Number(value)) as never })} />;
}

function LoopEndFields({ node, graph, agents, onChange }: {
  node: Extract<WorkflowNode, { type: 'loop_end' }>; graph: WorkflowGraph;
  agents: WorkflowAgentOption[]; onChange: (next: WorkflowNode) => void;
}) {
  const condition = node.exitCondition.type === 'llm_judgment' ? node.exitCondition as LlmCondition : newLlmCondition();
  return <>
    <NodeInputSelector graph={graph} nodeId={node.id} selectedIds={node.inputNodeIds ?? []} onChange={inputNodeIds => onChange({ ...node, inputNodeIds })} />
    <Select aria-label="循环判断方式" value="llm_judgment" options={[{ value: 'llm_judgment', label: 'LLM 判断' }]} disabled onChange={() => undefined} />
    <AgentSelect label="选择 Agent" value={condition.agentId ?? ''} agents={agents} onChange={agentId => onChange({ ...node, exitCondition: { ...condition, agentId } })} />
    <Textarea label="判断提示词" value={condition.prompt} placeholder="请输入" maxLength={4000} rows={5} hint={`${[...condition.prompt].length}/4000`} onChange={event => onChange({ ...node, exitCondition: { ...condition, prompt: event.target.value } })} />
  </>;
}

function edgeWithType(edge: WorkflowEdge, type: string): WorkflowEdge {
  const base = { id: edge.id, source: edge.source, target: edge.target, ...(edge.label === undefined ? {} : { label: edge.label }) };
  if (type === 'condition') return { ...base, type, condition: newLlmCondition() };
  if (type === 'loop_back') return { ...base, type };
  return { ...base, type: 'default' };
}

function EdgeFields({ edge, graph, onChange }: { edge: WorkflowEdge; graph: WorkflowGraph; onChange: (next: WorkflowEdge) => void }) {
  const options = EDGE_OPTIONS.filter(option => availableWorkflowEdgeKinds(graph, edge.source, edge.target, edge.id).includes(option.value as WorkflowEdge['type']));
  return <>
    <Input label="标签" value={edge.label ?? ''} placeholder="请输入" size="sm" onChange={event => onChange({ ...edge, label: event.target.value })} />
    <Select aria-label="出口类型" value={edge.type} options={options} onChange={type => onChange(edgeWithType(edge, type))} />
    <div className="workflow-inspector__route"><span>{edge.source}</span><span>→</span><span>{edge.target}</span></div>
  </>;
}

export function handleWorkflowInspectorNodeChange(graph: WorkflowGraph, next: WorkflowNode, onGraphChange: (graph: WorkflowGraph) => void): void {
  onGraphChange(handleWorkflowInspectorGraphChange(graph, { kind: 'node', id: next.id }, next));
}

export function handleWorkflowInspectorGraphChange(graph: WorkflowGraph, selected: SelectedWorkflowElement, next: WorkflowNode | WorkflowEdge): WorkflowGraph {
  if (next.id !== selected.id) return graph;
  if (selected.kind === 'node') return 'source' in next ? graph : { ...graph, nodes: graph.nodes.map(item => item.id === next.id ? next : item) };
  return 'source' in next ? { ...graph, edges: graph.edges.map(item => item.id === next.id ? next : item) } : graph;
}

export function WorkflowInspector({ graph, selectedElement, agents = [], onChange, onClose, onDelete }: WorkflowInspectorProps) {
  const node = selectedElement.kind === 'node' ? graph.nodes.find(item => item.id === selectedElement.id) : undefined;
  const edge = selectedElement.kind === 'edge' ? graph.edges.find(item => item.id === selectedElement.id) : undefined;
  if (!node && !edge) return null;
  const updateNode = (next: WorkflowNode) => handleWorkflowInspectorNodeChange(graph, next, onChange);
  return <aside className="workflow-inspector" aria-label="流程属性">
    <div className="workflow-inspector__header"><div><div className="workflow-inspector__eyebrow">{node ? '节点' : '连线'}</div><div className="workflow-inspector__title">{node ? '节点属性' : '连线属性'}</div></div><button type="button" aria-label="关闭属性面板" onClick={onClose}><X size={16} /></button></div>
    <div className="workflow-inspector__body">
      {node && <><CommonFields node={node} onChange={updateNode} />
        {node.type === 'stage' && <StageFields node={node} graph={graph} agents={agents} onChange={updateNode} />}
        {node.type === 'condition' && <ConditionNodeFields node={node} graph={graph} agents={agents} onGraphChange={onChange} />}
        {node.type === 'loop_start' && <LoopStartFields node={node} onChange={updateNode} />}
        {node.type === 'loop_end' && <LoopEndFields node={node} graph={graph} agents={agents} onChange={updateNode} />}
      </>}
      {edge && <EdgeFields edge={edge} graph={graph} onChange={next => onChange(handleWorkflowInspectorGraphChange(graph, selectedElement, next))} />}
    </div>
    <div className="workflow-inspector__footer"><Button type="button" variant="danger" icon={<X size={14} />} onClick={() => onDelete(selectedElement)}>删除{node ? '节点' : '连线'}</Button></div>
  </aside>;
}
