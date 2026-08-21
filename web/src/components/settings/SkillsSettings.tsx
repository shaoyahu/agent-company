import { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, BookOpen, Download, Upload, Link as LinkIcon, Loader2, FileText, Package } from 'lucide-react';
import { api } from '../../api/client';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Tag } from '../ui/Tag';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SectionHeader } from '../ui/SectionHeader';
import { Modal } from '../ui/Modal';
import { HelperDrawer } from './HelperDrawer';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/useConfirm';

interface InstalledSkill {
  name: string;
  description: string;
  source: 'project' | 'user' | 'hub';
  path: string;
  extraFiles: number;
}

interface HubSkill {
  name: string;
  displayName?: string;
  description: string;
  sourceUrl?: string;
  installed: boolean;
}

export function SkillsSettings({ onJumpToLLM }: { onJumpToLLM?: () => void } = {}) {
  const [data, setData] = useState<{ installed: InstalledSkill[]; hub: HubSkill[] } | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [viewing, setViewing] = useState<InstalledSkill | null>(null);
  const { lastEvent } = useWebSocket();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const refresh = async () => {
    const d = await api.skills();
    setData(d);
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (lastEvent?.type === 'skill_installed' || lastEvent?.type === 'skill_uninstalled') {
      refresh();
    }
  }, [lastEvent]);

  const handleUninstall = async (s: InstalledSkill) => {
    if (!await confirm({
      title: '卸载 skill',
      message: `卸载 skill "${s.name}"?\n只删除本机副本,不动原始来源。`,
      danger: true,
      confirmText: '卸载',
    })) return;
    try {
      await api.uninstallSkill(s.name);
      toast.push({ title: '已卸载', tone: 'ok' });
      if (viewing?.name === s.name) setViewing(null);
      refresh();
    } catch (e: any) {
      toast.push({ title: '卸载失败', description: e.message, tone: 'danger' });
    }
  };

  if (!data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--subtle)' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> 加载中…</div>;
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
    <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '20px 24px', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          // skills
        </div>
        <Button variant="dark" size="sm" onClick={() => setShowInstall(true)} icon={<Plus size={12} strokeWidth={2} />}>
          安装 Skill
        </Button>
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
          Skill = 可复用的领域知识 / 工作流约定。每个 skill 是一个目录,里有一份 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 2 }}>SKILL.md</code>。
          启用某 skill 后,启用它的 agent 会在 system prompt 里看到完整内容。
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: viewing ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 16 }}>
        {/* 列表 */}
        <div>
          {/* 已安装 */}
          <section style={{ marginBottom: 20 }}>
            <SectionHeader eyebrow="INSTALLED" title="已安装" count={data.installed.length} />
            {data.installed.length === 0 ? (
              <div style={{ marginTop: 12 }}>
                <EmptyState
                  icon={<BookOpen size={20} strokeWidth={1.5} />}
                  title="还没有安装 skill"
                  description="点右上角 + 安装 — 支持 URL / 上传 zip / 从 hub 选"
                  action={<Button variant="primary" onClick={() => setShowInstall(true)}>+ 安装 Skill</Button>}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {data.installed.map(s => (
                  <SkillRow
                    key={s.name}
                    s={s}
                    active={viewing?.name === s.name}
                    onClick={() => setViewing(s)}
                    actions={
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleUninstall(s); }}
                        icon={<Trash2 size={10} strokeWidth={1.75} />}
                      >
                        卸载
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* Hub */}
          {data.hub.length > 0 && (
            <section>
              <SectionHeader eyebrow="HUB" title="Skill Hub" count={data.hub.length} meta="未安装" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {data.hub.filter(h => !h.installed).map(h => (
                  <HubRow
                    key={h.name}
                    h={h}
                    onInstall={async () => {
                      try {
                        await api.installSkill({ source: 'hub', name: h.name });
                        toast.push({ title: '已安装', description: h.name, tone: 'ok' });
                        refresh();
                      } catch (e: any) {
                        toast.push({ title: '安装失败', description: e.message, tone: 'danger' });
                      }
                    }}
                  />
                ))}
                {data.hub.filter(h => h.installed).length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--subtle)', marginTop: 4, padding: '4px 0' }}>
                    还有 {data.hub.filter(h => h.installed).length} 个已装的在 hub 清单里
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* 详情 */}
        {viewing && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <SectionHeader eyebrow="DETAIL" title={viewing.name} />
              <button onClick={() => setViewing(null)} className="text-[11px]" style={{ color: 'var(--subtle)' }}>关闭</button>
            </div>
            <SkillDetail name={viewing.name} />
          </div>
        )}
      </div>

      {showInstall && (
        <InstallDialog
          onClose={() => setShowInstall(false)}
          onInstalled={() => { setShowInstall(false); refresh(); }}
        />
      )}
    </div>
    <HelperDrawer tab="skills" onJumpToLLM={onJumpToLLM} />
    {confirmDialog}
    </div>
  );
}

function SkillRow({ s, active, onClick, actions }: {
  s: InstalledSkill;
  active: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? 'var(--accent-soft)' : 'var(--surface)',
        border: '1px solid',
        borderColor: active ? 'var(--accent-line)' : 'var(--line)',
        borderRadius: 'var(--ui-radius)',
        padding: 12,
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      }}
    >
      <div style={{ width: 28, height: 28, borderRadius: 'var(--ui-radius)', background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-2)', flexShrink: 0 }}>
        <BookOpen size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.name}</span>
          <Tag tone="neutral" size="xs" mono>{s.source}</Tag>
          {s.extraFiles > 0 && <Tag tone="info" size="xs">+{s.extraFiles} files</Tag>}
        </div>
        <div
          style={{
            fontSize: 11, color: 'var(--muted)', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', wordBreak: 'break-word',
          }}
          title={s.description}
        >
          {s.description || '(无描述)'}
        </div>
        <div
          style={{
            fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)',
            marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={s.path}
        >
          {s.path}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  );
}

