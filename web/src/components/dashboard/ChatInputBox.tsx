/**
 * ChatInputBox — 首页"说话即开始"输入框
 *
 * 球球 review 2026-08-16:
 *  - 模仿 Cursor / Claude Code 风格(大输入框 + 工具行)
 *  - 输入话后立即开始:createProject → tick → navigate
 *  - 创造模式必须选流程,SOLO 模式必须选 Agent,并且必须选项目目录文件夹(白名单,不能任意)
 *  - 工具按钮:`+` 附件 / 清空输入 / `始终授权` 自动 approve / `思考` toggle
 *
 * 设计取舍:
 *  - 不做 @ 命令面板(MVP 简化,以后可加)
 *  - 输入内容是首条对话,不是项目标题
 */

import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, X, ChevronDown, Brain, Send, FolderOpen, Check, User, GitBranch } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { Select } from '../ui/Select';
import { api } from '../../api/client';
import type { CompanyInfo, WorkflowDefinition } from '../../api/client';
import { renderAgentAvatar } from '../ui/renderAgentAvatar';
import {
  chooseProjectDirectory,
  validateProjectDirectory,
} from '../../features/dashboard/projectDirectory';
import {
  fileToProjectAttachment,
  formatAttachmentSize,
  type ProjectAttachment,
} from '../../features/dashboard/attachments';
import { getDesktopBridge } from '../../runtime/desktopBridge';

