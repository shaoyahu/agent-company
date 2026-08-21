import { useEffect, useRef, useState } from 'react';
import { Send, Trash2, Sparkles, Wrench, ChevronRight, Loader2, Check, X, AlertCircle, ArrowRight } from 'lucide-react';
import { api } from '../../api/client';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/useConfirm';
import { Select } from '../ui/Select';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** assistant 消息附带:这一轮调过哪些 tool、什么结果 */
  toolCalls?: Array<{
    name: string;
    input: any;
    result: { success: boolean; output: string; data?: any };
  }>;
  /** 客户端状态:pending = 正在等回复 */
  status?: 'pending' | 'done' | 'error';
}

interface HelperDrawerProps {
  tab: 'tools' | 'skills';
  /** 关闭抽屉 — 当前不用,常驻;留给父级用 */
  onClose?: () => void;
  /** 抽屉宽度 */
  width?: number;
  /** 跳到设置 → LLM tab(引导用户配置 LLM) */
  onJumpToLLM?: () => void;
}

interface LLMInfo {
  providers: Array<{ id: string; model: string; enabled: boolean }>;
  selectedId: string | null;
}

/** 简单的工具名 → icon / tone */
const TOOL_META: Record<string, { label: string; tone: 'ok' | 'danger' | 'info' }> = {
  create_custom_tool: { label: 'create tool', tone: 'ok' },
  update_custom_tool: { label: 'update tool', tone: 'info' },
  delete_custom_tool: { label: 'delete tool', tone: 'danger' },
  install_skill: { label: 'install skill', tone: 'ok' },
  uninstall_skill: { label: 'uninstall skill', tone: 'danger' },
  get_skill_content: { label: 'read skill', tone: 'info' },
};

const TAB_LABEL = {
  tools: 'Tool Builder',
  skills: 'Skill Builder',
};

const TAB_PROMPT = {
  tools: '问我怎么创建一个自定义 tool,或者让我直接帮你创建。',
  skills: '问我怎么写一份 skill,或者直接让我帮你写 + 安装。',
};

const SUGGESTED = {
  tools: [
    '帮我创建一个 shell tool,用来 git commit 带 message',
    '我想调 webhook 通知 Slack,帮我建一个 HTTP tool',
    'shell tool 怎么写?给我个模板',
  ],
  skills: [
    '帮我写一个 brand-voice skill,定义我们的文案风格',
    '我想让所有 PM agent 自动套用一个写 PRD 的 skill',
    'skill 怎么写?给个例子',
  ],
};

