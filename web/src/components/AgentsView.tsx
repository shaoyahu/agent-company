/**
 * AgentsView — 部门 / Agent 管理
 *
 * 布局:三栏
 *   ┌─ 部门树(280px) ─┬─ Agent 列表(自适应) ─┬─ Agent 详情(400px,可关) ─┐
 *   │                 │                       │                          │
 *
 * 视觉:
 *   - "控制台/IDE" 风格
 *   - 极淡描边 + 4px 圆角
 *   - 不用 emoji,平台符号统一用几何字符
 *   - 顶部 monospaced breadcrumb
 *   - 全部 UI 文案中文化
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Play, Pencil, Copy, Trash2, Search, Building2, X, Diamond, UserPlus, MessageSquare, MoreHorizontal } from 'lucide-react';
import { api } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';
import { AGENT_TEMPLATES, type AgentTemplate } from './agentTemplates';
import { COMPANY_TEMPLATES, type CompanyTemplate } from './companyTemplates';
import { DepartmentTree } from './DepartmentTree';
import { PageHeader } from './ui/PageHeader';
import { Tag } from './ui/Tag';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Input, Textarea } from './ui/Input';
import { Modal } from './ui/Modal';
import { EmptyState } from './ui/EmptyState';
import { AvatarPicker } from './ui/AvatarPicker';
import { MarkdownText } from './ui/MarkdownText';
import { renderAgentAvatar } from './ui/renderAgentAvatar';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/useConfirm';
import { useViewport } from './ui/useViewport';
import {
  filterAgents,
  groupAgentsByDepartment,
} from '../features/organization/organizationModel';
import {
  buildAgentPayload,
  canSaveAgentIdentity,
  canSaveAgentEditor,
  filterAvailableAgentTemplates,
  getCliToolSelectionNotice,
} from '../features/organization/agentEditorModel';
import {
  buildDepartmentPayload,
  canSaveDepartmentEditor,
} from '../features/organization/departmentEditorModel';
import { openAgentConversation } from '../features/organization/openAgentConversation';
import { apiUrl } from '../runtime/runtimeConfig';

interface DBAgent {
  id: string;
  name?: string;
  department: string;
  team?: string;
  role: 'head' | 'leader' | 'worker';
  llm: string;
  systemPrompt: string;
  tools: string[];
  skills?: string[];
  description?: string;
  avatar?: string;
  executor?: 'llm' | 'cli';
  cliTool?: string;
  cliModel?: string;
}

type AgentEditorState =
  | { mode: 'create'; agent: null }
  | { mode: 'edit' | 'clone'; agent: DBAgent };

interface DBDepartment {
  id: string;
  name: string;
  description?: string;
  head: string;
  teams?: string[];
  parentId?: string;
}

export type { DBDepartment, DBAgent };

const ROLE_TONE: Record<DBAgent['role'], 'accent' | 'info' | 'neutral'> = {
  head: 'accent',
  leader: 'info',
  worker: 'neutral',
};

const ROLE_LABELS: Record<DBAgent['role'], string> = {
  head: '部长（部门负责人）',
  leader: '组长',
  worker: '员工',
};

const TAG_TONE_FOR_MODEL = (model: string): 'openai' | 'anthropic' | 'both' | 'neutral' => {
  const m = model.toLowerCase();
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) return 'anthropic';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('gemini') || m.includes('grok') || m.includes('mistral')) return 'openai';
  return 'neutral';
};

export function AgentsView({ company }: { company: { providers: any[]; agents: any[]; departments?: any[] } }) {
  const [depts, setDepts] = useState<{ active: DBDepartment[]; db: DBDepartment[]; yamlIds: string[] } | null>(null);
  const [agents, setAgents] = useState<{ active: DBAgent[]; db: DBAgent[]; yamlIds: string[] } | null>(null);
  const [showDeptEditor, setShowDeptEditor] = useState<DBDepartment | null | 'new'>(null);
  const [showAgentEditor, setShowAgentEditor] = useState<AgentEditorState | null>(null);
  const [testAgent, setTestAgent] = useState<DBAgent | null>(null);
  // 卡片 hover 状态 — 用来显示快速对话按钮
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [showCompanyTemplatePicker, setShowCompanyTemplatePicker] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(() => new Set());
  const [agentActionsOpen, setAgentActionsOpen] = useState(false);
  const [contextAgentMenu, setContextAgentMenu] = useState<{
    agent: DBAgent;
    x: number;
    y: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { lastEvent } = useWebSocket();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const vp = useViewport();

  const refresh = async () => {
    const [d, a] = await Promise.all([api.departments(), api.agents()]);
    setDepts(d);
    setAgents(a);
    // 球球 review 2026-08-16:不默认选第一个部门,默认显示全部 agent
    // (之前会自动选中 active[0],球球觉得「一进就锁到 dev」不对)
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    setAgentActionsOpen(false);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!contextAgentMenu) return;
    const close = () => setContextAgentMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextAgentMenu]);

  useEffect(() => {
    if (
      lastEvent?.type === 'agent_updated' ||
      lastEvent?.type === 'agent_deleted' ||
      lastEvent?.type === 'department_updated' ||
      lastEvent?.type === 'department_deleted'
    ) {
      refresh();
    }
  }, [lastEvent]);

  const handleDeleteDept = async (id: string) => {
    if (!await confirm({ title: '删除部门', message: `删除部门 "${id}"?\n(如果还有 agent 在这个部门,会拒绝删除)`, danger: true, confirmText: '删除' })) return;
    try {
      // 球球 review HIGH:走 http() helper,后端返 4xx 时 throw
      const data = await api.deleteDepartment(id);
      if (data.ok) {
        toast.push({ title: '部门已删除', tone: 'ok' });
        if (selectedDeptId === id) setSelectedDeptId(null);
        refresh();
      } else {
        toast.push({ title: '删除失败', description: '后端返回 ok=false', tone: 'danger' });
      }
    } catch (e: any) {
      toast.push({ title: '删除失败', description: e.message ?? String(e), tone: 'danger' });
    }
  };

  const deleteAgentRecord = async (id: string) => {
    // 球球 review HIGH:走 http() helper,不存在的 id 会 404 throw
    const data = await api.deleteAgent(id);
    if (!data.ok) throw new Error('后端返回 ok=false');
  };

  const handleDeleteAgent = async (id: string) => {
    if (!await confirm({ title: '删除 Agent', message: `删除 agent "${id}"?`, danger: true, confirmText: '删除' })) return;
    try {
      await deleteAgentRecord(id);
      toast.push({ title: 'Agent 已删除', tone: 'ok' });
      if (selectedAgentId === id) setSelectedAgentId(null);
      setSelectedAgentIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      refresh();
    } catch (e: any) {
      toast.push({ title: '删除失败', description: e.message ?? String(e), tone: 'danger' });
    }
  };

  const toggleSelectedAgent = (id: string) => {
    if (!agents?.db.some(x => x.id === id)) return;
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDeleteAgents = async () => {
    const ids = Array.from(selectedAgentIds).filter(id =>
      agents?.db.some(x => x.id === id));
    if (ids.length === 0) return;
    const accepted = await confirm({
      title: '批量删除 Agent',
      message: `确定删除选中的 ${ids.length} 个 Agent 吗？`,
      danger: true,
      confirmText: '批量删除',
    });
    if (!accepted) return;
    try {
      for (const id of ids) {
        await deleteAgentRecord(id);
      }
      toast.push({ title: 'Agent 已删除', description: `已删除 ${ids.length} 个 Agent`, tone: 'ok' });
      if (selectedAgentId && ids.includes(selectedAgentId)) setSelectedAgentId(null);
      setSelectedAgentIds(new Set());
      refresh();
    } catch (e: any) {
      toast.push({ title: '批量删除失败', description: e.message ?? String(e), tone: 'danger' });
    }
  };

  const handleCloneAgent = (a: DBAgent) => {
    setShowAgentEditor({
      mode: 'clone',
      agent: {
        ...a,
        id: `${a.id}-copy`,
        name: a.name ? `${a.name} (副本)` : `${a.id} (副本)`,
      },
    });
  };

  const handleStartConversation = async (agent: DBAgent) => {
    try {
      await openAgentConversation(agent.id, {
        createConversation: api.createConversation,
        closeMenu: () => setAgentActionsOpen(false),
        pushState: (state, title, path) => history.pushState(state, title, path),
        notifyNavigation: () => dispatchEvent(new PopStateEvent('popstate')),
      });
    } catch (error) {
      toast.push({
        title: '创建对话失败',
        description: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    }
  };

  // 当前部门下的 agent(并应用搜索) — 必须在 early return 之前,遵守 Hook 规则
  const filteredAgents = useMemo(() => {
    if (!agents || !depts) return [];
    return filterAgents(agents.active, depts.active, searchQuery, selectedDeptId);
  }, [agents, depts, selectedDeptId, searchQuery]);

  // 按部门分组(在筛选后的 agent 里)
  const byDept = useMemo(
    () => groupAgentsByDepartment(filteredAgents),
    [filteredAgents],
  );

  if (!depts || !agents) {
    return <div style={{ padding: 32, color: 'var(--muted)' }}>加载中...</div>;
  }

  // 选中的部门
  const selectedDept = depts.active.find(d => d.id === selectedDeptId) ?? null;

  // 选中的 agent
  const selectedAgent = agents.active.find(a => a.id === selectedAgentId) ?? null;
  const selectedDbAgentIds = Array.from(selectedAgentIds).filter(id =>
    agents.db.some(x => x.id === id));

  // 找到选中的 agent 所属的部门名
  const selectedAgentDept = selectedAgent
    ? depts.active.find(d => d.id === selectedAgent.department)
    : null;

  return (
    <div className="organization-page">
      <PageHeader
        vp={vp}
        breadcrumb={
          <>
            <span>company</span>
            <span style={{ color: 'var(--faint)' }}>/</span>
            <span>agents</span>
          </>
        }
        title="组织架构"
        description={`${depts.active.length} 个部门 · ${agents.active.length} 个 agent · ${agents.db.length} 个 Web 可编辑`}
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setShowCompanyTemplatePicker(true)}
              icon={<Building2 size={13} strokeWidth={1.75} />}
            >
              套用公司模板
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setShowDeptEditor('new')}
              icon={<Plus size={14} strokeWidth={2} />}
            >
              部门
            </Button>
            <Button
              variant="dark"
              size="md"
              onClick={() => setShowAgentEditor({ mode: 'create', agent: null })}
              icon={<Plus size={14} strokeWidth={2} />}
            >
              新建 Agent
            </Button>
          </>
        }
      />

      {/* 三栏主体 — 始终保持左右分栏 */}
      <div
        className="organization-layout"
        style={{
          display: 'flex',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {/* 左:部门树 */}
        <div
          className="organization-departments"
          style={{
            flex: `0 0 ${vp.isNarrow ? 160 : 260}px`,
            minWidth: 0,
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            padding: '20px 16px',
            overflowY: 'auto',
            background: 'var(--canvas)',
          }}
        >
          <DepartmentTree
            departments={depts.active}
            agents={agents.active}
            onEdit={d => setShowDeptEditor(d)}
            onDelete={d => handleDeleteDept(d.id)}
            onAdd={parentId => setShowDeptEditor({ id: '', name: '', description: '', head: '', teams: [], parentId })}
            isFromDb={id => depts.db.some(x => x.id === id)}
          />
        </div>

        {/* 中:Agent 列表 */}
        <div
          className="organization-agents"
          style={{
            flex: '1 1 0',
            minWidth: 0,
            overflowY: 'auto',
            padding: '20px 24px',
            background: 'var(--canvas)',
          }}
        >
          {/* 顶部:搜索 + 当前部门 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <Input
              size="sm"
              icon={<Search size={12} strokeWidth={1.75} />}
              placeholder="搜索 agent / 部门 / LLM..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: 'min(100%, 280px)' }}
            />
            <div
              style={{
                fontSize: 11,
                color: 'var(--subtle)',
                fontFamily: 'var(--font-mono)',
                marginLeft: 'auto',
              }}
            >
              {selectedDept ? (
                <>DEPT <span style={{ color: 'var(--text-2)' }}>{selectedDept.id}</span> · {filteredAgents.length} 人</>
              ) : (
                <>ALL · {filteredAgents.length} 人</>
              )}
            </div>
            {selectedDept && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDeptId(null)}
                icon={<X size={11} strokeWidth={1.75} />}
              >
                清空部门筛选
              </Button>
            )}
              {selectedDbAgentIds.length > 0 && (
                <div
                  data-agent-batch-actions
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <Tag tone="accent" size="xs">{selectedDbAgentIds.length} 已选</Tag>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Trash2 size={12} strokeWidth={1.75} />}
                    onClick={() => void handleBatchDeleteAgents()}
                  >
                    批量删除
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedAgentIds(new Set())}
                  >
                    清空选择
                  </Button>
                </div>
              )}
          </div>

          {filteredAgents.length === 0 ? (
            <EmptyState
              icon={searchQuery ? <Search size={20} strokeWidth={1.5} /> : <UserPlus size={20} strokeWidth={1.5} />}
              title={searchQuery ? '没有匹配的 agent' : '这个部门还没有 agent'}
              description={searchQuery ? '换个关键词试试' : '点右上角 + 新建 Agent 招聘第一个员工'}
              action={!searchQuery ? <Button variant="dark" onClick={() => setShowAgentEditor({ mode: 'create', agent: null })}>+ 新建 Agent</Button> : undefined}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Array.from(byDept.entries()).map(([deptId, list]) => {
                const d = depts.active.find(x => x.id === deptId);
                if (!d) return null;
                return (
                  <section key={deptId}>
                    {/* 部门分隔头 */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 10,
                        padding: '4px 0',
                        borderBottom: '1px solid var(--line-soft)',
                      }}
                    >
                      <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>◆</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>{d.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>{d.id}</span>
                      <Tag tone="neutral" size="xs">{list.length} 人</Tag>
                    </div>

                    {/* Agent 卡片网格 */}
                    <div
                      className="organization-agent-grid"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
                        gap: 8,
                      }}
                    >
                      {list.map(a => {
                        const isFromDb = agents.db.some(x => x.id === a.id);
                          const active = a.id === selectedAgentId;
                          const checked = selectedAgentIds.has(a.id);
                        const provider = company.providers.find((p: any) => p.id === a.llm);
                        const providerModelTone = provider ? TAG_TONE_FOR_MODEL(provider.model) : 'neutral';
                        return (
                          <div
                            className="organization-agent-card"
                            key={a.id}
                            role="button"
                            tabIndex={0}
                              onClick={() => setSelectedAgentId(a.id)}
                              onContextMenu={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedAgentId(a.id);
                                setAgentActionsOpen(false);
                                setContextAgentMenu({
                                  agent: a,
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                            onKeyDown={event => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedAgentId(a.id);
                              }
                            }}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              padding: 12,
                              background: active ? 'var(--surface-2)' : 'var(--canvas)',
                              border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                              borderRadius: 'var(--ui-radius)',
                              cursor: 'pointer',
                              transition: 'background 0.1s, box-shadow 0.1s',
                            }}
                            onMouseEnter={e => {
                              setHoveredAgentId(a.id);
                              if (!active) {
                                e.currentTarget.style.background = 'var(--surface)';
                              }
                            }}
                            onMouseLeave={e => {
                              setHoveredAgentId(prev => prev === a.id ? null : prev);
                              if (!active) {
                                e.currentTarget.style.background = 'var(--canvas)';
                              }
                            }}
                          >
                            {/* 头像 + 名字 */}
                            <div data-agent-card-title-row style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {isFromDb && (
                                  <input
                                    data-agent-card-select
                                    type="checkbox"
                                    aria-label={`选择 ${a.name ?? a.id}`}
                                    checked={checked}
                                    onChange={() => toggleSelectedAgent(a.id)}
                                    onClick={event => event.stopPropagation()}
                                    onMouseDown={event => event.stopPropagation()}
                                    style={{
                                      width: 14,
                                      height: 14,
                                      flexShrink: 0,
                                      accentColor: 'var(--accent)',
                                      cursor: 'pointer',
                                    }}
                                  />
                                )}
                              {renderAgentAvatar(a.avatar, { size: 32 })}
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 500,
                                    color: 'var(--text)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {a.name ?? a.id}
                                </div>
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: 'var(--subtle)',
                                    fontFamily: 'var(--font-mono)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {a.id}
                                </div>
                              </div>
                              <Tag tone={ROLE_TONE[a.role] ?? 'neutral'} size="xs">{ROLE_LABELS[a.role] ?? a.role}</Tag>
                              {/* 快速对话按钮(hover 才显示,但占位避免压住身份 tag) */}
                              <button
                                data-agent-card-chat-button
                                onClick={e => {
                                  e.stopPropagation();
                                  void handleStartConversation(a);
                                }}
                                title="直接跟这个 agent 对话"
                                style={{
                                  width: 22,
                                  height: 22,
                                  padding: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'var(--surface-2)',
                                  border: '1px solid var(--line)',
                                  borderRadius: 'var(--ui-radius)',
                                  color: 'var(--muted)',
                                  cursor: 'pointer',
                                  opacity: active || hoveredAgentId === a.id ? 1 : 0,
                                  transition: 'opacity 0.1s, color 0.1s, border-color 0.1s',
                                  flexShrink: 0,
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.color = 'var(--accent-2)';
                                  e.currentTarget.style.borderColor = 'var(--accent-line)';
                                  e.currentTarget.style.opacity = '1';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.color = 'var(--muted)';
                                  e.currentTarget.style.borderColor = 'var(--line)';
                                  if (!active) e.currentTarget.style.opacity = '0';
                                }}
                                onMouseDown={e => e.stopPropagation()}
                              >
                                <MessageSquare size={10} strokeWidth={1.75} />
                              </button>
                            </div>

                            {/* LLM + 工具数 */}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {a.llm && (
                                <Tag tone={providerModelTone} size="xs" mono>
                                  {a.llm}
                                </Tag>
                              )}
                              <Tag tone="neutral" size="xs" mono>
                                {a.tools.length} 工具
                              </Tag>
                              {isFromDb && <Tag tone="accent" size="xs">db</Tag>}
                            </div>

                            {/* 描述 */}
                            {a.description && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--subtle)',
                                  lineHeight: 1.5,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {a.description}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* 右:Agent 详情 — 窄屏宽度收缩 */}
        {selectedAgent && (
          <div
            className="organization-detail"
            style={{
              flex: '0 0 clamp(280px, 34vw, 360px)',
              flexShrink: 0,
              borderLeft: '1px solid var(--line)',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            {/* 详情顶部 */}
            <div
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                position: 'relative',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>AGENT</span>
                <span style={{ color: 'var(--faint)' }}>·</span>
                <span style={{ color: 'var(--text-2)' }}>{selectedAgent.id}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <button
                  aria-label="打开 Agent 操作菜单"
                  title="Agent 操作"
                  onClick={() => setAgentActionsOpen(open => !open)}
                  style={{
                    width: 26,
                    height: 26,
                    background: agentActionsOpen ? 'var(--surface-2)' : 'transparent',
                    border: '1px solid var(--line)',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    borderRadius: 'var(--ui-radius)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => {
                    if (!agentActionsOpen) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <MoreHorizontal size={15} strokeWidth={1.75} />
                </button>
                <button
                  onClick={() => setSelectedAgentId(null)}
                  title="关闭详情"
                  style={{
                    width: 26,
                    height: 26,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--subtle)',
                    cursor: 'pointer',
                    borderRadius: 'var(--ui-radius)',
                    fontSize: 14,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  ✕
                </button>
              </div>
              {agentActionsOpen && (
                <AgentActionsMenu
                  variant="detail"
                  agent={selectedAgent}
                  isFromDb={agents.db.some(x => x.id === selectedAgent.id)}
                  style={{
                    position: 'absolute',
                    top: 42,
                    right: 14,
                    zIndex: 10,
                  }}
                  onClose={() => setAgentActionsOpen(false)}
                  onEdit={() => setShowAgentEditor({ mode: 'edit', agent: selectedAgent })}
                  onClone={() => handleCloneAgent(selectedAgent)}
                  onTest={() => setTestAgent(selectedAgent)}
                  onConversation={() => void handleStartConversation(selectedAgent)}
                  onDelete={() => void handleDeleteAgent(selectedAgent.id)}
                />
              )}
            </div>

            {/* 详情主体 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {/* 头像 + 名字 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                {renderAgentAvatar(selectedAgent.avatar, { size: 56, fontSize: 28 })}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      color: 'var(--text)',
                      fontFamily: 'var(--font-display)',
                      marginBottom: 4,
                    }}
                  >
                    {selectedAgent.name ?? selectedAgent.id}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Tag tone={ROLE_TONE[selectedAgent.role] ?? 'neutral'} size="xs">{ROLE_LABELS[selectedAgent.role] ?? selectedAgent.role}</Tag>
                    {agents.db.some(x => x.id === selectedAgent.id) && <Tag tone="accent" size="xs">db</Tag>}
                  </div>
                </div>
              </div>

              {selectedAgent.description && (
                <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
                  {selectedAgent.description}
                </p>
              )}

              <DetailRow label="部门" value={selectedAgentDept ? `${selectedAgentDept.name} (${selectedAgent.department})` : selectedAgent.department} />
              <DetailRow label="LLM" value={selectedAgent.llm} mono />

              {/* 工具列表 */}
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--subtle)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  工具 · {selectedAgent.tools.length}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {selectedAgent.tools.map(t => (
                    <Tag key={t} tone="neutral" size="xs" mono>{t}</Tag>
                  ))}
                </div>
              </div>

              {/* System Prompt */}
              {selectedAgent.systemPrompt && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--subtle)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      marginBottom: 6,
                    }}
                  >
                    // System Prompt
                  </div>
                  <pre
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-2)',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--ui-radius)',
                      padding: 10,
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      lineHeight: 1.5,
                      maxHeight: 200,
                      overflowY: 'auto',
                    }}
                  >
                    {selectedAgent.systemPrompt}
                  </pre>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* 编辑器 */}
      {showDeptEditor && (
        <DepartmentEditor
          existing={showDeptEditor === 'new' ? null : showDeptEditor}
          departments={depts.active}
          onSave={async d => {
            const res = await fetch(apiUrl('/departments'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(d),
            });
            const data = await res.json();
            if (!res.ok) {
              toast.push({ title: '保存失败', description: data.error || '未知错误', tone: 'danger' });
              return;
            }
            toast.push({ title: '部门已保存', tone: 'ok' });
            setShowDeptEditor(null);
            refresh();
          }}
          onCancel={() => setShowDeptEditor(null)}
        />
      )}
      {showAgentEditor && (
        <AgentEditor
            existing={showAgentEditor.agent}
            mode={showAgentEditor.mode}
          departments={depts.active}
          llmProviders={company.providers}
          onSave={async a => {
            try {
              await api.upsertAgent(a);
            } catch (error: any) {
              toast.push({ title: '保存失败', description: error.message || '未知错误', tone: 'danger' });
              return;
            }
            toast.push({ title: 'Agent 已保存', tone: 'ok' });
            setShowAgentEditor(null);
            refresh();
          }}
          onCancel={() => setShowAgentEditor(null)}
        />
      )}
      {testAgent && <TestAgentModal agent={testAgent} onClose={() => setTestAgent(null)} />}
      {showCompanyTemplatePicker && (
        <CompanyTemplatePicker
          onClose={() => setShowCompanyTemplatePicker(false)}
          onApplied={() => {
            setShowCompanyTemplatePicker(false);
            refresh();
            toast.push({ title: '公司模板已套用', tone: 'ok' });
          }}
          llmProviders={company.providers}
        />
      )}
        {contextAgentMenu && typeof document !== 'undefined' && createPortal(
          <AgentActionsMenu
            variant="context"
            agent={contextAgentMenu.agent}
            isFromDb={agents.db.some(x => x.id === contextAgentMenu.agent.id)}
            style={{
              position: 'fixed',
              top: typeof window === 'undefined'
                ? contextAgentMenu.y
                : Math.min(contextAgentMenu.y, window.innerHeight - 190),
              left: typeof window === 'undefined'
                ? contextAgentMenu.x
                : Math.min(contextAgentMenu.x, window.innerWidth - 170),
              zIndex: 1000,
            }}
            onClose={() => setContextAgentMenu(null)}
            onEdit={() => setShowAgentEditor({ mode: 'edit', agent: contextAgentMenu.agent })}
            onClone={() => handleCloneAgent(contextAgentMenu.agent)}
            onTest={() => setTestAgent(contextAgentMenu.agent)}
            onConversation={() => void handleStartConversation(contextAgentMenu.agent)}
            onDelete={() => void handleDeleteAgent(contextAgentMenu.agent.id)}
          />,
          document.body,
        )}
      {confirmDialog}
    </div>
  );
}

