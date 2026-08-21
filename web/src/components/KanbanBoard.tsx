/**
 * KanbanBoard — 项目详情 / 任务看板 / 协作聊天
 *
 * 布局:
 *   ┌─ Kanban(自适应) ─────────────┬─ 协作聊天(360px) ─┐
 *   │ PhaseProgress                  │                    │
 *   │ 4 列(待办/进行/完成/失败)      │                    │
 *
 * 视觉:
 *   - "控制台/IDE" 风格
 *   - 极淡描边 + 4px 圆角
 *   - 不使用 emoji,平台符号统一用几何字符(◌◐◑◒▸▶▾⌕◆◇)
 *   - 全部 UI 文案中文化
 */

import { useCallback, useEffect, useState, useRef, type ReactNode } from 'react';
import { Play, FastForward, Send, Circle, CircleDot, Check, AlertOctagon, MessageSquare, X } from 'lucide-react';
import { useViewport } from './ui/useViewport';
import { api, type Project, type Task, type Message } from '../api/client';
import { MentionTextarea } from '../components/chat/MentionTextarea';
import { PageHeader } from './ui/PageHeader';
import { Tag } from './ui/Tag';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { EmptyState } from './ui/EmptyState';
import { SectionHeader } from './ui/SectionHeader';
import { useToast } from './ui/Toast';
import { getProjectStatusMeta } from '../features/projects/projectFilters';
import {
  fileToProjectAttachment,
  formatAttachmentSize,
  type ProjectAttachment,
} from '../features/dashboard/attachments';

const PHASES = [
  { id: 'prd', label: '需求', short: 'PRD' },
  { id: 'design', label: '设计', short: 'DES' },
  { id: 'dev', label: '开发', short: 'DEV' },
  { id: 'qa', label: '测试', short: 'QA' },
  { id: 'delivery', label: '交付', short: 'DLV' },
];

interface KanbanProps {
  projectId: string;
  lastEvent?: any;
  connected: boolean;
}

