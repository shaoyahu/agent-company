import {
  CheckCircle2,
  CircleStop,
  GitBranch,
  Play,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../../api/client';
import type { WorkflowFlowNode } from './workflowModel';

type NodeMeta = {
  label: string;
  icon: LucideIcon;
  tone: string;
};

const NODE_META: Record<WorkflowNode['type'], NodeMeta> = {
  start: { label: '开始', icon: Play, tone: 'start' },
  stage: { label: '阶段', icon: CheckCircle2, tone: 'stage' },
  condition: { label: '条件', icon: GitBranch, tone: 'condition' },
  loop_start: { label: '进入循环', icon: RefreshCw, tone: 'loop' },
  loop_end: { label: '判断循环结束', icon: RefreshCw, tone: 'loop' },
  end: { label: '结束', icon: CircleStop, tone: 'end' },
};

function nodeMeta(type: string): NodeMeta {
  return NODE_META[type as WorkflowNode['type']] ?? NODE_META.stage;
}

function nodeTitle(node: WorkflowNode): string {
  if (node.name?.trim()) return node.name;
  if (node.type === 'stage') return node.stage || '未命名阶段';
  return nodeMeta(node.type).label;
}

function nodeSummary(node: WorkflowNode): string {
  if (node.description?.trim()) return node.description;
  switch (node.type) {
    case 'start':
      return '流程唯一入口';
    case 'stage':
        return node.agentId ? `Agent：${node.agentId}` : '未选择 Agent';
    case 'condition':
      return '按条件选择出口';
    case 'loop_start':
      return `串行循环，最多 ${node.maxIterations} 次`;
    case 'loop_end':
      return '判断是否结束循环';
    case 'end':
      return '流程终点';
  }
}

function SourceHandle({
  id,
  title,
  top,
  position = Position.Right,
}: {
  id: string;
  title: string;
  top: string;
  position?: Position;
}) {
  return (
    <Handle
      id={id}
      type="source"
      position={position}
      title={title}
      aria-label={title}
      aria-description="拖动此连接点创建连线"
      className="workflow-node__handle workflow-node__handle--source"
      style={position === Position.Top ? { left: top } : { top }}
    />
  );
}

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const node = data.workflowNode;
  const meta = nodeMeta(node.type);
  const Icon = meta.icon;

  return (
    <div
      className={`workflow-node workflow-node--${meta.tone}`}
      data-selected={selected ? 'true' : 'false'}
    >
      {node.type !== 'start' && (
        <Handle
          id="target"
          type="target"
          position={Position.Left}
          title="输入"
          aria-label="输入连接点"
          aria-description="拖动此连接点创建连线"
          className="workflow-node__handle workflow-node__handle--target"
        />
      )}

      <div className="workflow-node__header">
        <span className="workflow-node__icon"><Icon size={14} aria-hidden="true" /></span>
        <span>{meta.label}</span>
        <span className="workflow-node__id">{node.id}</span>
      </div>
      <div className="workflow-node__title" title={nodeTitle(node)}>{nodeTitle(node)}</div>
      <div className="workflow-node__summary" title={nodeSummary(node)}>{nodeSummary(node)}</div>

      {(node.type === 'start' || node.type === 'stage') && (
        <SourceHandle id="default" title="默认出口" top="50%" />
      )}
        {node.type === 'condition' && <>
          {['18%', '32%', '46%', '60%', '74%'].map((top, index) => (
            <SourceHandle key={top} id={`condition-${index + 1}`} title={`条件出口 ${index + 1}`} top={top} />
          ))}
          <SourceHandle id="default" title="默认出口" top="90%" />
        </>}
      {node.type === 'loop_start' && (
        <>
          <Handle
            id="loop-top"
            type="target"
            position={Position.Top}
            title="继续循环返回"
            aria-label="继续循环返回连接点"
            aria-description="拖动此连接点创建连线"
            className="workflow-node__handle workflow-node__handle--target"
          />
          <SourceHandle id="default" title="进入循环体" top="50%" />
        </>
      )}
      {node.type === 'loop_end' && (
        <>
          <SourceHandle id="default" title="结束循环" top="34%" />
          <SourceHandle
            id="loop_back"
            title="继续循环"
            top="50%"
            position={Position.Top}
          />
        </>
      )}
    </div>
  );
}
