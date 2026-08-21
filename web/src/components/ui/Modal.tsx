import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** 顶部 status bar 的元数据(像 IDE breadcrumb) */
  breadcrumb?: ReactNode;
  /** 底部 footer 的右侧操作区 */
  footer?: ReactNode;
  /**
   * 弹窗尺寸档位,统一控制宽 + 高。**关键:height 是固定值,不是 maxHeight** —
   * 这样 body 内容变化(切 tab、展开折叠)时弹窗整体高度不变,只 body 内部滚动。
   * 窄屏 (≤ 720px) 会自动用 100vw / 100vh 覆盖。
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /**
   * 强制固定到指定高度(px)。设置后忽略 size 的默认 height。
   * - 'viewport-90' → 90vh
   * - 'viewport-80' → 80vh
   * - 'viewport-70' → 70vh
   * - 'auto'       → 内容自适应高度,仅用于二次确认等短弹窗
   * - number      → 像素
   */
  height?: number | 'viewport-90' | 'viewport-80' | 'viewport-70' | 'auto';
  children: ReactNode;
}

const sizeMap = {
  sm: { w: 448,  h: 420  },
  md: { w: 672,  h: 540  },
  lg: { w: 896,  h: 640  },
  xl: { w: 1100, h: 720  },
  full: { w: 1200, h: 760 },
} as const;

function resolveHeight(h: ModalProps['height'], defaultH: number): number | string {
  if (h === undefined) return defaultH;
  if (h === 'auto') return 'auto';
  // 球球要求:modal 高度锁死,不要随视口变化。
  // viewport-90 → 800px,viewport-80 → 720px,viewport-70 → 640px (硬数字,避免 vh 在高 DPI 视口撑爆)。
  if (h === 'viewport-90') return 800;
  if (h === 'viewport-80') return 720;
  if (h === 'viewport-70') return 640;
  return h;
}

export function Modal({ open, onClose, title, breadcrumb, footer, size = 'md', height, children }: ModalProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sz = sizeMap[size];
  const finalHeight = resolveHeight(height, sz.h);
  const isAutoHeight = finalHeight === 'auto';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'var(--overlay)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="modal-shell"
        style={{
          width: sz.w,
          // 固定高度(不是 maxHeight) — 防止切 tab 时整体高度闪变
          // string (90vh/80vh/70vh) → 赋给 height,同时 maxHeight 兜底 820px,
          // 避免超高视口(>900h)下 90vh 把 modal 撑成全屏。number 直接用。
          height: isAutoHeight ? 'auto' : typeof finalHeight === 'number' ? `${finalHeight}px` : finalHeight,
          maxHeight: isAutoHeight ? 'calc(100vh - 40px)' : typeof finalHeight === 'number' ? `${finalHeight}px` : '820px',
          minHeight: isAutoHeight ? undefined : 280,
          background: 'var(--canvas)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
          fontFamily: 'var(--font-body)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* 顶部 status bar — flexShrink:0,保持稳定 */}
        {(title || breadcrumb) && (
          <div
            style={{
              padding: '12px 20px',
              background: 'var(--surface-2)',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
              minHeight: 44,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-2)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
              }}
            >
              {breadcrumb}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {title && (
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {title}
                </div>
              )}
              <button
                onClick={onClose}
                aria-label="关闭"
                style={{
                  width: 24,
                  height: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  color: 'var(--subtle)',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--ui-radius)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--line)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}

        {/* 主体 — 球球 review 2026-08-15:默认 body 自己 overflow-y:auto(收回滚动责任)。
            之前是 overflow:hidden,把责任推给 caller 自己加 overflow-y:auto,
            但很多 caller(模板弹窗、Agent editor 等)没加就出 bug — 内容溢出但不能滚。
            children 内部自己有 overflow 机制的(LLM 弹窗左右栏)不会冲突,子元素 overflow 优先。
            overflowX: hidden 防止内容撑大 modal 宽度。 */}
        <div
          ref={bodyRef}
          className="modal-body"
          style={{ flex: isAutoHeight ? '0 1 auto' : 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
        >
          {children}
        </div>

        {/* 底部 footer — flexShrink:0 */}
        {footer && (
          <div
            style={{
              padding: '12px 20px',
              background: 'var(--surface)',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexShrink: 0,
              minHeight: 52,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