function HubRow({ h, onInstall }: { h: HubSkill; onInstall: () => void }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        padding: 12,
        display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <div style={{ width: 28, height: 28, borderRadius: 'var(--ui-radius)', background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', flexShrink: 0 }}>
        <Package size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{h.displayName ?? h.name}</span>
          {h.installed && <Tag tone="ok" size="xs">已装</Tag>}
        </div>
        <div
          style={{
            fontSize: 11, color: 'var(--muted)', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', wordBreak: 'break-word',
          }}
          title={h.description}
        >
          {h.description}
        </div>
      </div>
      {!h.installed && (
        <Button variant="secondary" size="sm" onClick={onInstall} icon={<Download size={10} strokeWidth={1.75} />}>
          装
        </Button>
      )}
    </div>
  );
}

function SkillDetail({ name }: { name: string }) {
  const [detail, setDetail] = useState<{ description: string; body: string } | null>(null);
  useEffect(() => {
    setDetail(null);
    api.skill(name).then(setDetail).catch(() => setDetail(null));
  }, [name]);
  if (!detail) return <div style={{ padding: 16, color: 'var(--subtle)', fontSize: 12 }}>加载中…</div>;
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        padding: 14,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>SKILL.md</div>
      {detail.description && (
        <div
          style={{
            fontSize: 12, color: 'var(--text-2)', marginBottom: 10,
            padding: '8px 10px', background: 'var(--surface-2)',
            borderRadius: 'var(--ui-radius)', borderLeft: '2px solid var(--accent-line)',
            wordBreak: 'break-word', overflowWrap: 'anywhere',
          }}
        >
          {detail.description}
        </div>
      )}
      <pre
        style={{
          fontSize: 12,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          margin: 0,
          maxWidth: '100%',
          maxHeight: 480,
          overflow: 'auto',
        }}
      >
        {detail.body}
      </pre>
    </div>
  );
}