export function HelperDrawer({ tab, onClose, onJumpToLLM, width = 380 }: HelperDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [llmInfo, setLlmInfo] = useState<LLMInfo | null>(null);
  const [selectedLlmId, setSelectedLlmId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { lastEvent } = useWebSocket();

  // 切 tab 时清空消息(按 tab 隔离)
  useEffect(() => {
    setMessages([]);
    setInput('');
  }, [tab]);

  // 加载可用 LLM 列表(球球 review 2026-08-15:active 和 db 合并后用 providers 字段)
  const loadLLMInfo = async () => {
    try {
      const data = await api.providers();
      const enabled = (data.providers ?? []).filter(p => p.enabled);
      setLlmInfo({
        providers: enabled.map(p => ({ id: p.id, model: p.model, enabled: true })),
        selectedId: enabled[0]?.id ?? null,
      });
      setSelectedLlmId(prev => prev ?? enabled[0]?.id ?? null);
    } catch {
      setLlmInfo({ providers: [], selectedId: null });
    }
  };

  useEffect(() => { loadLLMInfo(); }, []);

  // 监听 provider 改动(添加/删除/启用)
  useEffect(() => {
    if (
      lastEvent?.type === 'provider_added'
      || lastEvent?.type === 'provider_updated'
      || lastEvent?.type === 'provider_deleted'
    ) {
      loadLLMInfo();
    }
  }, [lastEvent]);

  // 新消息时滚到底
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages.length, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    // 没 LLM 时直接提示
    if (!llmInfo || llmInfo.providers.length === 0) {
      toast.push({ title: '需要先配置 LLM', description: '在「设置 → LLM Providers」加一个', tone: 'warn' });
      onJumpToLLM?.();
      return;
    }
    setInput('');

    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content };
    const assistantMsg: Message = {
      id: `a_${Date.now()}`,
      role: 'assistant',
      content: '',
      toolCalls: [],
      status: 'pending',
    };
    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setBusy(true);

    try {
      // 把"非 pending 的"消息发给后端(过滤掉 status=pending 的占位 assistant)
      const history = newMessages
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.status === 'done'))
        .map(m => ({ role: m.role, content: m.content }));

      const result = await api.settingsChat({ tab, messages: history, llmId: selectedLlmId ?? undefined });

      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? {
              ...m,
              content: result.reply || '(无可用回复)',
              toolCalls: result.toolCalls,
              status: 'done',
            }
          : m,
      ));

      // 弹 toast 提示改动了什么
      const created = result.toolCalls.filter(t => t.result.success && (t.name.startsWith('create') || t.name.startsWith('install')));
      if (created.length > 0) {
        toast.push({
          title: 'helper 帮你改了设置',
          description: created.map(t => `${TOOL_META[t.name]?.label ?? t.name} ✓`).join(' · '),
          tone: 'ok',
        });
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: `请求失败:${e.message ?? String(e)}`, status: 'error' }
          : m,
      ));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (messages.length === 0) return;
    if (await confirm({ title: '清空对话', message: '清空这个 tab 的对话?\n历史不会保留。', danger: true, confirmText: '清空' })) {
      setMessages([]);
    }
  };

  return (
    <>
    <aside
      style={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* 头部 */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--surface-2)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 26, height: 26, borderRadius: 'var(--ui-radius)',
            background: 'var(--accent)', color: 'var(--canvas)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {tab === 'tools' ? <Wrench size={14} /> : <Sparkles size={14} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{TAB_LABEL[tab]}</div>
          <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>助手 · HELPER</span>
            {llmInfo && llmInfo.providers.length > 0 && (
              <Select
                value={selectedLlmId ?? ''}
                onChange={setSelectedLlmId}
                options={llmInfo.providers.map(p => ({
                  value: p.id,
                  label: `${p.id} · ${p.model}`,
                }))}
                size="sm"
                title="选 LLM"
                wrapperStyle={{ width: 132 }}
                style={{
                  height: 24,
                  padding: '0 24px 0 7px',
                  fontSize: 9,
                }}
              />
            )}
          </div>
        </div>
        <button
          onClick={clear}
          title="清空对话"
          disabled={messages.length === 0}
          style={{
            width: 24, height: 24, borderRadius: 'var(--ui-radius)',
            background: 'transparent', border: 'none',
            color: messages.length === 0 ? 'var(--faint)' : 'var(--subtle)',
            cursor: messages.length === 0 ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Trash2 size={12} />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            title="收起"
            style={{
              width: 24, height: 24, borderRadius: 'var(--ui-radius)',
              background: 'transparent', border: 'none', color: 'var(--subtle)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* 消息区 */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          !llmInfo ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--subtle)', fontSize: 11 }}>
              <Loader2 size={14} className="animate-spin" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> 加载中…
            </div>
          ) : llmInfo.providers.length === 0 ? (
            <NoLLMCard onJumpToLLM={onJumpToLLM} />
          ) : (
            <div style={{ padding: '8px 0' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
                {TAB_PROMPT[tab]}
              </div>
              <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                // 试试问
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SUGGESTED[tab].map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--ui-radius)',
                      color: 'var(--text-2)',
                      fontSize: 12,
                      cursor: 'pointer',
                      lineHeight: 1.5,
                    }}
                  >
                    <ChevronRight size={10} style={{ verticalAlign: 'middle', marginRight: 4, color: 'var(--faint)' }} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {messages.map(m => (
          <MessageBubble key={m.id} msg={m} />
        ))}

        {/* pending assistant 气泡(MessageBubble 的 status==='pending' 分支)已经显示 loading,这里不重复 */}
      </div>

      {/* 输入区 */}
      <div
        style={{
          borderTop: '1px solid var(--line)',
          padding: '10px 12px',
          background: 'var(--surface-2)',
          flexShrink: 0,
        }}
      >
        <form
          onSubmit={e => { e.preventDefault(); send(input); }}
          style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}
        >
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={
              !llmInfo || llmInfo.providers.length === 0
                ? '先去「设置 → LLM」配置一个 provider…'
                : '问 helper 怎么写,或让它直接帮你做…'
            }
            rows={2}
            disabled={busy || !llmInfo || llmInfo.providers.length === 0}
            className="flex-1 px-2.5 py-1.5 text-[12px] border"
            style={{
              fontFamily: 'inherit',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--ui-radius)',
              color: 'var(--text)',
              resize: 'none',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim() || !llmInfo || llmInfo.providers.length === 0}
            className="px-2.5 py-1.5"
            style={{
              background: busy || !input.trim() || !llmInfo || llmInfo.providers.length === 0 ? 'var(--surface-2)' : 'var(--accent)',
              color: busy || !input.trim() || !llmInfo || llmInfo.providers.length === 0 ? 'var(--faint)' : 'var(--canvas)',
              border: '1px solid',
              borderColor: busy || !input.trim() || !llmInfo || llmInfo.providers.length === 0 ? 'var(--line)' : 'var(--accent)',
              borderRadius: 'var(--ui-radius)',
              cursor: busy || !input.trim() || !llmInfo || llmInfo.providers.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 34,
            }}
          >
            <Send size={14} />
          </button>
        </form>
        <div style={{ fontSize: 10, color: 'var(--subtle)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
          {(!llmInfo || llmInfo.providers.length === 0)
            ? '⚠ 需要先配置 LLM'
            : 'Enter 发送 · Shift+Enter 换行'}
        </div>
      </div>
    </aside>
    {confirmDialog}
    </>
  );
}

function NoLLMCard({ onJumpToLLM }: { onJumpToLLM?: () => void }) {
  return (
    <div
      style={{
        padding: '14px 12px',
        background: 'var(--warn-soft)',
        border: '1px solid var(--warn-line)',
        borderLeft: '3px solid var(--warn)',
        borderRadius: 'var(--ui-radius)',
        color: 'var(--text-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <AlertCircle size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>需要先配置 LLM</div>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
        Helper 需要一个能跑对话的 LLM。现在一个都没装,所以我没法帮你。
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
          background: 'color-mix(in srgb, var(--surface) 50%, transparent)',
          padding: '8px 10px',
          borderRadius: 'var(--ui-radius)',
          marginBottom: 12,
          lineHeight: 1.6,
        }}
      >
        // 步骤
        <br />
        1. 打开 <strong style={{ color: 'var(--text)' }}>设置 → LLM Providers</strong>
        <br />
        2. 点「+ 添加 Provider」选平台(OpenAI / Claude / DeepSeek ...)
        <br />
        3. 填 API key,保存
        <br />
        4. 回到这里,Helper 就能用了
      </div>
      <button
        onClick={() => onJumpToLLM?.()}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'var(--accent)',
          color: 'var(--canvas)',
          border: 'none',
          borderRadius: 'var(--ui-radius)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        打开 LLM 设置 <ArrowRight size={12} />
      </button>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            maxWidth: '85%',
            padding: '8px 12px',
            background: 'var(--accent)',
            color: 'var(--canvas)',
            borderRadius: 'var(--ui-radius)',
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {msg.status === 'pending' && !msg.content ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--subtle)', fontSize: 12, padding: '0 4px' }}>
          <Loader2 size={12} className="animate-spin" />
          <span>helper 在想…</span>
        </div>
      ) : (
        <>
          <div
            style={{
              maxWidth: '90%',
              padding: '8px 12px',
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--ui-radius)',
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: msg.status === 'error' ? 'var(--danger)' : 'var(--text)',
            }}
          >
            {msg.content}
          </div>
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 4px' }}>
              {msg.toolCalls.map((tc, i) => {
                const meta = TOOL_META[tc.name] ?? { label: tc.name, tone: 'info' as const };
                return (
                  <span
                    key={i}
                    title={tc.result.output}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '1px 6px',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      background: tc.result.success ? 'var(--ok-soft)' : 'var(--danger-soft)',
                      color: tc.result.success ? 'var(--ok)' : 'var(--danger)',
                      border: '1px solid',
                      borderColor: tc.result.success ? 'var(--ok-line)' : 'var(--danger-line)',
                      borderRadius: 'var(--ui-radius)',
                    }}
                  >
                    {tc.result.success ? <Check size={9} /> : <X size={9} />}
                    {meta.label}
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
