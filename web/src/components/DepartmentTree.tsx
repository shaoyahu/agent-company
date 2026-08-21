/**
 * DepartmentTree - 部门层级树
 *
 * 视觉:
 *   - 缩进表示层级(每层 18px)
 *   - ▾ / ▸ 折叠 / 展开
 *   - 部门右侧用 monospaced 标识 + 彩色 Tag
 *   - 整树走"控制台/IDE"风格,极淡描边 + 4px 圆角
 *   - 不使用任何 emoji,平台符号统一用几何字符
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Diamond } from 'lucide-react';
import type { DBDepartment, DBAgent } from './AgentsView';
import { Tag } from './ui/Tag';
import { Button } from './ui/Button';
import { useViewport } from './ui/useViewport';

const toolbarBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--muted)',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--ui-radius)',
  cursor: 'pointer',
};

function depthIndent(depth: number, isNarrow: boolean): number {
  return 10 + depth * (isNarrow ? 10 : 14);
}

export interface DepartmentTreeProps {
  departments: DBDepartment[];
  agents: DBAgent[];
  onEdit: (d: DBDepartment) => void;
  onDelete: (d: DBDepartment) => void;
  onAdd: (parentId?: string) => void;
  isFromDb: (id: string) => boolean;
}

interface TreeNode {
  dept: DBDepartment;
  children: TreeNode[];
  depth: number;
  ownAgentCount: number;
  totalAgentCount: number;
}

function buildTree(
  departments: DBDepartment[],
  agents: DBAgent[],
): TreeNode[] {
  // 按 parentId 分组
  const byParent = new Map<string | undefined, DBDepartment[]>();
  for (const d of departments) {
    const arr = byParent.get(d.parentId) ?? [];
    arr.push(d);
    byParent.set(d.parentId, arr);
  }

  // 统计每个部门的 agent 数(仅该部门,不算子部门)
  const ownCount = new Map<string, number>();
  for (const a of agents) {
    ownCount.set(a.department, (ownCount.get(a.department) ?? 0) + 1);
  }

  function buildNode(dept: DBDepartment, depth: number): TreeNode {
    const childDepts = byParent.get(dept.id) ?? [];
    const children = childDepts.map((c) => buildNode(c, depth + 1));
    const total = children.reduce((s, c) => s + c.totalAgentCount, 0) + (ownCount.get(dept.id) ?? 0);
    return {
      dept,
      children,
      depth,
      ownAgentCount: ownCount.get(dept.id) ?? 0,
      totalAgentCount: total,
    };
  }

  const roots = byParent.get(undefined) ?? [];
  return roots.map((d) => buildNode(d, 0));
}

export function DepartmentTree({
  departments,
  agents,
  onEdit,
  onDelete,
  onAdd,
  isFromDb,
}: DepartmentTreeProps) {
  const vp = useViewport();
  const tree = useMemo(() => buildTree(departments, agents), [departments, agents]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(departments.map((d) => d.id)),
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(departments.map((d) => d.id)));
  const collapseAll = () => setExpanded(new Set());

  if (tree.length === 0) {
    return (
      <div
        style={{
          background: 'var(--surface)',
          border: '1px dashed var(--line)',
          borderRadius: 'var(--ui-radius)',
          padding: '48px 24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 12,
            color: 'var(--faint)',
          }}
        >
          <Diamond size={32} strokeWidth={1.25} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>
          还没有部门
        </div>
        <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 16 }}>
          建一个部门开始搭组织架构
        </div>
        <Button variant="dark" size="md" onClick={() => onAdd()} icon={<Plus size={14} strokeWidth={2} />}>
          新建部门
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div
        data-department-tree-toolbar
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
          padding: '0 2px',
        }}
      >
        <div
          style={{
            minWidth: 0,
            fontSize: 11,
            color: 'var(--subtle)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          部门 {departments.length} · 成员 {agents.length}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={expandAll}
            title="全部展开"
            aria-label="全部展开"
            style={toolbarBtnStyle}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--surface-2)';
              e.currentTarget.style.borderColor = 'var(--line)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            <ChevronDown size={14} strokeWidth={1.75} />
          </button>
          <button
            onClick={collapseAll}
            title="全部折叠"
            aria-label="全部折叠"
            style={toolbarBtnStyle}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--surface-2)';
              e.currentTarget.style.borderColor = 'var(--line)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            <ChevronRight size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div data-department-list style={{ display: 'grid', gap: 3 }}>
        {tree.map((node) => (
          <div key={node.dept.id}>
            <TreeNodeView
              node={node}
              expanded={expanded}
              onToggle={toggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAdd={onAdd}
              isFromDb={isFromDb}
              vp={vp}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TreeNodeView({
  node,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAdd,
  isFromDb,
  vp,
}: {
  node: TreeNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (d: DBDepartment) => void;
  onDelete: (d: DBDepartment) => void;
  onAdd: (parentId?: string) => void;
  isFromDb: (id: string) => boolean;
  vp: { isNarrow: boolean; isMedium: boolean; shouldCollapseChat: boolean; width: number };
}) {
  const { dept, children, depth, totalAgentCount } = node;
  const isExpanded = expanded.has(dept.id);
  const hasChildren = children.length > 0;
  const fromDb = isFromDb(dept.id);
  const [hover, setHover] = useState(false);

  return (
    <>
      <div
        data-department-row
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 38,
          padding: '7px 8px',
          paddingLeft: depthIndent(depth, vp.isNarrow),
          background: hover ? 'var(--surface)' : 'transparent',
          border: '1px solid',
          borderColor: hover ? 'var(--line)' : 'transparent',
          borderRadius: 'var(--ui-radius)',
          transition: 'background 0.1s, border-color 0.1s',
        }}
      >
        <span
          data-department-accent
          style={{
            position: 'absolute',
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            borderRadius: 2,
            background: totalAgentCount > 0 ? 'var(--accent)' : 'transparent',
            opacity: hover || totalAgentCount > 0 ? 1 : 0,
          }}
        />

        <button
          onClick={() => onToggle(dept.id)}
          aria-label={isExpanded ? '折叠部门' : '展开部门'}
          style={{
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: hasChildren ? 'var(--muted)' : 'transparent',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--ui-radius)',
            cursor: hasChildren ? 'pointer' : 'default',
            flexShrink: 0,
          }}
          tabIndex={hasChildren ? 0 : -1}
        >
          {isExpanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
        </button>

        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: depth === 0 ? 600 : 500,
              color: 'var(--text-2)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.25,
            }}
          >
            {dept.name}
          </span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              minWidth: 0,
              marginTop: 2,
            }}
          >
            <span
              style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--subtle)',
                  whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {dept.id}
            </span>
            {fromDb && (
              <span style={{ fontSize: 9, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                db
              </span>
            )}
          </div>
        </div>

        <Tag
          tone={totalAgentCount > 0 ? 'ok' : 'neutral'}
          size="xs"
          mono
        >
          {totalAgentCount}
        </Tag>

        <div
          data-department-actions
          style={{
            display: 'flex',
            gap: 2,
            flexShrink: 0,
            opacity: hover ? 1 : 0,
            transition: 'opacity 0.1s',
          }}
        >
          <IconBtn title="添加子部门" onClick={() => onAdd(dept.id)}>
            <Plus size={12} strokeWidth={1.75} />
          </IconBtn>
          {fromDb && (
            <>
              <IconBtn title="编辑" onClick={() => onEdit(dept)}>
                <Pencil size={11} strokeWidth={1.75} />
              </IconBtn>
              <IconBtn
                title="删除"
                onClick={() => onDelete(dept)}
                danger
              >
                <Trash2 size={11} strokeWidth={1.75} />
              </IconBtn>
            </>
          )}
        </div>
      </div>

      {hasChildren && isExpanded && children.map((child) => (
        <div key={child.dept.id} style={{ marginTop: 3 }}>
          <TreeNodeView
            node={child}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            onAdd={onAdd}
            isFromDb={isFromDb}
            vp={vp}
          />
        </div>
      ))}
    </>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        color: danger ? 'var(--danger)' : 'var(--muted)',
        background: hover ? (danger ? 'var(--danger-soft)' : 'var(--surface)') : 'transparent',
        border: '1px solid',
        borderColor: hover ? (danger ? 'var(--danger-line)' : 'var(--line)') : 'transparent',
        borderRadius: 'var(--ui-radius)',
        cursor: 'pointer',
        transition: 'all 0.1s',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </button>
  );
}
