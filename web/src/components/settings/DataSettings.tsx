import { useRef, useState } from 'react';
import { Archive, Download, RotateCcw, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { SectionHeader } from '../ui/SectionHeader';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      const [, base64 = ''] = value.split(',');
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('读取备份文件失败'));
    reader.readAsDataURL(file);
  });
}

function backupFilename(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  return `agent-company-backup-${stamp}.zip`;
}

export function DataSettings() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | 'reset' | null>(null);

  const handleExport = async () => {
    try {
      setBusy('export');
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFilename();
      a.click();
      URL.revokeObjectURL(url);
      toast.push({ title: '数据已导出', tone: 'ok' });
    } catch (e: any) {
      toast.push({ title: '导出失败', description: e.message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.endsWith('.zip')) {
      toast.push({ title: '导入失败', description: '请选择 zip 备份包', tone: 'danger' });
      return;
    }
    const ok = window.confirm('导入会覆盖当前全部业务数据和用户添加的 skills。系统会先生成安全备份。确认继续？');
    if (!ok) return;
    try {
      setBusy('import');
      const fileBase64 = await fileToBase64(file);
      await api.importData({ fileBase64, filename: file.name });
      toast.push({ title: '数据已导入', tone: 'ok' });
      window.location.reload();
    } catch (e: any) {
      toast.push({ title: '导入失败', description: e.message, tone: 'danger' });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleReset = async () => {
    const ok = window.confirm('一键还原会清空当前全部业务数据和用户添加的 skills。系统会先生成安全备份。确认继续？');
    if (!ok) return;
    try {
      setBusy('reset');
      await api.resetData();
      toast.push({ title: '已还原初始状态', tone: 'ok' });
      window.location.reload();
    } catch (e: any) {
      toast.push({ title: '还原失败', description: e.message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <SectionHeader eyebrow="DATA" title="数据" meta="备份、恢复与还原" />
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--ui-radius)', padding: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Download size={16} />导出数据</h3>
          <p style={{ margin: '8px 0 12px', color: 'var(--text-2)', fontSize: 12 }}>导出 SQLite 全部业务数据和用户添加的 skills。</p>
          <Button icon={<Archive size={14} />} onClick={handleExport} disabled={busy !== null}>{busy === 'export' ? '导出中' : '导出数据'}</Button>
        </section>

        <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--ui-radius)', padding: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Upload size={16} />导入数据</h3>
          <p style={{ margin: '8px 0 12px', color: 'var(--text-2)', fontSize: 12 }}>上传 `.zip` 备份包，覆盖当前数据并恢复 skills。</p>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            style={{ display: 'none' }}
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
          />
          <Button icon={<Upload size={14} />} onClick={() => fileRef.current?.click()} disabled={busy !== null}>{busy === 'import' ? '导入中' : '导入数据'}</Button>
        </section>

        <section style={{ background: 'var(--surface)', border: '1px solid var(--danger-line)', borderRadius: 'var(--ui-radius)', padding: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><RotateCcw size={16} />一键还原</h3>
          <p style={{ margin: '8px 0 12px', color: 'var(--text-2)', fontSize: 12 }}>清空当前业务数据和用户添加的 skills，恢复初始状态。</p>
          <Button variant="danger" icon={<RotateCcw size={14} />} onClick={handleReset} disabled={busy !== null}>{busy === 'reset' ? '还原中' : '一键还原'}</Button>
        </section>
      </div>
    </div>
  );
}
