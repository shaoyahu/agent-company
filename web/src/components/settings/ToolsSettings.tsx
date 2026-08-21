import { useEffect, useState } from 'react';
import { Plus, Play, Pencil, Trash2, Wrench, Terminal, Globe, FileText, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Tag } from '../ui/Tag';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SectionHeader } from '../ui/SectionHeader';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { HelperDrawer } from './HelperDrawer';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/useConfirm';
import {
  applyDiscoveredCli,
  getCliConfigurationState,
  normalizeCliToolConfig,
  type CliModelsParser,
  type DiscoveredCli,
} from '../../features/settings/cliToolModel';

interface BuiltinTool {
  name: string;
  description: string;
}

interface CustomTool {
  id: string;
  name: string;
  type: 'http' | 'shell' | 'prompt' | 'cli';
  description: string;
  config: any;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

const TYPE_META = {
  http:   { label: 'HTTP',  icon: Globe,      tone: 'info' as const,    hint: '调用远端 endpoint,input 作为 body/query' },
  shell:  { label: 'Shell', icon: Terminal,   tone: 'warn' as const,   hint: '执行 shell 命令模板,{{param}} 占位' },
  prompt: { label: 'Prompt',icon: FileText,   tone: 'neutral' as const,hint: '渲染 prompt 模板,返回文本(不调用外部)' },
  // 防御:db 里可能有 type=cli(给 cli executor 用,不该在 custom tools 列表里编辑)
  // 球球 review 2026-08-16:之前 type=cli 的 tool 残留让 .map 里 TYPE_META[t.type].icon 崩
  cli:    { label: 'CLI',   icon: Wrench,     tone: 'neutral' as const, hint: '本机 CLI executor 与模型探测配置' },
};

function typeMeta(t: string) {
  return (TYPE_META as Record<string, (typeof TYPE_META)[keyof typeof TYPE_META]>)[t]
    ?? TYPE_META.cli;  // 未知 type 走 cli 兜底
}

export function ToolsSettings({ onJumpToLLM }: { onJumpToLLM?: () => void } = {}) {
  const [data, setData] = useState<{ builtin: BuiltinTool[]; custom: CustomTool[] } | null>(null);
  const [editing, setEditing] = useState<CustomTool | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<CustomTool['type']>('http');
  const [testing, setTesting] = useState<string | null>(null);
  const { lastEvent } = useWebSocket();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const refresh = async () => {
    const d = await api.tools();
    setData(d);
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (lastEvent?.type === 'tool_updated' || lastEvent?.type === 'tool_deleted') {
      refresh();
    }
  }, [lastEvent]);

  const handleSave = async (t: Partial<CustomTool> & { name: string; type: CustomTool['type'] }) => {
    try {
      const res: any = await api.upsertTool(t);
      toast.push({ title: t.id ? '已保存' : '已创建', tone: 'ok' });
      setShowAdd(false);
      setEditing(null);
      refresh();
      return res;
    } catch (e: any) {
      toast.push({ title: '保存失败', description: e.message, tone: 'danger' });
    }
  };

  const handleDelete = async (t: CustomTool) => {
    if (!await confirm({ title: '删除自定义 tool', message: `删除自定义 tool "${t.name}"?\n此操作不可撤销。`, danger: true, confirmText: '删除' })) return;
    await api.deleteTool(t.id);
    toast.push({ title: '已删除', tone: 'ok' });
    refresh();
  };

  const handleQuickTest = async (t: CustomTool) => {
    setTesting(t.id);
    try {
      // 简单测试:传一个空对象 / 或者 shell 的占位
      const sample: Record<string, unknown> = {};
      if (t.type === 'shell') {
        const cfg = t.config as { params?: string[] };
        for (const p of cfg.params ?? []) sample[p] = 'test';
      }
      const result = await api.testTool({ type: t.type, config: t.config, input: sample });
      toast.push({
        title: result.success ? '✓ 测试成功' : '✕ 测试失败',
        description: (result.output || '').slice(0, 200),
        tone: result.success ? 'ok' : 'danger',
      });
    } catch (e: any) {
      toast.push({ title: '请求失败', description: e.message, tone: 'danger' });
    } finally {
      setTesting(null);
    }
  };

