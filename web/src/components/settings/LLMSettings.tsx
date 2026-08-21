import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Play, Pencil, Trash2, Circle, Diamond, X, Search } from 'lucide-react';
import { api } from '../../api/client';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Tag } from '../ui/Tag';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SectionHeader } from '../ui/SectionHeader';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/useConfirm';
import { PlatformIcon, getPlatformLabel } from '../ui/PlatformIcon';

/**
 * 球球 review 2026-08-15:DBProvider 和 ActiveProvider 合并成一个
 *  - 之前两段 list(ACTIVE / WEB)是历史包袱,active = registry 合并后生效的
 *  - db = 球球 Web 上配的原始数据(带 apiKey)
 *  - 球球视角看,active 跟 db 是同一组,合并成一段
 *  - apiKey 不在 active 里(mask 掉),编辑时 apiKey input 留空 = 不传 = 保留原值
 */
interface DBProvider {
  id: string;
  type: 'anthropic' | 'openai';
  apiKey?: string;   // 留空 = 不更新
  /**
   * 完整 API URL(含 path),例如:
   *   - "https://api.openai.com/v1/chat/completions"
   *   - "https://api.example.com/api/paas/v4/chat/completions"
   *   - "https://api.anthropic.com/v1/messages"
   */
  endpoint?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  enabled: boolean;
  /** registry merge 来源:'db' | 'yaml' | 'env' */
  source?: string;
}

