import { useState, useCallback } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmState = (ConfirmOptions & { resolve: (v: boolean) => void }) | null;

/**
 * 替换浏览器原生 confirm()/alert() 的弹窗 hook
 *
 * 用法:
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (!await confirm({ title, message, danger: true })) return;
 *   ...
 *   return <>{...}{dialog}</>;
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      setState({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((v: boolean) => {
    setState(s => {
      s?.resolve(v);
      return null;
    });
  }, []);

  const dialog = state ? (
    <ConfirmDialog
      {...state}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirm, dialog };
}

function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      height="auto"
      footer={
        <>
          <span style={{ fontSize: 11, color: 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>
            {danger ? '此操作不可撤销' : '确认操作'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onCancel}
              className="px-3.5 py-1.5 text-sm"
              style={{
                color: 'var(--text-2)', background: 'var(--surface)',
                border: '1px solid var(--line)', borderRadius: 'var(--ui-radius)',
                cursor: 'pointer',
              }}
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className="px-3.5 py-1.5 text-sm font-medium"
              style={{
                color: 'var(--canvas)',
                background: danger ? 'var(--danger)' : 'var(--accent)',
                border: '1px solid',
                borderColor: danger ? 'var(--danger)' : 'var(--accent)',
                borderRadius: 'var(--ui-radius)',
                cursor: 'pointer',
              }}
            >
              {confirmText}
            </button>
          </div>
        </>
      }
    >
      <div style={{ padding: '20px 24px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 'var(--ui-radius)',
            background: danger ? 'var(--danger-soft)' : 'var(--accent-soft)',
            color: danger ? 'var(--danger)' : 'var(--accent-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {danger ? <AlertTriangle size={18} /> : <Info size={18} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message}
          </div>
        </div>
      </div>
    </Modal>
  );
}