function AgentActionsMenu({
  variant,
  agent,
  isFromDb,
  style,
  onClose,
  onEdit,
  onClone,
  onTest,
  onConversation,
  onDelete,
}: {
  variant: 'detail' | 'context';
  agent: DBAgent;
  isFromDb: boolean;
  style: React.CSSProperties;
  onClose: () => void;
  onEdit: () => void;
  onClone: () => void;
  onTest: () => void;
  onConversation: () => void;
  onDelete: () => void;
}) {
  const dataProps = variant === 'detail'
    ? { 'data-agent-detail-actions-menu': true }
    : { 'data-agent-card-context-menu': true };

  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div
      {...dataProps}
      style={{
        minWidth: 150,
        padding: 4,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        boxShadow: 'var(--shadow-md)',
        ...style,
      }}
      onClick={event => event.stopPropagation()}
      onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {isFromDb && (
        <AgentActionMenuItem
          icon={<Pencil size={13} strokeWidth={1.75} />}
          label="编辑"
          onClick={() => run(onEdit)}
        />
      )}
      <AgentActionMenuItem
        icon={<Copy size={13} strokeWidth={1.75} />}
        label={isFromDb ? '复制' : '复制为可编辑'}
        onClick={() => run(onClone)}
      />
      <AgentActionMenuItem
        icon={<Play size={13} strokeWidth={1.75} />}
        label="测试"
        onClick={() => run(onTest)}
      />
      <AgentActionMenuItem
        icon={<MessageSquare size={13} strokeWidth={1.75} />}
        label="对话"
        onClick={() => run(onConversation)}
      />
      {isFromDb && (
        <AgentActionMenuItem
          icon={<Trash2 size={13} strokeWidth={1.75} />}
          label="删除"
          danger
          onClick={() => run(onDelete)}
        />
      )}
    </div>
  );
}

function AgentActionMenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        minHeight: 34,
        padding: '7px 9px',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--ui-radius)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: danger ? 'var(--danger)' : 'var(--text-2)',
        cursor: 'pointer',
        fontSize: 12,
        textAlign: 'left',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? 'var(--danger-soft)' : 'var(--surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ display: 'flex', alignItems: 'center', color: danger ? 'var(--danger)' : 'var(--muted)' }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// 详情行
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        borderBottom: '1px solid var(--line-soft)',
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--subtle)',
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          minWidth: 60,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-2)',
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Department Editor ───────────────────────────────────────
function DepartmentEditor({ existing, departments, onSave, onCancel }: {
  existing: DBDepartment | null;
  departments: DBDepartment[];
  onSave: (d: DBDepartment) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const isEditing = Boolean(existing?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [englishName, setEnglishName] = useState(existing?.id ?? '');
  const [parentId, setParentId] = useState(existing?.parentId);
  const [description, setDescription] = useState(existing?.description ?? '');
  const canSave = canSaveDepartmentEditor({ name, englishName });

  return (
    <Modal
      open
      onClose={onCancel}
      size="md"
      title={isEditing ? `编辑部门 · ${existing?.name ?? ''}` : '新建部门'}
      footer={
        <>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--subtle)',
            }}
          >
            {englishName.trim() ? `→ ${englishName.trim()}` : '填完保存'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md" onClick={onCancel}>取消</Button>
            <Button
              variant="dark"
              size="md"
              onClick={() => {
                if (!canSave) {
                  toast.push({ title: '校验失败', description: '部门名称和英文名称是必填的，英文名称只能包含字母、数字、短横线或下划线', tone: 'warn' });
                  return;
                }
                onSave(buildDepartmentPayload({
                  existing: isEditing ? existing : null,
                  name,
                  englishName,
                  parentId,
                  description,
                }) as DBDepartment);
              }}
              disabled={!canSave}
            >
              {isEditing ? '保存' : '创建部门'}
            </Button>
          </div>
        </>
      }
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input
            label="部门名称"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="市场部"
          />
          <Input
            label="英文名称"
            hint="用于生成部门标识，如 marketing / legal"
            mono
            value={englishName}
            onChange={e => setEnglishName(e.target.value)}
            disabled={isEditing}
            placeholder="marketing"
          />
        </div>

        <ParentPicker
          current={isEditing ? existing : null}
          departments={departments}
          value={parentId}
          onChange={setParentId}
        />

        <Textarea
          label="描述"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="一句话说清这个部门干什么"
          rows={3}
        />
      </div>
    </Modal>
  );
}