const PRESETS: Record<string, { type: string; endpoint: string; model: string; label: string }[]> = {
  openai: [
    { type: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-5', label: 'OpenAI · gpt-5' },
    { type: 'openai', endpoint: 'https://api.openai.com/v1', model: 'o3', label: 'OpenAI · o3' },
    { type: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o', label: 'OpenAI · gpt-4o' },
  ],
  anthropic: [
    { type: 'anthropic', endpoint: '', model: 'claude-sonnet-4-5', label: 'Anthropic · claude-sonnet-4-5' },
    { type: 'anthropic', endpoint: '', model: 'claude-opus-4-1', label: 'Anthropic · claude-opus-4-1' },
  ],
};

/**
 * 平台级预设 - 每个平台对应一个完整 endpoint(URL + path),提供该平台下所有主流模型
 * 用户选平台 → 自动填 endpoint → 再选具体模型
 *
 * apiStyle 标记该平台**默认**的协议风格(用户可在 form 里覆盖):
 *   - 'openai'    → OpenAI chat/completions 风格
 *   - 'anthropic' → Anthropic messages 风格
 *   - 'both'      → 同时提供两种(智谱 / MiniMax 都有 anthropic 兼容端点)
 */
interface PlatformPreset {
  id: string;
  name: string;
  type: 'openai' | 'anthropic';
  apiStyle: 'openai' | 'anthropic' | 'both';
  /**
   * 完整 API URL(含 path),用户选中平台时自动填进 endpoint input。
   * 用户可改 — 想用三方 API 的 path 直接改这里就行。
   */
  endpoint: string;
  docsUrl?: string;
  models: Array<{
    id: string;
    label: string;
    tag?: 'new' | 'reasoning' | 'fast' | 'code';
  }>;
}

/** 按协议给默认 path(用户可改) — 用在协议按钮切换时 */
const DEFAULT_PATH_BY_TYPE: Record<'openai' | 'anthropic', string> = {
  openai: '/chat/completions',
  anthropic: '/v1/messages',
};

/** 中性 placeholder — 不预设任何具体厂商,告诉用户字段语义 */
const ENDPOINT_PLACEHOLDER = 'https://your-api.com/v1/chat/completions';

const PLATFORMS: PlatformPreset[] = [
  // ─── 海外 ───
  {
    id: 'openai', name: 'OpenAI', type: 'openai', apiStyle: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', tag: 'new' },
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini', tag: 'fast' },
      { id: 'o3', label: 'o3', tag: 'reasoning' },
      { id: 'o3-mini', label: 'o3 mini', tag: 'reasoning' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', type: 'anthropic', apiStyle: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', tag: 'new' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tag: 'new' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
      { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku', tag: 'fast' },
    ],
  },
  {
    id: 'gemini', name: 'Google Gemini', type: 'openai', apiStyle: 'openai',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    docsUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', tag: 'new' },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tag: 'fast' },
    ],
  },
  {
    id: 'grok', name: 'xAI Grok', type: 'openai', apiStyle: 'openai',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    docsUrl: 'https://console.x.ai',
    models: [
      { id: 'grok-4', label: 'Grok 4', tag: 'new' },
      { id: 'grok-4-mini', label: 'Grok 4 mini', tag: 'fast' },
      { id: 'grok-3', label: 'Grok 3' },
    ],
  },
  {
    id: 'mistral', name: 'Mistral', type: 'openai', apiStyle: 'openai',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    docsUrl: 'https://console.mistral.ai',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'codestral-latest', label: 'Codestral', tag: 'code' },
      { id: 'ministral-8b-latest', label: 'Ministral 8B', tag: 'fast' },
    ],
  },
  {
    id: 'openrouter', name: 'OpenRouter (聚合)', type: 'openai', apiStyle: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    docsUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'openai/gpt-5.5', label: 'GPT-5.5' },
      { id: 'google/gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
      { id: 'x-ai/grok-4', label: 'Grok 4' },
      { id: 'deepseek/deepseek-v4', label: 'DeepSeek V4' },
      { id: 'minimax/MiniMax-M3', label: 'MiniMax M3' },
    ],
  },

  // ─── 国内 ───
  {
    id: 'deepseek', name: 'DeepSeek', type: 'openai', apiStyle: 'both',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (1.6T)', tag: 'new' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tag: 'new' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat (兼容老接口)' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1', tag: 'reasoning' },
    ],
  },
  {
    id: 'moonshot', name: 'Moonshot Kimi', type: 'openai', apiStyle: 'both',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3 (2.8T)', tag: 'new' },
      { id: 'kimi-k3-thinking', label: 'Kimi K3 (极致思考)', tag: 'reasoning' },
      { id: 'kimi-k2-0711-preview', label: 'Kimi K2' },
      { id: 'moonshot-v1-128k', label: 'Moonshot v1 128k' },
      { id: 'moonshot-v1-8k', label: 'Moonshot v1 8k', tag: 'fast' },
    ],
  },
  {
    id: 'qwen', name: '通义千问 (DashScope)', type: 'openai', apiStyle: 'both',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
    models: [
      { id: 'qwen3.6-pro', label: 'Qwen3.6-Pro (497B)', tag: 'new' },
      { id: 'qwen3.5-plus', label: 'Qwen3.5-Plus (397B)' },
      { id: 'qwen3.5-omni-plus', label: 'Qwen3.5-Omni-Plus (全模态)' },
      { id: 'qwen3.5-coder', label: 'Qwen3.5-Coder', tag: 'code' },
      { id: 'qwen3.5-flash', label: 'Qwen3.5-Flash', tag: 'fast' },
      { id: 'qwen-long', label: 'Qwen Long (1M)' },
    ],
  },
  {
    id: 'doubao', name: '豆包 (火山引擎)', type: 'openai', apiStyle: 'openai',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    docsUrl: 'https://www.volcengine.com/product/doubao',
    models: [
      { id: 'doubao-seed-2-1-pro-250623', label: 'Doubao Seed 2.1 Pro', tag: 'new' },
      { id: 'doubao-seed-2-1-turbo-250623', label: 'Doubao Seed 2.1 Turbo' },
      { id: 'doubao-seed-2-0-code', label: 'Doubao Seed 2.0 Code', tag: 'code' },
      { id: 'doubao-seed-2-0-lite', label: 'Doubao Seed 2.0 Lite', tag: 'fast' },
      { id: 'doubao-seed-1-6-250615', label: 'Doubao Seed 1.6' },
    ],
  },
  {
    id: 'zhipu', name: '智谱 GLM', type: 'openai', apiStyle: 'both',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    docsUrl: 'https://bigmodel.cn/console/apikeys',
    models: [
      { id: 'glm-5', label: 'GLM-5 (744B 开源旗舰)', tag: 'new' },
      { id: 'glm-5-turbo', label: 'GLM-5-Turbo (代理优化)', tag: 'new' },
      { id: 'glm-4.7', label: 'GLM-4.7' },
      { id: 'glm-4-plus', label: 'GLM-4 Plus' },
      { id: 'glm-4-flash', label: 'GLM-4 Flash', tag: 'fast' },
      { id: 'glm-4-long', label: 'GLM-4 Long (1M)' },
    ],
  },
  {
    id: 'yi', name: '零一万物 Yi', type: 'openai', apiStyle: 'openai',
    endpoint: 'https://api.lingyiwanwu.com/v1/chat/completions',
    docsUrl: 'https://platform.lingyiwanwu.com/apikeys',
    models: [
      { id: 'yi-large', label: 'Yi Large' },
      { id: 'yi-medium', label: 'Yi Medium' },
      { id: 'yi-vision', label: 'Yi Vision' },
    ],
  },
  {
    id: 'minimax', name: 'MiniMax (MiniMax)', type: 'openai', apiStyle: 'both',
    endpoint: 'https://api.MiniMax.chat/v1/chat/completions',
    docsUrl: 'https://platform.MiniMax.chat/user-center/apikeys',
    models: [
      { id: 'MiniMax-M3', label: 'MiniMax M3 (196B/11B,1M)', tag: 'new' },
      { id: 'MiniMax-M3-fast', label: 'MiniMax M3 Fast (1.5x 速度)', tag: 'fast' },
      { id: 'MiniMax-256k', label: 'MiniMax-256k (M2 系列)' },
      { id: 'MiniMax-128k', label: 'MiniMax-128k' },
    ],
  },
  {
    id: 'ollama', name: '本地 Ollama / vLLM', type: 'openai', apiStyle: 'openai',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    models: [
      { id: 'qwen3.6:40b', label: 'qwen3.6:40b (本地)' },
      { id: 'MiniMax-M3', label: 'MiniMax-M3 (开源)' },
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash (开源)' },
      { id: 'kimi-k3', label: 'kimi-k3 (开源)' },
      { id: 'glm-5', label: 'glm-5 (开源)' },
      { id: 'llama3.3:70b', label: 'llama3.3:70b' },
    ],
  },
];