export function ChatInputBox({ company, onCreated }: {
  company: CompanyInfo;
  /**
   * 项目创建成功后的回调 — 父组件负责跳到 ProjectView 并触发 tick
   * (避免 ChatInputBox 直接 import App.tsx 里的 navigate 闭包)
   */
  onCreated: (projectId: string, options?: { autoStart: boolean }) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [creating, setCreating] = useState(false);
  const [projectMode, setProjectMode] = useState<'creative' | 'solo'>('creative');
    const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
    const [workflowId, setWorkflowId] = useState('standard');
  const [thinking, setThinking] = useState(true);
  const [autoApprove, setAutoApprove] = useState<'always' | 'never' | 'prompt'>('always');
  // 球球 review 2026-08-16 追问:选的是 agent,不是 model
  const [agentId, setAgentId] = useState<string>('');
  const [homeDirs, setHomeDirs] = useState<Array<{ key: string; label: string; path: string; writable: boolean }>>([]);
  const [projectDir, setProjectDir] = useState<string>('');
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
    const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isElectron = getDesktopBridge() !== null;

  const handleChooseDirectory = async () => {
    setShowFolderMenu(false);
    try {
      const result = await chooseProjectDirectory(projectDir);
      if (!result.changed) return;
      setProjectDir(result.path);
      toast.push({
        title: '已选择目录',
        description: result.path,
        tone: 'ok',
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.push({ title: '选择目录失败', description, tone: 'danger' });
    }
  };

  const handleSelectHomeDirectory = async (path: string) => {
    setShowFolderMenu(false);
    try {
      const validatedPath = await validateProjectDirectory(path);
      setProjectDir(validatedPath);
      toast.push({
        title: '已选择目录',
        description: validatedPath,
        tone: 'ok',
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.push({ title: '选择目录失败', description, tone: 'danger' });
    }
  };

  // 加载 home dirs
  useEffect(() => {
    api.homeDirs().then((d: { dirs: any[] }) => {
      setHomeDirs(d.dirs);
    }).catch(() => {/* ignore,保持空 */});
  }, []);

    useEffect(() => {
      api.workflows().then((d) => {
        setWorkflows(d.workflows);
        if (!d.workflows.some(w => w.id === workflowId)) {
          setWorkflowId(d.workflows[0]?.id ?? 'standard');
        }
      }).catch(() => {
        setWorkflows([]);
        setWorkflowId('standard');
      });
    }, []);

  // 默认选第一个 agent(球球 review 2026-08-16:选 agent 不是选 model)
  useEffect(() => {
    if (!agentId && (company.agents ?? []).length > 0) {
      setAgentId((company.agents as any[])[0].id);
    }
  }, [company.agents, agentId]);

  // textarea 自动长高
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);

    const canSend = text.trim().length > 0
      && !!projectDir
      && (projectMode === 'creative' ? !!workflowId : !!agentId)
      && !creating;

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const selected = await Promise.all(Array.from(files).map(file => fileToProjectAttachment(file)));
      setAttachments(prev => [...prev, ...selected]);
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.push({ title: '附件读取失败', description, tone: 'danger' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!canSend) return;
    const title = projectMode === 'solo' ? '新的 SOLO 对话' : '新的创造项目';
    setCreating(true);
    try {
      const p = await api.createProject({
        title,
        initialMessage: text.trim(),
        projectDir,
        agentId: projectMode === 'solo' ? agentId : undefined,
        workflowId: projectMode === 'creative' ? workflowId : undefined,
        mode: projectMode,
        // 球球 review 2026-08-16:思考 + 授权开关真接 AgentRuntime
        // server 存到 project.metadata,executeTask 时读出透传到 runTask 的 opts
        thinking,
        autoApprove,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      toast.push({ title: '项目已创建', description: title, tone: 'ok' });
      setText('');
      setAttachments([]);
      // 立即跳到项目页面(父组件负责 navigate + tick)
      onCreated(p.id, { autoStart: projectMode === 'creative' });
    } catch (e: any) {
      toast.push({ title: '创建失败', description: e.message, tone: 'danger' });
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送 / Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedDirLabel = homeDirs.find((d) => d.path === projectDir)?.label
    ?? (projectDir || '未选择');
  // 球球 review 2026-08-16 追问:选 agent 不是选 model
  const selectedAgent = (company.agents ?? []).find((a: any) => a.id === agentId) as any | undefined;
  const selectedAgentLabel = selectedAgent
    ? `${selectedAgent.name ?? selectedAgent.id}${selectedAgent.role ? ` · ${selectedAgent.role}` : ''}`
    : (agentId || '未选 agent');
    const selectedWorkflow = workflows.find(w => w.id === workflowId);
    const selectedWorkflowLabel = selectedWorkflow
      ? selectedWorkflow.name
      : (workflowId || '未选流程');

  return (
    <div className="chat-input-box">
      <div className="chat-input-box__panel">
        <textarea
          ref={taRef}
          className="chat-input-box__textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder="描述你想让 AI 公司完成的工作..."
          rows={1}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 112,
            maxHeight: 220,
            padding: '18px 18px 10px',
            fontSize: 15,
            lineHeight: 1.55,
            color: 'var(--text)',
            background: 'transparent',
            border: 'none',
            boxShadow: inputFocused ? 'inset 0 0 0 1px var(--accent-line)' : 'none',
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            borderRadius: 'calc(var(--ui-radius) + 10px)',
            transition: 'box-shadow 0.12s, background 0.12s',
          }}
        />

        {attachments.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              padding: '0 14px 8px',
            }}
          >
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
                  background: 'var(--surface-2)',
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
                  onClick={() => removeAttachment(index)}
                  title="移除附件"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 18,
                    height: 18,
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  <X size={12} strokeWidth={1.8} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="chat-input-box__actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => handleFilesSelected(e.currentTarget.files)}
            style={{ display: 'none' }}
          />
        <button
          type="button"
          title="添加附件"
          onClick={() => fileInputRef.current?.click()}
          style={iconBtnStyle}
        >
          <Plus size={15} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="清空输入"
          onClick={() => setText('')}
          disabled={!text.trim()}
          style={{
            ...iconBtnStyle,
            opacity: text.trim() ? 1 : 0.45,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>

        <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            title={canSend ? '发送并开始(Enter)' : '需要输入内容 + 选流程或 Agent + 选文件夹'}
            style={{
              width: 36,
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: canSend ? 'var(--text)' : 'var(--surface-2)',
              color: canSend ? 'var(--canvas)' : 'var(--faint)',
              border: 'none',
              borderRadius: 7,
              cursor: canSend ? 'pointer' : 'not-allowed',
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            <Send size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="chat-input-box__config">
        <div className="chat-input-box__config-left">
          <div
            role="group"
            aria-label="项目模式"
            style={{
              display: 'inline-flex',
              height: 28,
              padding: 2,
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: 'var(--canvas)',
            }}
          >
            {([
              { value: 'creative' as const, label: '创造模式' },
              { value: 'solo' as const, label: 'SOLO 模式' },
            ]).map((option) => {
              const active = projectMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setProjectMode(option.value)}
                  title={option.label}
                  style={{
                    height: 22,
                    padding: '0 9px',
                    border: 'none',
                    borderRadius: 4,
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--on-solid)' : 'var(--text-2)',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <Select
            title="始终授权:危险工具直接跑 / 每次询问:MVP 简化为 always 跑+文案说明 / 从不授权:危险工具会被 runtime 拒绝(AgentRuntime.DANGEROUS_TOOLS)"
            value={autoApprove}
            onChange={(value) => {
              if (value === 'always' || value === 'prompt' || value === 'never') {
                setAutoApprove(value);
              }
            }}
            options={[
              { value: 'always', label: '始终授权' },
              { value: 'prompt', label: '每次询问' },
              { value: 'never', label: '从不授权' },
            ]}
            size="sm"
            wrapperStyle={{ width: 108 }}
            style={{
              height: 28,
              padding: '0 24px 0 10px',
              fontSize: 12,
              color: 'var(--text-2)',
              background: 'var(--canvas)',
              border: '1px solid var(--line)',
              borderRadius: 6,
            }}
          />

          <button
            type="button"
            onClick={() => setThinking(t => !t)}
            title="思考:让 agent 先分步再动手(影响 system prompt)。关掉会注入'直答模式',少废话直接给结论"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 28,
              padding: '0 10px',
              fontSize: 12,
              color: thinking ? 'var(--accent-2)' : 'var(--muted)',
              background: thinking ? 'var(--accent-soft)' : 'var(--canvas)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Brain size={13} strokeWidth={1.75} />
            思考
          </button>
        </div>

        <div className="chat-input-box__config-right">
          <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="chat-input-box__folder-trigger"
            onClick={() => setShowFolderMenu(s => !s)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 26,
              padding: '0 8px',
              fontSize: 12,
              color: 'var(--text-2)',
              background: 'transparent',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title={isElectron ? '使用 Finder 选择真实目录' : '输入由 Server 校验的绝对路径'}
          >
            <FolderOpen size={13} strokeWidth={1.75} />
            {isElectron ? '选择文件夹' : '输入本地路径'}
            {projectDir ? ` · ${selectedDirLabel}` : ''}
            <ChevronDown size={11} strokeWidth={1.75} />
          </button>
          {showFolderMenu && (
            <FolderMenu
              dirs={homeDirs}
              current={projectDir}
              onSelect={handleSelectHomeDirectory}
              onClose={() => setShowFolderMenu(false)}
              onChooseDirectory={handleChooseDirectory}
              directoryActionLabel={isElectron ? '选择文件夹' : '输入本地路径'}
            />
          )}
        </div>

          {projectMode === 'creative' && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowWorkflowMenu(s => !s)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 26,
                  padding: '0 22px 0 6px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'var(--text-2)',
                }}
                title="选择公司开发流程"
              >
                <GitBranch size={14} strokeWidth={1.75} color="var(--subtle)" />
                <span style={{ fontSize: 12, fontWeight: 500 }}>{selectedWorkflowLabel}</span>
                <ChevronDown size={11} strokeWidth={1.75} color="var(--subtle)" />
              </button>
              {showWorkflowMenu && (
                <WorkflowMenu
                  workflows={workflows}
                  current={workflowId}
                  onSelect={(id) => {
                    setWorkflowId(id);
                    setShowWorkflowMenu(false);
                  }}
                  onClose={() => setShowWorkflowMenu(false)}
                />
              )}
            </div>
          )}

          {projectMode === 'solo' && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowAgentMenu(s => !s)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 26,
                  padding: '0 22px 0 4px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'var(--text-2)',
                }}
                title="选择 SOLO 对话 Agent"
              >
                {selectedAgent
                  ? renderAgentAvatar(selectedAgent.avatar, { size: 20 })
                  : <User size={14} strokeWidth={1.75} color="var(--subtle)" />}
                <span style={{ fontSize: 12, fontWeight: 500 }}>{selectedAgentLabel}</span>
                <ChevronDown size={11} strokeWidth={1.75} color="var(--subtle)" />
              </button>
              {showAgentMenu && (
                <AgentMenu
                  agents={(company.agents ?? []) as any[]}
                  current={agentId}
                  onSelect={(id) => {
                    setAgentId(id);
                    setShowAgentMenu(false);
                  }}
                  onClose={() => setShowAgentMenu(false)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  background: 'transparent',
  border: 'none',
  borderRadius: 3,
  color: 'var(--muted)',
  cursor: 'pointer',
};

function AgentMenu({
  agents,
  current,
  onSelect,
  onClose,
}: {
  agents: any[];
  current: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-agent-menu]')) onClose();
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [onClose]);

  if (agents.length === 0) {
    return (
      <div
        data-agent-menu
        style={{
          position: 'absolute',
          bottom: '100%',
          right: 0,
          marginBottom: 4,
          minWidth: 220,
          background: 'var(--canvas)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          padding: 12,
          fontSize: 12,
          color: 'var(--muted)',
        }}
      >
        还没有 agent — 去「组织架构」加一个
      </div>
    );
  }

  return (
    <div
      data-agent-menu
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: 4,
        minWidth: 280,
        maxHeight: 320,
        overflowY: 'auto',
        background: 'var(--canvas)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        padding: 4,
        zIndex: 10,
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          fontSize: 10,
          color: 'var(--subtle)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}
      >
        选 agent(项目 owner)
      </div>
      {agents.map(a => {
        const active = a.id === current;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              color: 'var(--text)',
              background: active ? 'var(--surface-2)' : 'transparent',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            {renderAgentAvatar(a.avatar, { size: 20 })}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                {a.id}{a.role ? ` · ${a.role}` : ''}{a.department ? ` · ${a.department}` : ''}
              </div>
            </div>
            {active && <Check size={13} strokeWidth={2} color="var(--accent-2)" />}
          </button>
        );
      })}
    </div>
  );
}

type WorkflowMenuItem = Pick<
  WorkflowDefinition,
  'id' | 'name' | 'description' | 'stages' | 'builtIn'
>;

function WorkflowMenu({
  workflows,
  current,
  onSelect,
  onClose,
}: {
  workflows: WorkflowMenuItem[];
  current: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-workflow-menu]')) onClose();
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [onClose]);

  const items: WorkflowMenuItem[] = workflows.length > 0
    ? workflows
    : [{
      id: 'standard',
      name: '标准公司开发流程',
      description: 'PRD → 设计 → 研发 → QA → 交付',
      stages: ['prd', 'design', 'dev', 'qa', 'delivery'],
      builtIn: true,
    }];

  return (
    <div
      data-workflow-menu
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: 4,
        minWidth: 300,
        maxHeight: 320,
        overflowY: 'auto',
        background: 'var(--canvas)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        padding: 4,
        zIndex: 10,
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          fontSize: 10,
          color: 'var(--subtle)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}
      >
        公司开发流程
      </div>
      {items.map(w => {
        const active = w.id === current;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onSelect(w.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              fontSize: 12,
              color: 'var(--text)',
              background: active ? 'var(--surface-2)' : 'transparent',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            <GitBranch size={14} strokeWidth={1.75} color="var(--subtle)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {w.name}
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
                {w.id} · {w.stages.join(' → ')}
              </div>
            </div>
            {w.builtIn && <span style={{ fontSize: 10, color: 'var(--subtle)' }}>内置</span>}
            {active && <Check size={13} strokeWidth={2} color="var(--accent-2)" />}
          </button>
        );
      })}
    </div>
  );
}

function FolderMenu({
  dirs,
  current,
  onSelect,
  onClose,
  onChooseDirectory,
  directoryActionLabel,
}: {
  dirs: Array<{ key: string; label: string; path: string; writable: boolean }>;
  current: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  onChooseDirectory?: () => void;
  directoryActionLabel?: string;
}) {
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-folder-menu]')) onClose();
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [onClose]);

  return (
    <div
      data-folder-menu
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: 4,
        minWidth: 240,
        background: 'var(--canvas)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        padding: 4,
        zIndex: 10,
      }}
    >
      <div
        style={{
          padding: '8px 10px 6px',
          fontSize: 12,
          color: 'var(--muted)',
          fontWeight: 500,
        }}
      >
        最近
      </div>
      {dirs.length === 0 && (
        <div
          style={{
            padding: '8px 10px 12px',
            fontSize: 12,
            color: 'var(--subtle)',
          }}
        >
          暂无最近文件夹
        </div>
      )}
      {dirs.map(d => {
        const active = d.path === current;
        return (
          <button
            key={d.key}
            type="button"
            className="chat-input-box__folder-item"
            disabled={!d.writable}
            title={d.writable ? d.path : '不可写'}
            onClick={() => {
              if (!d.writable) return;
              onSelect(d.path);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              color: 'var(--text)',
              background: active ? 'var(--surface-2)' : 'transparent',
              border: 'none',
              borderRadius: 3,
              cursor: d.writable ? 'pointer' : 'not-allowed',
              opacity: d.writable ? 1 : 0.55,
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            <FolderOpen size={13} strokeWidth={1.75} color="var(--subtle)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{d.label}</div>
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
                {d.path}
              </div>
            </div>
            <span style={{ fontSize: 10, color: 'var(--danger)' }}>
              {d.writable ? null : '不可写'}
            </span>
            {active && <Check size={13} strokeWidth={2} color="var(--accent-2)" />}
          </button>
        );
      })}
      {onChooseDirectory && (
        <button
          type="button"
          className="chat-input-box__folder-action"
          onClick={onChooseDirectory}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 10px',
            marginTop: 8,
            fontSize: 12,
            color: 'var(--text)',
            background: 'transparent',
            border: 'none',
            borderTop: '1px solid var(--line-soft)',
            borderRadius: 3,
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'inherit',
          }}
        >
          <FolderOpen size={13} strokeWidth={1.75} />
          <span style={{ fontWeight: 500 }}>{directoryActionLabel ?? '选择其他目录…'}</span>
        </button>
      )}
    </div>
  );
}