  if (!data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--subtle)' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> 加载中…</div>;
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          // tools
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setEditing(null); setAddType('cli'); setShowAdd(true); }}
            icon={<Terminal size={12} strokeWidth={2} />}
          >
            添加本机 CLI
          </Button>
          <Button
            variant="dark"
            size="sm"
            onClick={() => { setEditing(null); setAddType('http'); setShowAdd(true); }}
            icon={<Plus size={12} strokeWidth={2} />}
          >
            自定义 Tool
          </Button>
        </div>
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
          padding: 12,
          marginBottom: 16,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 'var(--ui-radius)', background: 'var(--accent-soft)', color: 'var(--accent-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>ⓘ</div>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          本机 CLI 用于直接执行已安装的命令行程序，并在保存前探测可用模型。HTTP、Shell、Prompt
          是 Agent 在 LLM 执行过程中可调用的工具。
        </div>
      </div>

      {/* 内置工具 */}
      <section style={{ marginBottom: 20 }}>
        <SectionHeader eyebrow="BUILT-IN" title="内置工具" count={data.builtin.length} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6, marginTop: 12 }}>
          {data.builtin.map(t => (
            <div
              key={t.name}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--ui-radius)',
                padding: 10,
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}
            >
              <Wrench size={12} style={{ marginTop: 2, color: 'var(--muted)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{t.description}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 自定义工具 */}
      <section>
        <SectionHeader eyebrow="CUSTOM" title="自定义工具" count={data.custom.length} />
        {data.custom.length === 0 ? (
          <div style={{ marginTop: 12 }}>
            <EmptyState
              icon={<Wrench size={20} strokeWidth={1.5} />}
              title="还没有自定义 tool"
              description="添加本机 CLI，或创建 HTTP / Shell / Prompt 工具"
              action={(
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" onClick={() => { setEditing(null); setAddType('cli'); setShowAdd(true); }}>添加本机 CLI</Button>
                  <Button variant="secondary" onClick={() => { setEditing(null); setAddType('http'); setShowAdd(true); }}>自定义 Tool</Button>
                </div>
              )}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {data.custom.map(t => {
              const meta = typeMeta(t.type);
              const Icon = meta.icon;
              return (
                <div
                  key={t.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderLeft: t.enabled ? '3px solid var(--accent)' : '3px solid var(--line)',
                    borderRadius: 'var(--ui-radius)',
                    padding: 12,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 'var(--ui-radius)', background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-2)' }}>
                    <Icon size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{t.name}</span>
                      <Tag tone={meta.tone} size="xs" mono>{meta.label}</Tag>
                      {!t.enabled && <Tag tone="danger" size="xs">已禁用</Tag>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                      {t.description || meta.hint}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {summarizeConfig(t.type, t.config)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testing === t.id}
                      onClick={() => handleQuickTest(t)}
                      icon={<Play size={10} strokeWidth={1.75} />}
                    >
                      测试
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setEditing(t); setShowAdd(true); }}
                      icon={<Pencil size={11} strokeWidth={1.75} />}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(t)}
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

      {showAdd && (
        <ToolEditor
          existing={editing}
          initialType={addType}
          onSave={handleSave}
          onCancel={() => { setShowAdd(false); setEditing(null); }}
        />
      )}
    </div>
    <HelperDrawer tab="tools" onJumpToLLM={onJumpToLLM} />
    {confirmDialog}
    </div>
  );
}

function summarizeConfig(type: string, cfg: any): string {
  if (!cfg) return '';
  if (type === 'http') return `${(cfg.method ?? 'POST')} ${cfg.url ?? '(no url)'}`;
  if (type === 'shell') return `shell: ${(cfg.command ?? '').slice(0, 60)}`;
  if (type === 'prompt') return `prompt: ${(cfg.template ?? '').slice(0, 60)}`;
  if (type === 'cli') return `cli: ${(cfg.command ?? '').slice(0, 60)}`;
  return JSON.stringify(cfg).slice(0, 60);
}

// ─── Editor ───────────────────────────────────────────
function ToolEditor({ existing, initialType, onSave, onCancel }: {
  existing: CustomTool | null;
  initialType: CustomTool['type'];
  onSave: (t: any) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<CustomTool['type']>(existing?.type ?? initialType);
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [configText, setConfigText] = useState(() => JSON.stringify(existing?.config ?? defaultConfigFor(initialType), null, 2));
  const [cliConfig, setCliConfig] = useState(() => normalizeCliToolConfig(existing?.config ?? defaultConfigFor(initialType)));
  const [testInput, setTestInput] = useState('{}');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output: string } | null>(null);
  const [discoveredClis, setDiscoveredClis] = useState<DiscoveredCli[]>([]);
  const [discoveringClis, setDiscoveringClis] = useState(false);
  const [cliDiscoveryError, setCliDiscoveryError] = useState('');
  const toast = useToast();

  const loadDiscoveredClis = async () => {
    setDiscoveringClis(true);
    setCliDiscoveryError('');
    try {
      const result = await api.discoveredCliTools();
      setDiscoveredClis(result.tools);
    } catch (e: any) {
      setDiscoveredClis([]);
      setCliDiscoveryError(e.message ?? String(e));
    } finally {
      setDiscoveringClis(false);
    }
  };

  useEffect(() => {
    if (type === 'cli' && !existing) void loadDiscoveredClis();
  }, [type, existing]);

  const onChangeType = (t: CustomTool['type']) => {
    setType(t);
    setConfigText(JSON.stringify(defaultConfigFor(t), null, 2));
    setCliConfig(normalizeCliToolConfig(defaultConfigFor(t)));
  };

  const save = () => {
    if (!name) {
      toast.push({ title: '需要 name', tone: 'warn' });
      return;
    }
    let cfg: any = normalizeCliToolConfig(cliConfig);
    if (type === 'cli') {
      if (!cfg.command.trim() || !cfg.argsTemplate.trim()) {
        toast.push({ title: 'CLI 路径和执行参数模板为必填项', tone: 'warn' });
        return;
      }
      if (cfg.staticModels.length === 0 && !cfg.modelsCommand.trim()) {
        toast.push({ title: '请提供推荐模型或模型列表命令', tone: 'warn' });
        return;
      }
      if (cfg.modelsParser.type === 'json-path' && !cfg.modelsParser.path.trim()) {
        toast.push({ title: 'JSON Path 为必填项', tone: 'warn' });
        return;
      }
      if (cfg.modelsParser.type === 'regex' && !cfg.modelsParser.pattern.trim()) {
        toast.push({ title: '正则表达式为必填项', tone: 'warn' });
        return;
      }
    } else {
      try {
        cfg = JSON.parse(configText);
      } catch (e: any) {
        toast.push({ title: 'config 不是合法 JSON', description: e.message, tone: 'danger' });
        return;
      }
    }
    onSave({ id: existing?.id, name, type, description, enabled, config: cfg });
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const cfg = type === 'cli' ? normalizeCliToolConfig(cliConfig) : JSON.parse(configText);
      let input: Record<string, unknown> = {};
      if (type !== 'cli') {
        try { input = JSON.parse(testInput); } catch {}
      }
      const result = await api.testTool({ type, config: cfg, input });
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ success: false, output: e.message ?? String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
      height="viewport-90"
      breadcrumb={
        <>
          <span style={{ padding: '1px 6px', background: 'var(--text)', color: 'var(--canvas)', borderRadius: 2, fontWeight: 600, letterSpacing: '0.04em' }}>TOOL</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span style={{ color: 'var(--text-2)' }}>{existing ? `编辑 ${existing.name}` : type === 'cli' ? '添加本机 CLI' : '新建自定义 Tool'}</span>
        </>
      }
      footer={
        <>
          <div className="text-[11px]" style={{ color: 'var(--muted)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            {name ? <>→ <span style={{ color: 'var(--accent)' }}>{name}</span> · {type}</> : <span style={{ color: 'var(--faint)' }}>填入 name 才能保存</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="px-3.5 py-1.5 text-sm" style={{ color: 'var(--text-2)', background: 'var(--on-solid)', border: '1px solid var(--line)', borderRadius: 3 }}>取消</button>
            <button onClick={save} disabled={!name} className="px-3.5 py-1.5 text-sm font-medium" style={{ color: 'var(--on-solid)', background: !name ? 'var(--faint)' : 'var(--text)', borderRadius: 3, cursor: !name ? 'not-allowed' : 'pointer' }}>
              {existing ? '⌘ 保存' : '⌘ 添加'}
            </button>
          </div>
        </>
      }
    >
      <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="调用名 (name)" mono>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={!!existing}
                placeholder="my_tool / send_slack"
                className="w-full px-2.5 py-1.5 text-sm border"
                style={inputStyle()}
              />
            </Field>
            <Field label="类型">
              <div className="grid grid-cols-4 border" style={{ borderColor: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                {(['http', 'shell', 'prompt', 'cli'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => onChangeType(t)}
                    className="px-2 py-1.5 text-center transition"
                    style={{
                      background: type === t ? 'var(--text)' : 'var(--on-solid)',
                      color: type === t ? 'var(--canvas)' : 'var(--text-2)',
                      borderRight: t === 'cli' ? 'none' : '1px solid var(--line)',
                    }}
                  >
                    <div className="text-[11px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{typeMeta(t).label}</div>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="启用">
              <button
                onClick={() => setEnabled(!enabled)}
                className="w-full px-2.5 py-1.5 text-sm border text-left"
                style={{ ...inputStyle(), background: enabled ? 'var(--ok-soft)' : 'var(--on-solid)', color: enabled ? 'var(--ok)' : 'var(--subtle)' }}
              >
                {enabled ? '✓ enabled' : '✕ disabled'}
              </button>
            </Field>
          </div>

          <Field label="描述 (给 Agent 看)">
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="一句话说清这个 tool 干什么"
              className="w-full px-2.5 py-1.5 text-sm border"
              style={inputStyle()}
            />
          </Field>

          {type === 'cli' ? (
            <>
              {!existing && (
                <DiscoveredCliPicker
                  tools={discoveredClis}
                  loading={discoveringClis}
                  error={cliDiscoveryError}
                  selectedPath={cliConfig.command}
                  onRefresh={loadDiscoveredClis}
                  onSelect={tool => {
                    const selected = applyDiscoveredCli(tool);
                    setName(selected.name);
                    setDescription(selected.description);
                    setCliConfig(selected.config);
                    setTestResult(null);
                  }}
                />
              )}
              <CliConfigFields value={cliConfig} onChange={setCliConfig} />
            </>
          ) : (
            <Field label="config (JSON)">
              <textarea
                value={configText}
                onChange={e => setConfigText(e.target.value)}
                className="w-full px-2.5 py-2 text-[12px] border font-mono"
                style={{ ...inputStyle(), minHeight: 160, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              />
              <div className="text-[10px] mt-1.5" style={{ color: 'var(--faint)' }}>
                {type === 'http' && '支持字段:url / method / headers / bodyMode (json|form|query) / bearerToken / timeoutMs'}
                {type === 'shell' && '支持字段:command (用 {{name}} 占位) / params (必填参数名数组) / timeoutMs'}
                {type === 'prompt' && '支持字段:template (用 {{name}} 占位,返回渲染后文本)'}
              </div>
            </Field>
          )}

          <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px]" style={{ color: 'var(--subtle)', fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: '0.06em' }}>
                {type === 'cli' ? '只检测模型列表，不会保存或执行任务' : '提示 · 测试不会写入 DB'}
              </div>
              <Button variant="secondary" size="sm" loading={testing} onClick={runTest} icon={<Play size={10} strokeWidth={1.75} />}>
                {type === 'cli' ? '测试模型列表' : '运行'}
              </Button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: type === 'cli' ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                gap: 12,
              }}
            >
              {type !== 'cli' && (
                <Field label="input (JSON)" mono>
                  <textarea
                    value={testInput}
                    onChange={e => setTestInput(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[12px] border font-mono"
                    style={{ ...inputStyle(), minHeight: 80, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                  />
                </Field>
              )}
              <Field label={type === 'cli' ? '检测到的模型' : 'output'} mono>
                <pre
                  className="w-full px-2.5 py-1.5 text-[12px] border overflow-auto"
                  style={{
                    ...inputStyle(),
                    minHeight: 80, maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: testResult?.success === false ? 'var(--danger-soft)' : testResult?.success ? 'var(--ok-soft)' : 'var(--surface-2)',
                    color: testResult?.success === false ? 'var(--danger)' : testResult?.success ? 'var(--ok)' : 'var(--subtle)',
                  }}
                >
                  {testResult
                    ? testResult.output
                    : type === 'cli'
                      ? '点击“测试模型列表”后，这里会显示可选模型。'
                      : '跑一次会显示输出'}
                </pre>
              </Field>
            </div>
          </div>
      </div>
    </Modal>
  );
}

function DiscoveredCliPicker({
  tools,
  loading,
  error,
  selectedPath,
  onRefresh,
  onSelect,
}: {
  tools: DiscoveredCli[];
  loading: boolean;
  error: string;
  selectedPath: string;
  onRefresh: () => void;
  onSelect: (tool: DiscoveredCli) => void;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>检测到的本机 CLI</div>
          <div style={{ marginTop: 2, fontSize: 10, color: 'var(--subtle)' }}>选择后自动填入可执行文件路径；不会自动添加或保存。</div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={onRefresh}
          icon={<RefreshCw size={11} strokeWidth={1.75} />}
        >
          重新检测
        </Button>
      </div>

      {error ? (
        <div style={{ padding: '9px 10px', border: '1px solid var(--danger-line)', background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 'var(--ui-radius)', fontSize: 11 }}>
          检测失败：{error}
        </div>
      ) : !loading && tools.length === 0 ? (
        <div style={{ padding: '10px 12px', border: '1px dashed var(--line)', background: 'var(--surface)', color: 'var(--muted)', borderRadius: 'var(--ui-radius)', fontSize: 11 }}>
          未检测到支持快速选择的 CLI，可继续手动填写路径。
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 6 }}>
          {tools.map(tool => {
            const selected = selectedPath === tool.path;
            return (
              <button
                key={`${tool.id}:${tool.path}`}
                type="button"
                onClick={() => onSelect(tool)}
                style={{
                  minWidth: 0,
                  padding: '9px 10px',
                  textAlign: 'left',
                  background: selected ? 'var(--accent-soft)' : 'var(--surface)',
                  border: `1px solid ${selected ? 'var(--accent-line)' : 'var(--line)'}`,
                  borderRadius: 'var(--ui-radius)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Terminal size={13} strokeWidth={1.75} style={{ color: 'var(--accent-2)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{tool.label}</span>
                  <Tag tone={tool.preset ? 'ok' : 'neutral'} size="xs">
                    {tool.preset ? '含推荐配置' : '仅填路径'}
                  </Tag>
                </div>
                <div
                  title={tool.path}
                  style={{
                    marginTop: 5,
                    overflow: 'hidden',
                    color: 'var(--muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tool.path}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CliConfigFields({
  value,
  onChange,
}: {
  value: ReturnType<typeof normalizeCliToolConfig>;
  onChange: (value: ReturnType<typeof normalizeCliToolConfig>) => void;
}) {
  const configurationState = getCliConfigurationState(value);
  const updateParser = (type: CliModelsParser['type']) => {
    const modelsParser: CliModelsParser = type === 'json-path'
      ? { type, path: '' }
      : type === 'regex'
        ? { type, pattern: '' }
        : { type };
    onChange({ ...value, modelsParser });
  };

  return (
    <div className="space-y-4">
      <Field label="CLI 可执行文件路径">
        <input
          value={value.command}
          onChange={e => onChange({ ...value, command: e.target.value })}
          placeholder="请从上方检测结果选择，或手动填写绝对路径"
          className="w-full px-2.5 py-1.5 border"
          style={inputStyle()}
        />
      </Field>

      <div
        style={{
          padding: '10px 12px',
          background: configurationState.ready ? 'var(--ok-soft)' : 'var(--warn-soft)',
          border: `1px solid ${configurationState.ready ? 'var(--ok-line)' : 'var(--warn-line)'}`,
          borderRadius: 'var(--ui-radius)',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: configurationState.ready ? 'var(--ok)' : 'var(--warn)' }}>
          {configurationState.title}
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--text-2)' }}>
          {configurationState.description}
        </div>
      </div>

      <details
        open={!configurationState.ready}
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
          background: 'var(--surface)',
        }}
      >
        <summary
          style={{
            padding: '10px 12px',
            color: 'var(--text-2)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          高级配置
          <span style={{ marginLeft: 8, color: 'var(--subtle)', fontSize: 10, fontWeight: 400 }}>
            已有推荐配置时无需修改
          </span>
        </summary>

        <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="模型列表命令">
            <input
              value={value.modelsCommand}
              onChange={e => onChange({ ...value, modelsCommand: e.target.value })}
              placeholder="例如：models 或 model list --json"
              className="w-full px-2.5 py-1.5 border"
              style={inputStyle()}
            />
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--faint)' }}>
              用于高级自定义 CLI 的动态模型探测。推荐配置已内置模型选项时无需填写。
            </div>
          </Field>

          <Field label="执行参数模板">
            <input
              value={value.argsTemplate}
              onChange={e => onChange({ ...value, argsTemplate: e.target.value })}
              placeholder="例如：exec --model {model}"
              className="w-full px-2.5 py-1.5 border"
              style={inputStyle()}
            />
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--faint)' }}>
              用途：Agent 执行任务时传给 CLI 的参数。{'{model}'} 会替换为 Agent 选择的模型。
            </div>
          </Field>

          <Field label="提示词传入方式（stdin）">
            <input
              value={value.stdinTemplate}
              onChange={e => onChange({ ...value, stdinTemplate: e.target.value })}
              placeholder="{prompt}"
              className="w-full px-2.5 py-1.5 border"
              style={inputStyle()}
            />
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--faint)' }}>
              通常保持 {'{prompt}'}。它表示把任务内容通过标准输入交给 CLI；只有 CLI 明确要求把提示词写进参数时才留空。
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Field label="模型列表输出格式">
              <Select
                value={value.modelsParser.type}
                onChange={v => updateParser(v as CliModelsParser['type'])}
                options={[
                  { value: 'lines', label: '每行一个模型' },
                  { value: 'json-path', label: 'JSON Path' },
                  { value: 'regex', label: '正则提取' },
                ]}
              />
            </Field>
            {value.modelsParser.type === 'json-path' && (
              <Field label="JSON Path">
                <input
                  value={value.modelsParser.path}
                  onChange={e => onChange({ ...value, modelsParser: { type: 'json-path', path: e.target.value } })}
                  placeholder="例如：data.models"
                  className="w-full px-2.5 py-1.5 border"
                  style={inputStyle()}
                />
              </Field>
            )}
            {value.modelsParser.type === 'regex' && (
              <Field label="正则表达式">
                <input
                  value={value.modelsParser.pattern}
                  onChange={e => onChange({ ...value, modelsParser: { type: 'regex', pattern: e.target.value } })}
                  placeholder="例如：^([\\w.-]+)$"
                  className="w-full px-2.5 py-1.5 border"
                  style={inputStyle()}
                />
              </Field>
            )}
            <Field label="模型检测超时（毫秒）">
              <input
                type="number"
                min={1000}
                value={value.modelsTimeoutMs}
                onChange={e => onChange({ ...value, modelsTimeoutMs: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 border"
                style={inputStyle()}
              />
            </Field>
            <Field label="任务执行超时（毫秒）">
              <input
                type="number"
                min={1000}
                value={value.timeoutMs}
                onChange={e => onChange({ ...value, timeoutMs: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 border"
                style={inputStyle()}
              />
            </Field>
          </div>
        </div>
      </details>
    </div>
  );
}

function defaultConfigFor(t: CustomTool['type']): any {
  if (t === 'http') return { url: 'https://api.example.com/endpoint', method: 'POST', bodyMode: 'json' };
  if (t === 'shell') return { command: 'echo hello {{name}}', params: ['name'], timeoutMs: 10000 };
  if (t === 'cli') return {
    command: '',
    argsTemplate: '',
    stdinTemplate: '{prompt}',
    staticModels: [],
    modelsCommand: '',
    modelsParser: { type: 'lines' },
    timeoutMs: 600000,
    modelsTimeoutMs: 15000,
  };
  return { template: '请用 {{tone}} 的语气回复: {{topic}}' };
}

function Field({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] mb-1.5" style={{ color: 'var(--muted)', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 12,
    background: 'var(--on-solid)',
    border: '1px solid var(--line)',
    borderRadius: 3,
    color: 'var(--text)',
    outline: 'none',
  };
}