// 平台预设 (PlatformPreset) — 见下面
// 旧的"快速选择 (QUICK_PICKS)"已删除:用户要的是"选协议 + 选服务商 + 选模型",
// 快速选择是多余中间层。下面直接用 PLATFORMS + 搜索框。

export function LLMSettings() {
  // 球球 review 2026-08-15:active 和 dbProviders 合并成一份(都是 provider 列表)
  const [active, setActive] = useState<DBProvider[]>([]);
  const [editing, setEditing] = useState<DBProvider | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const { lastEvent } = useWebSocket();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const refresh = async () => {
    const data = await api.providers();
    setActive(data.providers as DBProvider[]);
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (
      lastEvent?.type === 'provider_added'
      || lastEvent?.type === 'provider_updated'
      || lastEvent?.type === 'provider_deleted'
    ) {
      refresh();
    }
  }, [lastEvent]);

  const handleSave = async (p: DBProvider) => {
    if (!p.id || !p.type || !p.model) {
      toast.push({ title: '校验失败', description: 'id / type / model 都是必填', tone: 'warn' });
      return;
    }
    // 球球 review 2026-08-15:apiKey 留空 = 不传 body 字段(编辑现有 provider 不必每次重填 key)
    // 新建时 apiKey 必填由后端 400 校验
    const body: any = { ...p };
    if (!body.apiKey) delete body.apiKey;
    try {
      // 球球 review HIGH:走 http() helper,失败必 throw(之前 fetch 不 check res.ok,400 也关 modal)
      await api.upsertProvider(body);
      toast.push({ title: 'Provider 已保存', tone: 'ok' });
      setShowAdd(false);
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast.push({ title: '保存失败', description: e.message ?? String(e), tone: 'danger' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm({ title: '删除 LLM Provider', message: `删除 provider "${id}"?\n此操作不可撤销。`, danger: true, confirmText: '删除' })) return;
    try {
      await api.deleteProvider(id);
      toast.push({ title: 'Provider 已删除', tone: 'ok' });
      refresh();
    } catch (e: any) {
      toast.push({ title: '删除失败', description: e.message ?? String(e), tone: 'danger' });
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      // 球球 review HIGH:走 http() helper 统一 throw on !res.ok
      const data = await api.testProvider(id);
      if (data.success) {
        toast.push({
          title: '✓ 测试成功',
          description: `${data.durationMs}ms · ${data.tokens?.inputTokens}+${data.tokens?.outputTokens} tokens`,
          tone: 'ok',
        });
      } else {
        toast.push({ title: '✕ 测试失败', description: data.errorMessage ?? '未知错误', tone: 'danger' });
      }
    } catch (e: any) {
      toast.push({ title: '请求失败', description: e.message, tone: 'danger' });
    } finally {
      setTesting(null);
    }
  };

  return (
    <div style={{ overflowY: 'auto', padding: '20px 24px', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--subtle)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          // llm providers
        </div>
        <Button variant="dark" size="sm" onClick={() => { setEditing(null); setShowAdd(true); }} icon={<Plus size={12} strokeWidth={2} />}>
          添加 Provider
        </Button>
      </div>

      {/* 优先级说明 */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
          padding: 12,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 22, height: 22, borderRadius: 'var(--ui-radius)',
            background: 'var(--accent-soft)', color: 'var(--accent-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0,
          }}
        >
          ⓘ
        </div>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>db(Web 配置)</span>
          <span style={{ color: 'var(--muted)' }}> &gt; </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>env (.env)</span>
          <div style={{ fontSize: 10, color: 'var(--subtle)', marginTop: 2 }}>同 id 的 provider 会被高优先级覆盖。</div>
        </div>
      </div>

      {/* Provider 列表(球球 review 2026-08-15:合并 ACTIVE + WEB 两段,只显示一份 list)
          - 数据来源:registry.list() 返回的 active(已经合并 yaml + db,带 source)
          - 卡片操作:测试 / 编辑 / 删除
          - 编辑现有 provider:apiKey input 留空 = 不传 body 字段,server 保留原 key */}
      <section style={{ marginBottom: 20 }}>
        <SectionHeader eyebrow="PROVIDERS" title="Provider 列表" count={active.length} />
        {active.length === 0 ? (
          <div style={{ marginTop: 12 }}>
            <EmptyState
              icon={<Circle size={20} strokeWidth={1.5} />}
              title="没有可用 provider"
              description="点右上角 + 添加 Provider 接入第一个 LLM"
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {active.map(p => {
              const typeTone: 'openai' | 'anthropic' | 'neutral' =
                p.type === 'anthropic' ? 'anthropic' :
                p.type === 'openai' ? 'openai' : 'neutral';
              return (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderLeft: p.enabled ? '3px solid var(--accent)' : '3px solid var(--line)',
                    borderRadius: 'var(--ui-radius)',
                    padding: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.id}</span>
                      <Tag tone={typeTone} size="xs" mono>{p.type}</Tag>
                      {!p.enabled && <Tag tone="danger" size="xs">已禁用</Tag>}
                      {p.source && <Tag tone="neutral" size="xs">from {p.source}</Tag>}
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '2px 12px',
                        fontSize: 11,
                        color: 'var(--muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <div>model · <span style={{ color: 'var(--text-2)' }}>{p.model}</span></div>
                      {p.endpoint && (
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.endpoint}>
                          endpoint · <span style={{ color: 'var(--text-2)' }}>{p.endpoint}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setEditing(p); setShowAdd(true); }}
                      icon={<Pencil size={11} strokeWidth={1.75} />}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testing === p.id}
                      onClick={() => handleTest(p.id)}
                      icon={<Play size={11} strokeWidth={1.75} />}
                    >
                      测试
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(p.id)}
                      icon={<Trash2 size={11} strokeWidth={1.75} />}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add/Edit Modal */}
      {showAdd && (
        <ProviderEditor
          existing={editing}
          onSave={handleSave}
          onCancel={() => { setShowAdd(false); setEditing(null); }}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function maskKey(k: string): string {
  if (k.length <= 8) return '••••';
  return k.slice(0, 4) + '••••' + k.slice(-4);
}

function ProviderEditor({ existing, onSave, onCancel }: {
  existing: DBProvider | null;
  onSave: (p: DBProvider) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<DBProvider>(existing ?? {
    id: '',
    type: 'openai',
    apiKey: '',
    endpoint: '',
    model: 'gpt-4o',
    enabled: true,
  });
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [platformSearch, setPlatformSearch] = useState('');
  // 球球 review 2026-08-15:协议(出入参格式)与模型选择完全无关。
  // 用 ref 记录"用户是否主动改过协议":
  //   - true  → 之后 selectPlatform 也不覆盖 type,用户的选择最优先
  //   - false → 首次选平台可以"自动跟"那个平台原生协议
  // 初始:编辑现有 provider 视为已改(以现有 type 为准),新建视为未改(初始 type='openai' 会被首次选 Anthropic 平台覆盖)
  const userTouchedProtocolRef = useRef(!!existing);

  // 按"平台名/id/模型 id"过滤,大小写不敏感
  const filteredPlatforms = useMemo(() => {
    const q = platformSearch.trim().toLowerCase();
    if (!q) return PLATFORMS;
    return PLATFORMS.filter(pl =>
      pl.name.toLowerCase().includes(q) ||
      pl.id.toLowerCase().includes(q) ||
      pl.models.some(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
    );
  }, [platformSearch]);

  // 球球 review 2026-08-15:"哪来的自动配置模型"
  // 之前 selectPlatform / selectModel 都默默写 model 字段,球球没设就显示默认 model。
  // 改:model 字段**只能**显式设置(手填 input / 批量配 / 平台列表点 model → 弹 confirm)。
  // 选平台只填 type(首次)+ endpoint,model 保持原值。
  const selectPlatform = (platform: PlatformPreset) => {
    setP({
      ...p,
      ...(userTouchedProtocolRef.current ? {} : { type: platform.type }),
      endpoint: platform.endpoint,
      // 不动 model
    });
  };

  // selectModel 改语义:不直接写 model,只展开 platform 让球球看到 model 列表
  // 真正"填 model"是球球点列表里的"用这个 model"按钮(下面另外实现)
  const selectModel = (_platform: PlatformPreset, _modelId: string) => {
    // no-op:由 click handler 显式 setP({ model })
  };

  /**
   * 切协议按钮:
   *   - openai ↔ anthropic:替换 endpoint URL 的"最后一段 path"
   *     (如果当前 URL 末尾是 /chat/completions 就改成 /v1/messages,反之亦然;
   *      如果都不是,说明用户填了完全自定义的 path,不动)
   *   - 标记 userTouchedProtocolRef=true,之后 selectPlatform 也不再覆盖 type
   *
   * 球球要求"完全不要 mock" — 协议按钮只有 openai / anthropic 两个选项。
   */
  const switchProtocol = (next: 'openai' | 'anthropic') => {
    userTouchedProtocolRef.current = true;
    let newEndpoint = p.endpoint;
    if (p.endpoint) {
      const url = p.endpoint.replace(/\/$/, '');
      if (url.endsWith('/chat/completions') && next === 'anthropic') {
        newEndpoint = url.slice(0, -'/chat/completions'.length) + '/v1/messages';
      } else if (url.endsWith('/v1/messages') && next === 'openai') {
        newEndpoint = url.slice(0, -'/v1/messages'.length) + '/chat/completions';
      }
    }
    setP({
      ...p,
      type: next,
      endpoint: newEndpoint,
    });
  };

  const tagColor = (tag?: string) => {
    switch (tag) {
      case 'new': return 'bg-emerald-100 text-emerald-700';
      case 'reasoning': return 'bg-purple-100 text-purple-700';
      case 'fast': return 'bg-amber-100 text-amber-700';
      case 'code': return 'bg-blue-100 text-blue-700';
      default: return '';
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      size="xl"
      breadcrumb={
        <>
          <span style={{ padding: '1px 6px', background: 'var(--text)', color: 'var(--canvas)', borderRadius: 2, fontWeight: 600, letterSpacing: '0.04em' }}>LLM</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span style={{ color: 'var(--text-2)', letterSpacing: '0.06em' }}>提供商配置</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span style={{ color: 'var(--muted)' }}>{existing ? `编辑:${existing.id}` : '新建'}</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span style={{ color: 'var(--accent)' }}>{PLATFORMS.length} 个平台</span>
        </>
      }
      footer={
        <>
          <div
            className="text-[11px]"
            style={{
              color: 'var(--muted)',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            {p.id ? (
              <>→ 就绪 · <span style={{ color: 'var(--accent)' }}>{p.id}</span> · {p.model || '模型未选'}</>
            ) : (
              <span style={{ color: 'var(--faint)' }}>请先填写 ID 才能保存</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3.5 py-1.5 text-sm transition"
              style={{ color: 'var(--text-2)', background: 'var(--on-solid)', border: '1px solid var(--line)', borderRadius: 3 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--on-solid)')}
            >
              取消
            </button>
            <button
              onClick={() => onSave(p)}
              disabled={!p.id || !p.model}
              className="px-3.5 py-1.5 text-sm font-medium transition"
              style={{
                color: 'var(--on-solid)',
                background: (!p.id || !p.model) ? 'var(--faint)' : 'var(--text)',
                borderRadius: 3,
                cursor: (!p.id || !p.model) ? 'not-allowed' : 'pointer',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                letterSpacing: '0.04em',
              }}
              onMouseEnter={e => { if (p.id && p.model) e.currentTarget.style.background = 'var(--text-2)'; }}
              onMouseLeave={e => { if (p.id && p.model) e.currentTarget.style.background = 'var(--text)'; }}
            >
              {existing ? '⌘ 保存' : '⌘ 添加'}
            </button>
          </div>
        </>
      }
    >
      <div className="flex" style={{ width: '100%', height: '100%', minHeight: 0, fontFamily: "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" }}>
        {/* 左栏:导航 */}
        <div
          className="flex-shrink-0 flex flex-col border-r"
          style={{
            width: 288,
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
            background: 'var(--on-solid)',
            borderColor: 'var(--line)',
          }}
        >
            {/* API 协议 switcher */}
            <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
              <div
                className="text-[10px] mb-2 flex items-center justify-between"
                style={{
                  color: 'var(--subtle)',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  letterSpacing: '0.06em',
                }}
              >
                <span>协议 · PROTOCOL</span>
                <span style={{ color: p.type === 'openai' ? 'var(--ok)' : p.type === 'anthropic' ? 'var(--cat-anthropic)' : 'var(--accent)' }}>
                  {p.type}
                </span>
              </div>
              <div className="grid grid-cols-2 border" style={{ borderColor: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                <ProtocolBtn
                  label="openai"
                  hint="聊天补全"
                  active={p.type === 'openai'}
                  onClick={() => switchProtocol('openai')}
                />
                <ProtocolBtn
                  label="anthropic"
                  hint="消息格式"
                  active={p.type === 'anthropic'}
                  onClick={() => switchProtocol('anthropic')}
                  isLast
                />
              </div>
              {p.type === 'anthropic' && p.endpoint && /\/v1\/?$/.test(p.endpoint) && (
                <div
                  className="mt-2 px-2 py-1.5 text-[10px]"
                  style={{
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    borderLeft: '2px solid var(--danger)',
                    borderRadius: 2,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}
                >
                  ⚠ 端点末尾是 <strong>/v1</strong>,Anthropic 协议通常不带这一段
                </div>
              )}
              {p.type === 'openai' && p.endpoint && /anthropic/i.test(p.endpoint) && (
                <div
                  className="mt-2 px-2 py-1.5 text-[10px]"
                  style={{
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    borderLeft: '2px solid var(--danger)',
                    borderRadius: 2,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}
                >
                  ⚠ 端点含 <strong>anthropic</strong> 但你选了 OpenAI 协议
                </div>
              )}
            </div>

            {/* 全部平台 — 取代旧的「快速选择」section */}
            <div className="flex-1 flex flex-col min-h-0 px-3 py-3" style={{ overflow: 'hidden' }}>
              <div
                className="text-[10px] mb-1.5 flex items-center justify-between"
                style={{
                  color: 'var(--subtle)',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  letterSpacing: '0.06em',
                }}
              >
                <span>平台 · {filteredPlatforms.length}/{PLATFORMS.length}</span>
                {platformSearch && (
                  <button
                    onClick={() => setPlatformSearch('')}
                    style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    清空 <X size={10} strokeWidth={2} />
                  </button>
                )}
              </div>
              {/* 搜索框 */}
              <div className="mb-2 relative">
                <input
                  value={platformSearch}
                  onChange={e => setPlatformSearch(e.target.value)}
                  placeholder="搜索平台..."
                  className="w-full pl-7 pr-2 py-1.5 text-[11px] focus:outline-none transition"
                  style={{
                    background: 'var(--canvas)',
                    border: '1px solid var(--line)',
                    borderRadius: 3,
                    color: 'var(--text)',
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}
                />
                <span
                  style={{
                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--faint)', pointerEvents: 'none', display: 'inline-flex',
                  }}
                >
                  <Search size={12} strokeWidth={1.75} />
                </span>
              </div>
              <div
                className="flex-1 overflow-y-auto pr-1 min-h-0"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'var(--line-strong) transparent',
                }}
              >
                <div className="space-y-0.5">
                {filteredPlatforms.length === 0 && (
                  <div
                    className="text-[10px] py-3 text-center"
                    style={{ color: 'var(--faint)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                  >
                    没找到 "{platformSearch}" 的平台
                  </div>
                )}
                {filteredPlatforms.map(platform => {
                  const expanded = expandedPlatform === platform.id;
                  const platformSelected = p.endpoint === platform.endpoint && p.type === platform.type;
                  return (
                    <div key={platform.id}>
                      <button
                        onClick={() => {
                          if (!platformSelected) selectPlatform(platform);
                          setExpandedPlatform(expanded ? null : platform.id);
                        }}
                        className="w-full text-left px-2 py-1.5 text-[11px] flex items-center gap-2 transition"
                        style={{
                          background: platformSelected ? 'var(--accent-soft)' : 'transparent',
                          color: platformSelected ? 'var(--accent)' : 'var(--text-2)',
                          borderLeft: platformSelected ? '2px solid var(--accent)' : '2px solid transparent',
                          borderRadius: 2,
                        }}
                        onMouseEnter={e => { if (!platformSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
                        onMouseLeave={e => { if (!platformSelected) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ color: 'var(--faint)', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '10px' }}>
                          {expanded ? '▾' : '▸'}
                        </span>
                        <PlatformIcon id={platform.id} size={14} branded={platformSelected} />
                        <span className="flex-1 truncate">{platform.name}</span>
                        <ApiTag apiStyle={platform.apiStyle} />
                      </button>
                      {expanded && (
                        <div className="ml-5 my-1 space-y-0.5 border-l pl-2" style={{ borderColor: 'var(--line)' }}>
                          {platform.models.map(m => {
                            const isSelected = p.model === m.id;
                            return (
                              <button
                                key={m.id}
                                onClick={() => setP({ ...p, model: m.id })}
                                className="w-full text-left px-1.5 py-1 text-[10px] flex items-center gap-1.5 transition"
                                style={{
                                  background: isSelected ? 'var(--accent)' : 'transparent',
                                  color: isSelected ? 'var(--on-solid)' : 'var(--muted)',
                                  borderRadius: 2,
                                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                              >
                                <span className="truncate flex-1">{m.id}</span>
                                {m.tag && (
                                  <span style={{
                                    color: isSelected ? 'var(--on-solid)' : tagFgColor(m.tag),
                                    fontSize: '9px',
                                    opacity: 0.7,
                                  }}>
                                    [{m.tag}]
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          {platform.docsUrl && (
                            <a
                              href={platform.docsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block px-1.5 py-1 text-[10px] hover:underline"
                              style={{ color: 'var(--accent)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                            >
                              → 获取 API Key
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 右栏:当前配置(表单) */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6" style={{ background: 'var(--canvas)', minHeight: 0 }}>
            <div className="flex items-center justify-between mb-4">
              <div
                className="text-[10px]"
                style={{
                  color: 'var(--subtle)',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  letterSpacing: '0.06em',
                }}
              >
                // 当前配置
              </div>
              <div
                className="text-[10px] px-1.5 py-0.5"
                style={{
                  color: p.id ? 'var(--accent)' : 'var(--faint)',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  background: p.id ? 'var(--accent-soft)' : 'transparent',
                  border: '1px solid ' + (p.id ? 'var(--accent)' : 'var(--line)'),
                  borderRadius: 2,
                }}
              >
                {p.id || '未设置'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="提供商 ID" mono>
                <input
                  value={p.id}
                  onChange={e => setP({ ...p, id: e.target.value })}
                  disabled={!!existing}
                  placeholder="deepseek-v3 / claude-main"
                  className="w-full px-2.5 py-1.5 text-sm border focus:outline-none transition"
                  style={inputStyle(!!existing)}
                />
              </Field>
              <Field label="模型" mono hint={!p.model ? '未配置 · 留空就报"未配置 model"错' : undefined}>
                <input
                  value={p.model}
                  onChange={e => setP({ ...p, model: e.target.value })}
                  placeholder="手填,例如: gpt-4o / claude-sonnet-4-6 / MiniMax-M3"
                  className="w-full px-2.5 py-1.5 text-sm border focus:outline-none transition"
                  style={{
                    ...inputStyle(false),
                    borderColor: !p.model ? 'var(--danger)' : 'var(--line)',  // 红边 = 未配置
                  }}
                />
              </Field>
            </div>

            <div className="mb-3">
              <Field label="端点 (URL)" mono hint="完整 API URL,含 path。选平台预设会自动填">
                <input
                  value={p.endpoint ?? ''}
                  onChange={e => setP({ ...p, endpoint: e.target.value })}
                  placeholder={ENDPOINT_PLACEHOLDER}
                  className="w-full px-2.5 py-1.5 text-sm border focus:outline-none transition"
                  style={inputStyle(false)}
                />
              </Field>
            </div>

            <div className="mb-3">
              <Field label="API 密钥" mono>
                <input
                  type="password"
                  value={p.apiKey}
                  onChange={e => setP({ ...p, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-2.5 py-1.5 text-sm border focus:outline-none transition"
                  style={inputStyle(false)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="最大 Token" mono>
                <input
                  type="number"
                  value={p.maxTokens ?? ''}
                  onChange={e => setP({ ...p, maxTokens: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="8192"
                  className="w-full px-2.5 py-1.5 text-sm border focus:outline-none transition"
                  style={inputStyle(false)}
                />
              </Field>
              <Field label="温度" mono>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={p.temperature ?? ''}
                  onChange={e => setP({ ...p, temperature: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="0.7"
                  className="w-full px-2.5 py-1.5 text-sm border focus:outline-none transition"
                  style={inputStyle(false)}
                />
              </Field>
            </div>

            {/* 摘要框:配置 ready-to-go 状态 — 完整 URL 由用户填的 endpoint + path 拼接,无默认占位 */}
            <div
              className="mt-5 px-3 py-2.5 text-[11px]"
              style={{
                background: 'var(--on-solid)',
                border: '1px solid var(--line)',
                borderLeft: '3px solid ' + (p.type === 'openai' ? 'var(--ok)' : 'var(--cat-anthropic)'),
                borderRadius: 3,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              }}
            >
              <div style={{ color: 'var(--subtle)' }}>$ 请求预览</div>
              <div className="mt-1" style={{ color: 'var(--text-2)', wordBreak: 'break-all' }}>
                POST {p.endpoint && p.endpoint.trim()
                  ? <span style={{ color: 'var(--text)' }}>{p.endpoint.replace(/\/+$/, '')}</span>
                  : <span style={{ color: 'var(--danger)' }}>← 请填写端点</span>}
                <br />
                {p.type === 'openai'
                  ? <>Authorization: Bearer {p.apiKey ? p.apiKey.slice(0, 7) + '...' : '<API_KEY>'}</>
                  : <>x-api-key: {p.apiKey ? p.apiKey.slice(0, 7) + '...' : '<API_KEY>'}</>
                }
                <br />
                model: "{p.model || '<未设置>'}"
              </div>
            </div>
          </div>
        </div>
    </Modal>
  );
}

/**
 * 协议按钮 — 三等分控件里的一个
 */
function ProtocolBtn({ label, hint, active, onClick, isLast }: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
  isLast?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1.5 text-center transition"
      style={{
        background: active ? 'var(--text)' : 'var(--on-solid)',
        color: active ? 'var(--canvas)' : 'var(--text-2)',
        borderRight: isLast ? 'none' : '1px solid var(--line)',
        borderRadius: 0,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'var(--on-solid)'; }}
    >
      <div
        className="text-[11px] font-semibold"
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        className="text-[9px] mt-0.5"
        style={{
          color: active ? 'var(--faint)' : 'var(--subtle)',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        }}
      >
        {hint}
      </div>
    </button>
  );
}

/**
 * API 协议 tag — 平台列表里的彩色协议标识
 */
function ApiTag({ apiStyle }: { apiStyle: 'openai' | 'anthropic' | 'both' }) {
  if (apiStyle === 'both') {
    return (
      <span
        className="text-[9px] px-1"
        style={{
          color: 'var(--accent)',
          background: 'var(--accent-soft)',
          borderRadius: 2,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        }}
      >
        ⇄
      </span>
    );
  }
  if (apiStyle === 'anthropic') {
    return (
      <span
        className="text-[9px] px-1"
        style={{
          color: 'var(--cat-anthropic)',
          background: 'var(--cat-anthropic-soft)',
          borderRadius: 2,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        }}
      >
        A
      </span>
    );
  }
  return (
    <span
      className="text-[9px] px-1"
      style={{
        color: 'var(--ok)',
        background: 'var(--ok-soft)',
        borderRadius: 2,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}
    >
      O
    </span>
  );
}

/**
 * 表单 field wrapper — label 用 Inter(中文不需 monospaced,mono 只给 input 框)
 * hint: 可选灰色提示文字,显示在 label 下面
 */
function Field({ label, mono, hint, children }: { label: string; mono?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="block text-[10px] mb-1.5"
        style={{
          color: 'var(--muted)',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div
          className="mt-1 text-[10px]"
          style={{
            color: 'var(--faint)',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * input 样式 — mono font + 细描边 + 焦点时 teal
 */
function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
    fontSize: 12,
    background: disabled ? 'var(--surface-2)' : 'var(--on-solid)',
    border: '1px solid var(--line)',
    borderRadius: 3,
    color: 'var(--text)',
    outline: 'none',
  };
}

/**
 * tag 文字颜色(展开后的模型 tag)
 */
function tagFgColor(tag: string): string {
  switch (tag) {
    case 'new': return 'var(--ok)';
    case 'reasoning': return '#7C3AED';
    case 'fast': return '#B45309';
    case 'code': return '#1D4ED8';
    default: return 'var(--muted)';
  }
}
