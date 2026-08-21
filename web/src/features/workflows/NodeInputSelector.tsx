import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowGraph, WorkflowNode } from '../../api/client';
import { getReachableUpstreamNodes } from './workflowModel';

function labelFor(node: WorkflowNode): string {
  if (node.id === 'start') return '开始';
  return node.type === 'stage' ? node.name?.trim() || node.stage : node.name?.trim() || node.id;
}

export function NodeInputSelector({
  graph,
  nodeId,
  selectedIds,
  availableIds,
  onChange,
}: {
  graph: WorkflowGraph;
  nodeId: string;
  selectedIds: string[];
  availableIds?: string[];
  onChange: (ids: string[]) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const options = getReachableUpstreamNodes(graph, nodeId)
    .filter(node => !availableIds || availableIds.includes(node.id));

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
      <div className="workflow-node-inputs__menu" ref={menuRef} role="listbox" aria-multiselectable="true"
        style={{ position: 'fixed', top: position.top, left: position.left, width: position.width, background: 'var(--surface-1)' }}>
        {options.length === 0 ? <div className="workflow-node-inputs__empty">暂无可接收的上游节点</div> : options.map(option => (
          <label className="workflow-node-inputs__option" key={option.id}>
            <input type="checkbox" checked={selectedIds.includes(option.id)} onChange={() => onChange(
              selectedIds.includes(option.id)
                ? selectedIds.filter(id => id !== option.id)
                : [...selectedIds, option.id],
            )} />
            <span>{labelFor(option)}</span><small>{option.id}</small>
          </label>
        ))}
      </div>,
      document.body,
    )
    : null;

  return <div className="workflow-node-inputs">
    <span className="workflow-inspector__label">接收信息</span>
    <button ref={triggerRef} type="button" className="workflow-node-inputs__trigger" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {selectedIds.length === 0 ? '未选择' : `已选择 ${selectedIds.length} 个节点`}
    </button>
    {menu}
  </div>;
}