function ParentPicker({
  current,
  departments,
  value,
  onChange,
}: {
  current: DBDepartment | null;
  departments: DBDepartment[];
  value: string | undefined;
  onChange: (parentId: string | undefined) => void;
}) {
  const forbiddenIds = new Set<string>();
  if (current) {
    forbiddenIds.add(current.id);
    const childrenMap = new Map<string, string[]>();
    for (const d of departments) {
      if (d.parentId) {
        const arr = childrenMap.get(d.parentId) ?? [];
        arr.push(d.id);
        childrenMap.set(d.parentId, arr);
      }
    }
    const queue = [current.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const kids = childrenMap.get(id) ?? [];
      for (const k of kids) {
        forbiddenIds.add(k);
        queue.push(k);
      }
    }
  }

  const byParent = new Map<string | undefined, DBDepartment[]>();
  for (const d of departments) {
    const arr = byParent.get(d.parentId) ?? [];
    arr.push(d);
    byParent.set(d.parentId, arr);
  }
  const flatOptions: Array<{ id: string; label: string; depth: number; disabled: boolean }> = [];
  function walk(parent: string | undefined, depth: number) {
    const kids = byParent.get(parent) ?? [];
    for (const k of kids) {
      flatOptions.push({
        id: k.id,
        label: `${'·'.repeat(depth)} ${k.name} (${k.id})`,
        depth,
        disabled: forbiddenIds.has(k.id),
      });
      walk(k.id, depth + 1);
    }
  }
  walk(undefined, 0);

  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--muted)',
          marginBottom: 5,
        }}
      >
        上级部门(选填)
      </label>
      <Select
        value={value ?? ''}
        onChange={v => onChange(v || undefined)}
        options={flatOptions.map(opt => ({
          value: opt.id,
          label: opt.disabled ? `${opt.label}  (不可选 — 会成环)` : opt.label,
          disabled: opt.disabled,
        }))}
        placeholder="(顶级部门 / 无上级)"
      />
      <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>
        选个上级让部门有层级。子部门的 agent 会算到上级。
      </div>
    </div>
  );
}

