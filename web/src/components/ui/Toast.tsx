/**
 * 球球 review 2026-08-15 第 N 轮:通知组件重新做
 *
 * 设计(参考 Linear / Vercel / Datadog 风格):
 *   - 位置:右上角(从右下挪上来) — 离操作区最近,信息流向自然
 *   - 大小:380px 宽 / 14px 16px padding / 更大字号 — 错因能多行显示
 *   - 动效:从右滑入 220ms,退出用反向滑出 180ms
 *   - 持续时间按 tone 区分(danger 8s,给球球时间读错因)
 *   - 鼠标悬停暂停计时
 *   - danger 类加状态码徽章(右上角小 badge)
 *   - 错因 description 支持多行(pre-wrap)
 *   - 最多堆 5 个,超出丢最老
 *   - 关闭按钮更明显(hover 变红)
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';

type ToastTone = 'info' | 'ok' | 'warn' | 'danger';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
  /**
   * 球球 review 2026-08-16:可点 action 按钮 — OAuth URL / 链接场景
   * (球球原话:"要走 oauth 的话把链接放出来让用户可以完成授权")
   * 点 action 不关 toast(让用户继续看),由 action 自己控制。
   */
  action?: ToastAction;
}

interface ToastContextValue {
  push: (t: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// 持续时间按 tone 区分(毫秒)
const DURATION_BY_TONE: Record<ToastTone, number> = {
  info:   4000,
  ok:     4000,
  warn:   6000,
  danger: 8000,  // 错因信息更重要,多留点时间
};

const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setItems(s => {
      const next = [...s, { ...t, id }];
      // 最多堆 5 个,丢最老的
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems(s => s.filter(x => x.id !== id));
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // 球球 review:位置改到右上角,16px 边距
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          zIndex: 100,
          // 380px 固定宽(原来 360),错因多行能容下
          width: 380,
          maxWidth: 'calc(100vw - 32px)',
          // 指针事件只在 toast 上,不挡背景
          pointerEvents: 'none',
        }}
      >
        {items.map(t => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
}

const TONE_META: Record<ToastTone, { color: string; bg: string; border: string; Icon: typeof Info; statusBadge?: string }> = {
  info:   { color: 'var(--info)',     bg: 'var(--info-soft)',     border: 'var(--info)',     Icon: Info },
  ok:     { color: 'var(--ok)',       bg: 'var(--ok-soft)',       border: 'var(--ok)',       Icon: CheckCircle2 },
  warn:   { color: 'var(--warn)',     bg: 'var(--warn-soft)',     border: 'var(--warn)',     Icon: AlertTriangle },
  danger: { color: 'var(--danger)',   bg: 'var(--danger-soft)',   border: 'var(--danger)',   Icon: AlertCircle, statusBadge: 'ERROR' },
};

/**
 * 球球 review 2026-08-16:未知 tone 兜底走 info
 * 防止未来加新 tone 但忘补 TONE_META 时 meta.Icon 崩(像之前的 TYPE_META[t.type].icon)
 */
export function getToneMeta(tone: string) {
  return (TONE_META as Record<string, (typeof TONE_META)[keyof typeof TONE_META]>)[tone] ?? TONE_META.info;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const tone = toast.tone ?? 'info';
  // 防御:未知 tone 兜底 info
  const meta = getToneMeta(tone);
  const Icon = meta.Icon;
  const duration = toast.duration ?? DURATION_BY_TONE[tone] ?? DURATION_BY_TONE.info;
  const [hovered, setHovered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 退出动效:先 0 → 1(进入),hover 时暂停计时,关闭时切到 leaving → 退出
  const triggerClose = useCallback(() => {
    setLeaving(true);
    // 等 180ms 退出动效跑完再真正 remove
    setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    if (hovered || leaving) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setTimeout(triggerClose, duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hovered, leaving, duration, triggerClose]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="status"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${meta.border}`,
        borderRadius: 'var(--ui-radius)',
        padding: '12px 14px',
        boxShadow: 'var(--shadow-md)',
        // 球球 review:pointer-events 在容器上开启
        pointerEvents: 'auto',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        animation: leaving
          ? 'toast-out 180ms ease-in forwards'
          : 'toast-in 220ms ease-out',
      }}
    >
      {/* tone icon */}
      <div
        style={{
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: meta.color,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <Icon size={16} strokeWidth={2} />
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0 }}>
            {toast.title}
          </div>
          {/* 球球 review:danger 类显示状态码徽章,让"HTTP 400"能看出来源 */}
          {meta.statusBadge && toast.description && (
            <span
              style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: meta.color,
                background: meta.bg,
                padding: '1px 5px',
                borderRadius: 'var(--ui-radius)',
                fontWeight: 700,
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}
            >
              {meta.statusBadge}
            </span>
          )}
        </div>
        {toast.description && (
          <div
            // 球球 review:错因多行(后端返的中文错因可能多行),用 pre-wrap 保留换行
            style={{
              fontSize: 12,
              color: 'var(--muted)',
              marginTop: 4,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {toast.description}
          </div>
        )}
        {/* 球球 review 2026-08-16:OAuth / 链接 action 按钮 */}
        {toast.action && (
          <button
            type="button"
            onClick={() => toast.action!.onClick()}
            // e.stopPropagation 不要 — action 自己管
            style={{
              marginTop: 8,
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--accent-2)',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-line)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {toast.action.label} →
          </button>
        )}
        {/* 球球 review:hover 暂停指示 */}
        {hovered && (
          <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', marginTop: 4, letterSpacing: '0.04em' }}>
            ⏸ 已暂停 · 移开鼠标继续计时
          </div>
        )}
      </div>

      {/* 关闭按钮 */}
      <button
        onClick={triggerClose}
        aria-label="关闭"
        title="关闭"
        style={{
          color: 'var(--faint)',
          lineHeight: 1,
          padding: 2,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          borderRadius: 'var(--ui-radius)',
          transition: 'background 0.1s, color 0.1s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--danger-soft)';
          e.currentTarget.style.color = 'var(--danger)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--faint)';
        }}
      >
        <X size={14} strokeWidth={2} />
      </button>

      <style>{`
        @keyframes toast-in {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes toast-out {
          from { transform: translateX(0);    opacity: 1; }
          to   { transform: translateX(20px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