export function KanbanBoard({ projectId, lastEvent, connected }: KanbanProps) {
  const [data, setData] = useState<{ project: Project; tasks: Task[]; messages: Message[] } | null>(null);
  const [input, setInput] = useState('');
    const [chatAttachments, setChatAttachments] = useState<ProjectAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  // 缓存所有可用 agent(供 @ autocomplete)— 整个项目生命周期只拿一次
  const [allAgents, setAllAgents] = useState<Array<{ id: string; name?: string; role: string; avatar?: string; department: string }>>([]);
  const toast = useToast();
  const vp = useViewport();
  // <1200 视口下 chat 默认折叠(kanban 区域需要空间);>=1200 才默认展开
  const [chatOpen, setChatOpen] = useState(!vp.shouldCollapseChat);
  // 标记用户是否主动 toggle 过 — 主动 toggle 后停止跟随视口
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (!userToggledRef.current) {
      setChatOpen(!vp.shouldCollapseChat);
    }
  }, [vp.shouldCollapseChat]);

  const refresh = useCallback(async () => {
    const d = await api.project(projectId);
    setData(d);
  }, [projectId]);

  // 一次性拿所有 agent(给 @ autocomplete 用)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.agents();
        if (!cancelled) {
          setAllAgents(r.active);
        }
      } catch (e) {
        if (cancelled) return;
        toast.push({
          title: '加载 Agent 失败',
          description: e instanceof Error ? e.message : String(e),
          tone: 'danger',
        });
      }
    })();
    return () => { cancelled = true; };
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    setAwaitingReply(false);
  }, [projectId]);

  useEffect(() => {
    const affectsCurrentProject =
      (lastEvent?.type === 'project_update' && lastEvent.project?.id === projectId)
      || (lastEvent?.type === 'task_update' && lastEvent.task?.projectId === projectId)
      || (lastEvent?.type === 'message' && lastEvent.projectId === projectId);
    if (affectsCurrentProject) {
      refresh();
    }
    if (
      lastEvent?.type === 'message'
      && lastEvent.projectId === projectId
      && lastEvent.message?.fromId !== 'boss'
    ) {
      setAwaitingReply(false);
    }
  }, [lastEvent, projectId, refresh]);

  if (!data) {
    return <div style={{ padding: 32, color: 'var(--muted)' }}>加载中...</div>;
  }

  const { project, tasks, messages } = data;
  const isSoloProject = project.metadata?.mode === 'solo';

  const handleSay = async () => {
      if ((!input.trim() && chatAttachments.length === 0) || busy) return;
    setBusy(true);
    setAwaitingReply(true);
    try {
        const content = input.trim() || '请查看附件';
        await api.say(projectId, content, {
          attachments: chatAttachments.length > 0 ? chatAttachments : undefined,
        });
      setInput('');
        setChatAttachments([]);
      refresh();
      setAwaitingReply(false);
    } catch (e: any) {
      setAwaitingReply(false);
      toast.push({ title: '发送失败', description: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const handleTick = async () => {
    setBusy(true);
    try {
      await api.tick(projectId);
      await refresh();
      toast.push({ title: '已推进一格', tone: 'ok' });
    } catch (e: any) {
      toast.push({ title: '推进失败', description: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const handleRunAll = async () => {
    setBusy(true);
    let i = 0;
    try {
      let current = data.project;
      while (current.status !== 'done' && current.status !== 'failed' && i < 30) {
        await api.tick(projectId);
        await new Promise(r => setTimeout(r, 1500));
        const d = await api.project(projectId);
        current = d.project;
        setData(d);
        if (current.status === 'done' || current.status === 'failed') break;
        i++;
      }
      toast.push({ title: i >= 30 ? '已达上限' : '已跑到终点', description: `${i} 次推进`, tone: 'ok' });
    } catch (e: any) {
      toast.push({ title: '跑批失败', description: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const phaseStatus = getProjectStatusMeta(project.status).tone;
  const phaseLabel = getProjectStatusMeta(project.phase).label;

  return (
    <div className="project-board-page">
      <PageHeader
        vp={vp}
        breadcrumb={
          <>
            <span>project</span>
            <span style={{ color: 'var(--faint)' }}>/</span>
            <span>{project.id}</span>
            <span style={{ color: 'var(--faint)' }}>/</span>
            <span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>board</span>
          </>
        }
        title={project.title}
        description={project.description || '项目协作看板'}
        tags={[
          { label: isSoloProject ? 'SOLO 模式' : project.status, tone: phaseStatus },
          { label: isSoloProject ? '连续对话' : `phase · ${phaseLabel}`, tone: 'info' },
        ]}
        live={connected ? 'connected' : 'disconnected'}
        actions={isSoloProject ? undefined :
          <>
            <Button variant="secondary" size="md" onClick={handleTick} loading={busy} icon={<Play size={13} strokeWidth={1.75} />}>
              Tick 一次
            </Button>
            <Button variant="dark" size="md" onClick={handleRunAll} loading={busy} icon={<FastForward size={13} strokeWidth={1.75} />}>
              跑完所有
            </Button>
          </>
        }
      />

      <div className={`project-board-layout${isSoloProject ? ' project-board-layout--solo' : ''}`}>
        {/* Kanban */}
        {!isSoloProject && (
        <div className="project-board-main">
          {/* Phase 进度条 */}
          <PhaseProgress current={project.phase} status={project.status} compact={vp.isNarrow} />

          {/* Kanban 列 */}
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--subtle)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              任务 · {tasks.length}
            </div>
            <div
              className="project-board-columns"
              style={{
                display: 'grid',
                // 4 列始终(auto-fill + 0 minmax),让 grid 自己等分剩余宽度
                // 极窄屏(<640)退化为 1 列,避免卡片被挤到无法读
                gridTemplateColumns: vp.isNarrow
                  ? 'minmax(0, 1fr)'
                  : 'repeat(4, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              <Column
                title="待办"
                icon={<Circle size={12} strokeWidth={1.75} />}
                tone="neutral"
                count={tasks.filter(t => t.status === 'pending').length}
                tasks={tasks.filter(t => t.status === 'pending')}
              />
              <Column
                title="进行中"
                icon={<CircleDot size={12} strokeWidth={1.75} />}
                tone="warn"
                count={tasks.filter(t => t.status === 'running').length}
                tasks={tasks.filter(t => t.status === 'running')}
              />
              <Column
                title="完成"
                icon={<Check size={12} strokeWidth={2} />}
                tone="ok"
                count={tasks.filter(t => t.status === 'done').length}
                tasks={tasks.filter(t => t.status === 'done')}
              />
              <Column
                title="失败"
                icon={<AlertOctagon size={12} strokeWidth={1.75} />}
                tone="danger"
                count={tasks.filter(t => t.status === 'failed' || t.status === 'blocked').length}
                tasks={tasks.filter(t => t.status === 'failed' || t.status === 'blocked')}
              />
            </div>
          </div>
        </div>
        )}

        {/* 聊天面板 — 响应式:窄屏默认折叠成 40px 侧边条 */}
        <ChatPanel
          projectId={projectId}
          messages={messages}
          input={input}
          setInput={setInput}
            attachments={chatAttachments}
            setAttachments={setChatAttachments}
          onSend={handleSay}
          busy={busy}
          awaitingReply={awaitingReply}
          open={chatOpen}
          mobile={vp.isNarrow}
          agents={allAgents}
          solo={isSoloProject}
          onToggle={() => {
            userToggledRef.current = true;
            setChatOpen(o => !o);
          }}
        />
      </div>
    </div>
  );
}

function PhaseProgress({ current, status, compact }: { current: string; status: string; compact?: boolean }) {
  const currentIdx = PHASES.findIndex(p => p.id === current);
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        padding: compact ? 12 : 16,
      }}
    >
      <SectionHeader eyebrow="PHASE" title="阶段进度" compact={compact} rail={false} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {PHASES.map((p, i) => {
          const isDone = (i < currentIdx) || status === 'done';
          const isCurrent = i === currentIdx && status !== 'done';
          const isLast = i === PHASES.length - 1;
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 0 : 8, flexShrink: 0 }}>
                <div
                  title={`${p.label} (${p.short})`}
                  style={{
                    width: compact ? 22 : 28,
                    height: compact ? 22 : 28,
                    borderRadius: '50%',
                    background: isDone ? 'var(--ok)' : isCurrent ? 'var(--accent)' : 'var(--surface-2)',
                    color: isDone || isCurrent ? 'var(--on-solid)' : 'var(--subtle)',
                    border: '1px solid',
                    borderColor: isDone ? 'var(--ok)' : isCurrent ? 'var(--accent)' : 'var(--line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: compact ? 10 : 11,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}
                >
                  {isDone ? '✓' : i + 1}
                </div>
                {!compact && (
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: isCurrent ? 600 : 500,
                        color: isCurrent ? 'var(--accent-2)' : isDone ? 'var(--ok)' : 'var(--subtle)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.label}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: 'var(--subtle)',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {p.short}
                    </div>
                  </div>
                )}
              </div>
              {!isLast && (
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: isDone ? 'var(--ok)' : 'var(--line)',
                    margin: '0 12px',
                    transition: 'background 0.2s',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Column({
  title, icon, tone, count, tasks,
}: {
  title: string;
  icon: ReactNode;
  tone: 'neutral' | 'warn' | 'ok' | 'danger';
  count: number;
  tasks: Task[];
}) {
  const headerTone: 'neutral' | 'warn' | 'ok' | 'danger' = tone;
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 200,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span
          style={{
            color: `var(--${tone})`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-2)',
          }}
        >
          {title}
        </span>
        <Tag tone={headerTone} size="xs" mono>{count}</Tag>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 100 }}>
        {tasks.length === 0 ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--subtle)',
              textAlign: 'center',
              padding: '20px 8px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            暂无任务
          </div>
        ) : (
          tasks.map(t => <TaskCard key={t.id} task={t} />)
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const [hover, setHover] = useState(false);
  const phaseMeta = getProjectStatusMeta(task.phase);
  const phaseLabel = phaseMeta.label;
  const phaseTone = phaseMeta.tone;
  const failed = task.status === 'failed' || task.status === 'blocked';
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--canvas)',
        border: '1px solid',
        borderColor: hover ? 'var(--faint)' : 'var(--line-soft)',
        borderLeft: failed ? '2px solid var(--danger)' : task.status === 'running' ? '2px solid var(--warn)' : '2px solid transparent',
        borderRadius: 'var(--ui-radius)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
        transition: 'all 0.1s',
      }}
    >
      {/* 顶部:phase + assignee */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Tag tone={phaseTone} size="xs" mono>{phaseLabel}</Tag>
        <span
          style={{
            fontSize: 10,
            color: 'var(--subtle)',
            fontFamily: 'var(--font-mono)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={task.assignee}
        >
          → {task.assignee}
        </span>
      </div>

      {/* 标题 */}
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4 }}>
        {task.title}
      </div>

      {/* 摘要 */}
      {task.outputSummary && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--muted)',
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {task.outputSummary}
        </div>
      )}

      {/* 错误信息 */}
      {task.error && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--danger)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-line)',
            borderRadius: 'var(--ui-radius)',
            padding: '3px 6px',
            lineHeight: 1.4,
          }}
        >
          {task.error.slice(0, 100)}
        </div>
      )}

      {/* 底部:文件 + token */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>
        {task.outputFiles.length > 0 && (
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={task.outputFiles.join('\n')}
          >
            ▸ {task.outputFiles[0]?.split('/').pop()}
          </span>
        )}
        {task.cost.inputTokens > 0 && (
          <span>
            {task.cost.inputTokens}+{task.cost.outputTokens}t
          </span>
        )}
        {task.attempts > 1 && (
          <Tag tone="warn" size="xs" mono>×{task.attempts}</Tag>
        )}
      </div>
    </div>
  );
}

function ChatPanel({
  projectId: _projectId,
  messages,
  input,
  setInput,
    attachments,
    setAttachments,
  onSend,
  busy,
  awaitingReply,
  open,
  mobile,
  solo,
  onToggle,
  agents,
}: {
  projectId: string;
  messages: Message[];
  input: string;
  setInput: (s: string) => void;
    attachments: ProjectAttachment[];
    setAttachments: (attachments: ProjectAttachment[]) => void;
  onSend: () => void;
  busy: boolean;
  awaitingReply: boolean;
  open: boolean;
  mobile: boolean;
  solo?: boolean;
  onToggle: () => void;
  agents: Array<{ id: string; name?: string; role: string; avatar?: string; department: string }>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastConversationMessage = messages
    .filter(m => m.type !== 'system' && m.type !== 'tool')
    .at(-1);
  const soloAwaitingReply = !!solo && lastConversationMessage?.fromId === 'boss';
  const showReplyLoading = awaitingReply || soloAwaitingReply;
    const canSend = input.trim().length > 0 || attachments.length > 0;

    const removeChatAttachment = (index: number) => {
      setAttachments(attachments.filter((_, i) => i !== index));
    };

    const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = Array.from(event.clipboardData.items)
        .filter(item => item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (imageFiles.length === 0) return;
      event.preventDefault();
      try {
        const converted = await Promise.all(imageFiles.map((file, index) =>
          fileToProjectAttachment(file, file.name || `粘贴图片-${attachments.length + index + 1}.png`),
        ));
        setAttachments([...attachments, ...converted].slice(0, 8));
      } catch (error) {
        // 粘贴失败不阻塞文本输入,但必须把真实错误露给用户。
        const message = error instanceof Error ? error.message : String(error);
        // ChatPanel 没有 toast 依赖,用浏览器原生错误避免静默失败。
        console.error(`粘贴图片失败: ${message}`);
      }
    };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, showReplyLoading]);

  // 折叠态:40px 侧边条 + 垂直写的频道名 + 折叠按钮
  if (!open) {
    return (
      <div
        className="project-chat-collapsed"
        style={{
          width: 40,
          flexShrink: 0,
          borderLeft: '1px solid var(--line)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 10,
          gap: 8,
        }}
      >
        <button
          onClick={onToggle}
          title="展开协作面板"
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--ui-radius)',
            color: 'var(--muted)',
            fontSize: 14,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          ◂
          {messages.length > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                minWidth: 14,
                height: 14,
                padding: '0 4px',
                background: 'var(--accent)',
                color: 'var(--on-solid)',
                fontSize: 9,
                fontWeight: 600,
                borderRadius: 7,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {messages.length}
            </span>
          )}
        </button>
        <div
          style={{
            writingMode: 'vertical-rl',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--subtle)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            userSelect: 'none',
          }}
        >
          协作
        </div>
      </div>
    );
  }

  return (
    <>
      {mobile && (
        <button
          className="project-chat-overlay"
          type="button"
          aria-label="关闭协作面板"
          onClick={onToggle}
        />
      )}
      <div
        className={`project-chat-panel${solo ? ' project-chat-panel--solo' : ''}`}
        style={{
        width: 360,
        flexShrink: 0,
        borderLeft: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
      >
      {/* 顶部 */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
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
            minWidth: 0,
          }}
        >
          <span style={{ color: 'var(--accent-2)' }}>◆</span>
          <span style={{ color: 'var(--text-2)', fontWeight: 600, fontFamily: 'var(--font-body)', fontSize: 13 }}>协作</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span>#general</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <Tag tone="neutral" size="xs" mono>{messages.length} 条</Tag>
          <button
            onClick={onToggle}
            title="收起协作面板"
            style={{
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--ui-radius)',
              color: 'var(--subtle)',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            ▸
          </button>
        </div>
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.length === 0 && !showReplyLoading ? (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              icon={<MessageSquare size={20} strokeWidth={1.5} />}
              title="暂无消息"
              description="说点什么开始协作 · @职员 提及"
              compact
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
            {showReplyLoading && <MessageLoadingBubble />}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div
        style={{
          padding: 12,
          borderTop: '1px solid var(--line)',
          background: 'var(--canvas)',
          position: 'relative',
        }}
      >
        <MentionTextarea
          value={input}
          onChange={setInput}
          onSend={onSend}
          busy={busy}
          agents={agents}
          onPaste={handlePaste}
        />
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {attachments.map((attachment, index) => (
                <span
                  key={`${attachment.name}-${index}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    maxWidth: '100%',
                    height: 24,
                    padding: '0 6px 0 8px',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    background: 'var(--surface)',
                    color: 'var(--text-2)',
                    fontSize: 12,
                  }}
                  title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {attachment.name}
                  </span>
                  <span style={{ color: 'var(--subtle)', fontSize: 11 }}>
                    {formatAttachmentSize(attachment.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeChatAttachment(index)}
                    title="移除附件"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 18,
                      height: 18,
                      border: 'none',
                      borderRadius: 4,
                      background: 'transparent',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <X size={12} strokeWidth={1.75} />
                  </button>
                </span>
              ))}
            </div>
          )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>
              ⏎ 发送 · ⇧⏎ 换行 · @ 提及 · 粘贴图片
          </span>
          <div style={{ flex: 1 }} />
          <Button
            variant="dark"
            size="sm"
            onClick={onSend}
            loading={busy}
              disabled={!canSend}
            icon={<Send size={12} strokeWidth={1.75} />}
          >
            发送
          </Button>
        </div>
      </div>
      </div>
    </>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isBoss = msg.fromId === 'boss';
  const isSystem = msg.type === 'system';
  const isTool = msg.type === 'tool';
  const time = new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (isSystem) {
    return (
      <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--subtle)', padding: '4px 0' }}>
        <span
          style={{
            background: 'var(--surface-2)',
            padding: '3px 8px',
            borderRadius: 'var(--ui-radius)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {msg.content}
        </span>
      </div>
    );
  }

  if (isTool) {
    return (
      <div
        style={{
          background: 'var(--surface-2)',
          borderLeft: '2px solid var(--accent)',
          borderRadius: 'var(--ui-radius)',
          padding: '6px 8px',
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: 'var(--muted)',
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{msg.toolName}</span>{' '}
        <span style={{ wordBreak: 'break-all' }}>{msg.content.slice(0, 200)}{msg.content.length > 200 ? '...' : ''}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        background: isBoss ? 'var(--accent-soft)' : 'var(--canvas)',
        border: '1px solid',
        borderColor: isBoss ? 'var(--accent-line)' : 'var(--line-soft)',
        borderLeft: isBoss ? '2px solid var(--accent)' : '1px solid var(--line-soft)',
        borderRadius: 'var(--ui-radius)',
        padding: '8px 10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: isBoss ? 'var(--accent-2)' : 'var(--text-2)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {msg.fromName}
        </span>
        {msg.fromRole && (
          <span style={{ fontSize: 9, color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>
            · {msg.fromRole}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>{time}</span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-2)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.5,
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

function MessageLoadingBubble() {
  return (
    <div
      style={{
        background: 'var(--canvas)',
        border: '1px solid var(--line-soft)',
        borderRadius: 'var(--ui-radius)',
        padding: '8px 10px',
        color: 'var(--muted)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: 'var(--accent)',
            boxShadow: '14px 0 0 var(--accent-soft), 28px 0 0 var(--line)',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Agent 正在回复</span>
      </div>
    </div>
  );
}