function InstallDialog({ onClose, onInstalled }: { onClose: () => void; onInstalled: () => void }) {
  const [tab, setTab] = useState<'url' | 'upload' | 'content'>('content');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState(`---
name: my-skill
description: 一句话说清这个 skill 是什么
---

# 在这里写正文

## 工作流
1. 第一步
2. 第二步

## 注意事项
- agent 启用这个 skill 后,正文会注入到 system prompt
- 写长一点没所谓,系统会自动截断(默认 1500 字)
`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (tab === 'url') {
        if (!url) throw new Error('请填 URL');
        await api.installSkill({ source: 'url', url, name: name || undefined });
      } else if (tab === 'upload') {
        if (!file) throw new Error('请选文件');
        const buf = await file.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        await api.installSkill({ source: 'upload', fileBase64: b64, filename: file.name, name: name || undefined });
      } else if (tab === 'content') {
        if (!content.trim()) throw new Error('请填内容');
        await api.installSkill({ source: 'content', content, name: name || undefined });
      }
      toast.push({ title: '安装成功', tone: 'ok' });
      onInstalled();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      height="viewport-90"
      breadcrumb={
        <>
          <span style={{
            padding: '1px 6px',
            background: 'var(--text)', color: 'var(--canvas)',
            borderRadius: 2, fontWeight: 600, letterSpacing: '0.04em',
          }}>SKILL</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span style={{ color: 'var(--text-2)' }}>安装</span>
        </>
      }
      footer={
        <>
          <div className="text-[11px]" style={{ color: 'var(--subtle)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            // 解到 ~/.minimax/skills/&lt;name&gt;/
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3.5 py-1.5 text-sm" style={{ color: 'var(--text-2)', background: 'var(--on-solid)', border: '1px solid var(--line)', borderRadius: 3 }}>取消</button>
            <button onClick={submit} disabled={busy} className="px-3.5 py-1.5 text-sm font-medium" style={{ color: 'var(--on-solid)', background: busy ? 'var(--faint)' : 'var(--text)', borderRadius: 3, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? '安装中…' : '⌘ 安装'}
            </button>
          </div>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-3 border" style={{ borderColor: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
          <button
            onClick={() => setTab('content')}
            className="px-2 py-2 text-[12px] flex items-center justify-center gap-1.5"
            style={{ background: tab === 'content' ? 'var(--text)' : 'var(--on-solid)', color: tab === 'content' ? 'var(--canvas)' : 'var(--text-2)', borderRight: '1px solid var(--line)' }}
          >
            <FileText size={12} /> 直接写
          </button>
          <button
            onClick={() => setTab('url')}
            className="px-2 py-2 text-[12px] flex items-center justify-center gap-1.5"
            style={{ background: tab === 'url' ? 'var(--text)' : 'var(--on-solid)', color: tab === 'url' ? 'var(--canvas)' : 'var(--text-2)', borderRight: '1px solid var(--line)' }}
          >
            <LinkIcon size={12} /> URL
          </button>
          <button
            onClick={() => setTab('upload')}
            className="px-2 py-2 text-[12px] flex items-center justify-center gap-1.5"
            style={{ background: tab === 'upload' ? 'var(--text)' : 'var(--on-solid)', color: tab === 'upload' ? 'var(--canvas)' : 'var(--text-2)' }}
          >
            <Upload size={12} /> 上传 zip
          </button>
        </div>

        {tab === 'content' ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[10px]" style={{ color: 'var(--muted)', fontWeight: 500 }}>SKILL.md 内容</label>
              <span className="text-[10px]" style={{ color: 'var(--faint)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                {content.length} chars
              </span>
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full px-2.5 py-2 text-[12px] border font-mono"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", background: 'var(--on-solid)', border: '1px solid var(--line)', borderRadius: 3, color: 'var(--text)', outline: 'none', minHeight: 260, whiteSpace: 'pre' }}
            />
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--faint)', lineHeight: 1.5 }}>
              顶部 <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", background: 'var(--surface-2)', padding: '0 3px' }}>---</code> 包围的 frontmatter 是必填,
              从 <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", background: 'var(--surface-2)', padding: '0 3px' }}>name:</code> 拿 skill 名。下面是 markdown 正文,启用后注入到 agent 的 system prompt。
            </div>
          </div>
        ) : tab === 'url' ? (
          <div>
            <label className="block text-[10px] mb-1.5" style={{ color: 'var(--muted)', fontWeight: 500 }}>Zip URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/skill.zip"
              className="w-full px-2.5 py-1.5 text-sm border"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, background: 'var(--on-solid)', border: '1px solid var(--line)', borderRadius: 3, color: 'var(--text)', outline: 'none' }}
            />
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--faint)' }}>
              支持 .zip — 解压后根目录或单层子目录里要有 SKILL.md
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-[10px] mb-1.5" style={{ color: 'var(--muted)', fontWeight: 500 }}>Zip 文件</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
              style={{ fontSize: 12 }}
            />
            {file && (
              <div className="mt-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                <FileText size={11} style={{ verticalAlign: 'middle' }} /> {file.name} · {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>
        )}

        {tab !== 'content' && (
          <div>
            <label className="block text-[10px] mb-1.5" style={{ color: 'var(--muted)', fontWeight: 500 }}>名称 (选填,留空用 SKILL.md 里的)</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-skill"
              className="w-full px-2.5 py-1.5 text-sm border"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, background: 'var(--on-solid)', border: '1px solid var(--line)', borderRadius: 3, color: 'var(--text)', outline: 'none' }}
            />
          </div>
        )}

        {error && (
          <div className="px-3 py-2 text-[12px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderLeft: '2px solid var(--danger)', borderRadius: 2 }}>
            ✕ {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