// ─── Agent Editor ───────────────────────────────────────
function AgentEditor({ existing, mode, departments, llmProviders, onSave, onCancel }: {
  existing: DBAgent | null;
  mode: AgentEditorState['mode'];
  departments: DBDepartment[];
  llmProviders: any[];
  onSave: (a: DBAgent) => void;
  onCancel: () => void;
}) {
  const vp = useViewport();
  const toast = useToast();
  const isEditing = mode === 'edit';
  const [a, setA] = useState<DBAgent & { englishName?: string }>(existing ? {
    ...existing,
    englishName: existing.id,
  } : {
    id: '',
    englishName: '',
    name: '',
    department: departments[0]?.id ?? '',
    role: 'worker',
    llm: llmProviders[0]?.id ?? '',
    systemPrompt: '',
    tools: ['read', 'write'],
    skills: [],
    avatar: '◆',
    executor: 'llm',
    cliTool: undefined,
    cliModel: undefined,
  });
  const [allTools, setAllTools] = useState<{ builtin: any[]; custom: any[] } | null>(null);
  const [allSkills, setAllSkills] = useState<Array<{ name: string; description: string }> | null>(null);
  const [cliTools, setCliTools] = useState<Array<{ name: string; command: string }>>([]);
  const [cliModels, setCliModels] = useState<string[]>([]);
  const [cliModelsLoading, setCliModelsLoading] = useState(false);
  const [cliModelsError, setCliModelsError] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(!existing);
  const availableAgentTemplates = useMemo(
    () => filterAvailableAgentTemplates(AGENT_TEMPLATES, cliTools.map(tool => tool.name)),
    [cliTools],
  );

  useEffect(() => {
    api.tools().then(d => setAllTools(d)).catch(() => setAllTools({ builtin: [], custom: [] }));
    api.skills().then(d => setAllSkills(d.installed.map(s => ({ name: s.name, description: s.description })))).catch(() => setAllSkills([]));
    api.cliTools()
      .then(d => setCliTools(d.tools.filter(t => t.available && t.modelsConfigured)))
      .catch(e => {
        setCliTools([]);
        toast.push({ title: 'CLI 检测失败', description: e.message, tone: 'danger' });
      });
  }, []);

  useEffect(() => {
    if (!a.cliTool) {
      setCliModels([]);
      setCliModelsError('');
      return;
    }
    setCliModelsLoading(true);
    setCliModelsError('');
    api.cliModels(a.cliTool)
      .then(result => setCliModels(result.models))
      .catch(e => {
        setCliModels([]);
        setCliModelsError(e.message ?? String(e));
      })
      .finally(() => setCliModelsLoading(false));
  }, [a.cliTool]);

  const applyTemplate = (t: AgentTemplate) => {
    let dept = a.department;
    if (t.team === 'frontend' || t.team === 'backend' || t.team === 'fullstack') dept = 'dev';
    else if (t.team === 'ui' || t.team === 'illustration' || t.team === 'motion') dept = 'design';
    else if (t.id === 'pm') dept = 'product';
    else if (t.id === 'qa') dept = 'qa';
    else if (t.id === 'ops') dept = 'ops';
    setA({
      ...a,
      name: t.name,
      role: t.role,
      department: dept,
      systemPrompt: t.systemPrompt,
      tools: t.tools,
      skills: (t as any).skills ?? a.skills,
      avatar: t.emoji,
      description: t.description,
      executor: (t as any).executor ?? 'llm',
      cliTool: (t as any).cliTool ?? (t as any).executor === 'cli' ? a.cliTool : undefined,
      cliModel: undefined,
    });
    setShowTemplatePicker(false);
  };

  const toggleTool = (toolId: string) => {
    setA({
      ...a,
      tools: a.tools.includes(toolId) ? a.tools.filter(t => t !== toolId) : [...a.tools, toolId],
    });
  };

  const toggleSkill = (skillName: string) => {
    const current = a.skills ?? [];
    setA({
      ...a,
      skills: current.includes(skillName) ? current.filter(s => s !== skillName) : [...current, skillName],
    });
  };
  const agentId = isEditing ? existing!.id : (a.englishName ?? '');
  const canSave = canSaveAgentIdentity({ name: a.name ?? '', englishName: agentId })
    && canSaveAgentEditor({ ...a, id: agentId }, cliModels, cliModelsLoading);
  const cliToolSelectionNotice = getCliToolSelectionNotice(a.cliTool, cliTools);

  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
      title={mode === 'clone' && existing
        ? `复制 Agent · ${existing.name ?? existing.id}`
        : mode === 'edit' && existing
          ? `编辑 Agent · ${existing.name ?? existing.id}`
          : '新建 Agent'}
      footer={
        <>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--subtle)',
            }}
          >
            {agentId.trim() ? `→ ${agentId.trim()}` : '填完保存'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md" onClick={onCancel}>取消</Button>
            <Button
              variant="dark"
              size="md"
              onClick={() => {
                if (!canSave) {
                  toast.push({ title: '校验失败', description: '显示名、英文名称、部门以及有效的执行器配置都是必填', tone: 'warn' });
                  return;
                }
                onSave(buildAgentPayload({
                  existing: isEditing ? existing : null,
                  value: a,
                }) as unknown as DBAgent);
              }}
              disabled={!canSave}
            >
              {mode === 'create' ? '创建 Agent' : '保存'}
            </Button>
          </div>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 模板选择器 */}
        {showTemplatePicker && !existing && (
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--surface-2)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--subtle)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              一键套用模板
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 6,
              }}
            >
              {availableAgentTemplates.map(t => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--ui-radius)',
                    cursor: 'pointer',
                    transition: 'border-color 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-line)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{t.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 2 }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--subtle)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.description}
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowTemplatePicker(false)}
              style={{
                marginTop: 8,
                fontSize: 11,
                color: 'var(--muted)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              → 不套模板,从空白开始
            </button>
          </div>
        )}

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: vp.isNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            <Input
              label="显示名"
              value={a.name ?? ''}
              onChange={e => setA({ ...a, name: e.target.value })}
              placeholder="前端工程师"
            />
            <Input
              label="英文名称"
              hint="英文短横线"
              mono
              value={a.englishName ?? ''}
              onChange={e => setA({ ...a, englishName: e.target.value })}
              disabled={isEditing}
              placeholder="frontend-dev"
            />
          </div>

          <div data-agent-avatar-field style={{ width: '100%', maxWidth: 420 }}>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--muted)',
                marginBottom: 5,
              }}
            >
              头像
            </label>
            <AvatarPicker
              value={a.avatar ?? ''}
              onChange={v => setA({ ...a, avatar: v })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: (a.executor ?? 'llm') === 'cli' ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>部门</label>
              <Select
                value={a.department}
                onChange={v => setA({ ...a, department: v })}
                options={departments.map(d => ({ value: d.id, label: `${d.name} (${d.id})` }))}
                placeholder="(选个部门)"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>角色</label>
              <Select
                value={a.role}
                onChange={v => setA({ ...a, role: v as any })}
                options={[
                  { value: 'head',   label: '部长（部门负责人）' },
                  { value: 'leader', label: '组长' },
                  { value: 'worker', label: '员工' },
                ]}
              />
            </div>
            {(a.executor ?? 'llm') === 'llm' && (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>LLM Provider</label>
                <Select
                  value={a.llm}
                  onChange={v => setA({ ...a, llm: v })}
                  options={
                    llmProviders.length === 0
                      ? [{ value: '', label: '(先到设置添加 LLM)', disabled: true }]
                      : llmProviders.map((p: any) => ({ value: p.id, label: `${p.id} (${p.model})` }))
                  }
                />
              </div>
            )}
          </div>

          {/* Executor: LLM chat loop vs 本地 CLI(claude code / trae) */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>执行器</label>
            <div className="grid grid-cols-2 border" style={{ borderColor: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
              {([['llm', '🧠 LLM', '使用已配置的 LLM Provider'], ['cli', '⌨️ 本地 CLI', '使用在「设置 → Tools」中显式添加的 CLI']] as const).map(([key, label, hint], i, arr) => (
                <button
                  key={key}
                  onClick={() => setA({
                    ...a,
                    executor: key,
                    llm: key === 'cli' ? '' : a.llm,
                    cliTool: key === 'llm' ? undefined : a.cliTool,
                    cliModel: key === 'llm' ? undefined : a.cliModel,
                  })}
                  className="px-3 py-2 text-left transition"
                  style={{
                    background: (a.executor ?? 'llm') === key ? 'var(--accent-soft)' : 'var(--surface)',
                    color: (a.executor ?? 'llm') === key ? 'var(--accent-2)' : 'var(--text-2)',
                    borderRight: i === arr.length - 1 ? 'none' : '1px solid var(--line)',
                    borderLeft: 'none',
                    borderTop: 'none',
                    borderBottom: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  title={hint}
                >
                  <div className="text-[12px] font-semibold" style={{ fontFamily: 'var(--font-mono)' }}>{label}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--subtle)' }}>{hint}</div>
                </button>
              ))}
            </div>
            {(a.executor ?? 'llm') === 'cli' && (
              <div style={{ marginTop: 8 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>CLI 工具</label>
                <Select
                  value={a.cliTool ?? ''}
                  onChange={v => setA({ ...a, cliTool: v, cliModel: undefined })}
                  placeholder={cliTools.length === 0 ? '(没有可用的 CLI 工具)' : '(请选择 CLI 工具)'}
                  disabled={cliTools.length === 0}
                  options={cliTools.map(t => ({ value: t.name, label: `${t.name} — ${t.command}` }))}
                />
                {a.cliTool && (() => {
                  const t = cliTools.find(x => x.name === a.cliTool);
                  return t ? (
                    <div className="text-[10px] mt-1.5" style={{ color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>
                      // {t.command}
                    </div>
                  ) : null;
                })()}
                {cliToolSelectionNotice && (
                  <div
                    role="alert"
                    style={{
                      marginTop: 6,
                      padding: '6px 10px',
                      fontSize: 11,
                      color: cliToolSelectionNotice.tone === 'danger' ? 'var(--danger)' : 'var(--warn)',
                      background: cliToolSelectionNotice.tone === 'danger' ? 'var(--danger-soft)' : 'var(--warn-soft)',
                      border: `1px solid ${cliToolSelectionNotice.tone === 'danger' ? 'var(--danger-line)' : 'var(--warn-line)'}`,
                      borderRadius: 4,
                      lineHeight: 1.5,
                    }}
                  >
                    {cliToolSelectionNotice.message}
                  </div>
                )}
                {a.cliTool && (
                  <div style={{ marginTop: 8 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>CLI 模型</label>
                    <Select
                      value={a.cliModel ?? ''}
                      onChange={v => setA({ ...a, cliModel: v })}
                      disabled={cliModelsLoading || cliModels.length === 0}
                      placeholder={cliModelsLoading ? '正在检测模型...' : '(请选择模型)'}
                      options={[
                        ...(a.cliModel && !cliModels.includes(a.cliModel)
                          ? [{ value: a.cliModel, label: `${a.cliModel}（不可用）`, disabled: true }]
                          : []),
                        ...cliModels.map(model => ({ value: model, label: model })),
                      ]}
                    />
                    {cliModelsError && (
                      <div role="alert" style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>
                        {cliModelsError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <Textarea
            label="System Prompt"
            hint="定义这个 agent 是谁、干什么、风格"
            mono
            value={a.systemPrompt}
            onChange={e => setA({ ...a, systemPrompt: e.target.value })}
            placeholder="你是..."
            rows={5}
          />

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--muted)',
                marginBottom: 8,
              }}
            >
              工具({allTools ? allTools.builtin.length + allTools.custom.length : '…'} 个,勾选可用的)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: vp.isNarrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {(allTools ? [...allTools.builtin, ...allTools.custom] : []).map(t => {
                const checked = a.tools.includes(t.name);
                const isCustom = !!allTools && allTools.custom.some(c => c.name === t.name);
                return (
                  <label
                    key={t.name}
                    title={t.description ?? ''}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      background: checked ? 'var(--accent-soft)' : 'var(--surface)',
                      border: '1px solid',
                      borderColor: checked ? 'var(--accent-line)' : 'var(--line)',
                      borderRadius: 'var(--ui-radius)',
                      cursor: 'pointer',
                      fontSize: 12,
                      transition: 'all 0.1s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(t.name)}
                      style={{ margin: 0 }}
                    />
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: checked ? 'var(--accent-2)' : 'var(--text-2)',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.name}
                    </span>
                    {isCustom && (
                      <span style={{ fontSize: 9, color: 'var(--subtle)', background: 'var(--surface-2)', padding: '0 4px', borderRadius: 2 }}>+</span>
                    )}
                  </label>
                );
              })}
            </div>
            {allTools?.custom.length === 0 && (
              <div style={{ fontSize: 10, color: 'var(--subtle)', marginTop: 6 }}>
                只看到内置工具?去「设置 → Tools」加自定义的
              </div>
            )}
          </div>

          {/* Skills */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--muted)',
                marginBottom: 8,
              }}
            >
              Skills({(a.skills ?? []).length}/{(allSkills ?? []).length || '…'},启用后会注入到 system prompt)
            </label>
            {!allSkills || allSkills.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--subtle)', padding: '8px 10px', background: 'var(--surface)', border: '1px dashed var(--line)', borderRadius: 'var(--ui-radius)' }}>
                还没装任何 skill。去「设置 → Skills」装。
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: vp.isNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                {allSkills.map(s => {
                  const checked = (a.skills ?? []).includes(s.name);
                  return (
                    <label
                      key={s.name}
                      title={s.description}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 6,
                        padding: '6px 10px',
                        background: checked ? 'var(--accent-soft)' : 'var(--surface)',
                        border: '1px solid',
                        borderColor: checked ? 'var(--accent-line)' : 'var(--line)',
                        borderRadius: 'var(--ui-radius)',
                        cursor: 'pointer',
                        fontSize: 12,
                        transition: 'all 0.1s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(s.name)}
                        style={{ margin: '2px 0 0' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: checked ? 'var(--accent-2)' : 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{s.name}</div>
                        {s.description && (
                          <div style={{ fontSize: 10, color: 'var(--subtle)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <Input
            label="描述(选填)"
            hint="一句话说清这个 agent 干什么"
            value={a.description ?? ''}
            onChange={e => setA({ ...a, description: e.target.value })}
            placeholder="前端工程师,负责..."
          />
        </div>
      </div>
    </Modal>
  );
}

// ─── Test Agent Modal ───────────────────────────────────────
function TestAgentModal({ agent, onClose }: { agent: DBAgent; onClose: () => void }) {
  const [prompt, setPrompt] = useState('用一句话介绍你自己,以及你能做什么。');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/test`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setResult({ success: false, error: e.message });
    } finally {
      setLoading(false);
    }
  };

  const prompts = [
    '一句话介绍你自己',
    '今天天气怎么样',
    '写一首关于秋天的诗',
    '列出 3 个 React 性能优化技巧',
    '解释量子计算',
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`测试 ${agent.avatar ?? '◆'} ${agent.name ?? agent.id}`}
      breadcrumb={
        <>
          <span>agents</span>
          <span style={{ color: 'var(--faint)' }}>/</span>
          <span>{agent.id}</span>
          <span style={{ color: 'var(--faint)' }}>/</span>
          <span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>test</span>
        </>
      }
      footer={
        <>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--subtle)' }}>
            {agent.department} · {agent.llm} · {agent.role}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
            <Button variant="dark" size="md" onClick={handleTest} loading={loading} disabled={!prompt.trim()}>
              ▶ 发送测试
            </Button>
          </div>
        </>
      }
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Textarea
          label="测试 Prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          mono
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {prompts.map(s => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--ui-radius)',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--faint)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}
            >
              {s}
            </button>
          ))}
        </div>

        {result && (
          <div
            style={{
              borderRadius: 'var(--ui-radius)',
              padding: 12,
              background: result.success ? 'var(--ok-soft)' : 'var(--danger-soft)',
              border: `1px solid ${result.success ? 'var(--ok-line)' : 'var(--danger-line)'}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: result.success ? 'var(--ok)' : 'var(--danger)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {result.success ? '✓ 成功' : '✕ 失败'}
              </span>
              {result.success && (
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {result.durationMs}ms · {result.usage?.inputTokens}+{result.usage?.outputTokens}t · stop: {result.stopReason}
                </span>
              )}
            </div>
            <MarkdownText
              value={result.success ? (result.text || '(无文本输出)') : result.error}
              className="agent-test-markdown"
              style={{
                background: 'var(--surface)',
                borderRadius: 'var(--ui-radius)',
                padding: 10,
                fontSize: 12,
                color: 'var(--text)',
                wordBreak: 'break-word',
                maxHeight: 320,
                overflowY: 'auto',
                lineHeight: 1.6,
              }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Company Template Picker ───────────────────────────────────────
function CompanyTemplatePicker({
  onClose,
  onApplied,
  llmProviders,
}: {
  onClose: () => void;
  onApplied: () => void;
  llmProviders: any[];
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<CompanyTemplate | null>(null);
  // 球球 review 2026-08-15:agent 的 LLM 要能单独选 + 批量选。
  // selectedDraft 是球球改后的草稿(可变),selected 是模板原值(只读)。
  const [selectedDraft, setSelectedDraft] = useState<CompanyTemplate | null>(null);
  const [loading, setLoading] = useState(false);

  // 切换模板时,深拷贝一份给球球改
  useEffect(() => {
    if (selected) {
      setSelectedDraft(structuredClone(selected));
    }
  }, [selected]);

  // 改单个 agent 的 LLM
  const updateAgentLlm = (agentId: string, llmId: string) => {
    setSelectedDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        agents: prev.agents.map(a => a.id === agentId ? { ...a, llm: llmId } : a),
      };
    });
  };

  // 批量改所有 agent 的 LLM
  const bulkSetLlm = (llmId: string) => {
    setSelectedDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        agents: prev.agents.map(a => ({ ...a, llm: llmId })),
      };
    });
  };

  const handleApply = async () => {
    if (!selectedDraft) return;
    setLoading(true);
    try {
      // 球球 review 2026-08-15:每个 agent 各自带 llm,不再需要 llmOverride 兜底。
      // 消费 server 返的 message — 包含 fallback 提示("X 个 agent 用了 fallback LLM")
      const data: any = await api.applyTemplate({
        template: selectedDraft,
        // 不传 llmOverride — 用 selectedDraft.agents 里的 llm
      });
      const message = data?.message || `已套用 ${selectedDraft.name}`;
      const hasFallback = data?.stats?.agents?.llmFallback > 0;
      toast.push({
        title: hasFallback ? '已套用,但部分 agent 用了 fallback LLM' : '已套用',
        description: message,
        tone: hasFallback ? 'warn' : 'ok',
      });
      onApplied();
    } catch (e: any) {
      toast.push({ title: '应用失败', description: e.message, tone: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="套用公司模板"
      breadcrumb={
        <>
          <span>company</span>
          <span style={{ color: 'var(--faint)' }}>/</span>
          <span>templates</span>
          <span style={{ color: 'var(--faint)' }}>/</span>
          <span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>apply</span>
        </>
      }
      footer={
        <>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--subtle)' }}>
            {selected ? `→ ${selected.departments.length} 部门 / ${selected.agents.length} agent` : '选个模板'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md" onClick={onClose}>取消</Button>
            <Button variant="dark" size="md" onClick={handleApply} loading={loading} disabled={!selected}>
              {selected ? `套用 ${selected.name}` : '选个模板'}
            </Button>
          </div>
        </>
      }
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--ui-radius)',
            padding: 10,
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.6,
          }}
        >
          一键建好整个公司(部门 + 部门架构 + 员工 agent)。已存在的部门/agent 会跳过。
        </div>

        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--subtle)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            选个模板
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {COMPANY_TEMPLATES.map(t => {
              const isSelected = selected?.id === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                    border: '1px solid',
                    borderColor: isSelected ? 'var(--accent-line)' : 'var(--line)',
                    borderLeft: isSelected ? '3px solid var(--accent)' : '1px solid var(--line)',
                    borderRadius: 'var(--ui-radius)',
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 22 }}>{t.emoji}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>
                        {t.category} · {t.scale}
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8 }}>{t.description}</p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Tag tone="neutral" size="xs" mono>{t.departments.length} 部门</Tag>
                    <Tag tone="neutral" size="xs" mono>{t.agents.length} 岗位</Tag>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {selected && (
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--ui-radius)',
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 24 }}>{selected.emoji}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{selected.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{selected.description}</div>
              </div>
            </div>

            <div
              style={{
                fontSize: 10,
                color: 'var(--subtle)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              部门结构
            </div>
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line-soft)',
                borderRadius: 'var(--ui-radius)',
                padding: 8,
                marginBottom: 12,
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {(() => {
                const byParent = new Map<string | undefined, typeof selected.departments>();
                for (const d of selected.departments) {
                  const arr = byParent.get(d.parentId) ?? [];
                  arr.push(d);
                  byParent.set(d.parentId, arr);
                }
                function render(parent: string | undefined, depth: number): React.ReactNode {
                  const kids = byParent.get(parent) ?? [];
                  return kids.map(d => (
                    <div key={d.id} style={{ paddingLeft: depth * 16, fontSize: 11, padding: '2px 0' }}>
                      <span style={{ color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>{d.id}</span>
                      <span style={{ color: 'var(--text-2)' }}> · {d.name}</span>
                      {d.head && <span style={{ color: 'var(--subtle)' }}> · 负责人 {d.head}</span>}
                      {render(d.id, depth + 1)}
                    </div>
                  ));
                }
                return render(undefined, 0);
              })()}
            </div>

            <div
              style={{
                fontSize: 10,
                color: 'var(--subtle)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              岗位({selectedDraft?.agents.length ?? 0} 个) · LLM 配置
            </div>

            {/* 球球 review 2026-08-15:批量覆盖放在上面,先批量再单独微调 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                padding: '8px 10px',
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--ui-radius)',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, fontWeight: 500 }}>
                批量设为
              </span>
              <div style={{ flex: 1 }}>
                <Select
                  value=""
                  onChange={v => v && bulkSetLlm(v)}
                  options={llmProviders.map((p: any) => ({
                    value: p.id,
                    label: `${p.id} (${p.model})`,
                  }))}
                  placeholder="(选个 LLM 一次性给所有 agent)"
                />
              </div>
            </div>

            {/* 每个 agent 单独 LLM 选择 */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                marginBottom: 12,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {selectedDraft?.agents.map(a => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    background: 'var(--surface)',
                    border: '1px solid var(--line-soft)',
                    borderRadius: 'var(--ui-radius)',
                    fontSize: 11,
                  }}
                >
                  {renderAgentAvatar(a.avatar, { size: 18, fontSize: 13 })}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                    <span style={{ color: 'var(--subtle)', fontFamily: 'var(--font-mono)', fontSize: 10, flexShrink: 0 }}>· {a.department}</span>
                  </div>
                  <div style={{ width: 200, flexShrink: 0 }}>
                    <Select
                      value={a.llm}
                      onChange={v => updateAgentLlm(a.id, v)}
                      options={llmProviders.map((p: any) => ({
                        value: p.id,
                        label: `${p.id} (${p.model})`,
                      }))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: -4, marginBottom: 8 }}>
              每个 agent 单独选 LLM(可不同);批量只是快捷操作,改完再单独调整也行。
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
