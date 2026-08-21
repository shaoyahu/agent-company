import type { ReactNode } from 'react';
import { Tag } from './Tag';
import type { ViewportInfo } from './useViewport';

interface PageHeaderProps {
  /** 顶部 monospaced breadcrumb 链(像 IDE 文件路径) */
  breadcrumb?: ReactNode;
  /** 主标题 */
  title: ReactNode;
  /** 副标题/描述 */
  description?: ReactNode;
  /** 右侧操作区 */
  actions?: ReactNode;
  /** 标签(显示在标题旁) */
  tags?: Array<{ label: string; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'openai' | 'anthropic' | 'both' | 'mono' }>;
  /** 实时数据(WS 连接状态) */
  live?: 'connected' | 'disconnected' | 'loading';
  /**
   * 视口信息。传入后:
   *   - 窄屏(<900):actions 换到第二行,description 默认隐藏(可强制保留)
   *   - 中等屏(<1200):description 仍然显示但允许 ellipsis
   *   - 宽屏:全显
   */
  vp?: ViewportInfo;
  /** 强制显示 description 即使在窄屏(默认 false) */
  forceDescription?: boolean;
}

export function PageHeader({
  breadcrumb,
  title,
  description,
  actions,
  tags = [],
  live,
  vp,
  forceDescription = false,
}: PageHeaderProps) {
  // 窄屏(<900):drop description 让出空间,actions 换到第二行
  // 中等屏(<1200):description 允许 ellipsis
  const isNarrow = vp?.isNarrow ?? false;
  const showDescription = description && (!isNarrow || forceDescription);
  const stackActions = isNarrow && actions;

  return (
    <header
      style={{
        // 球球 2026-08-15:界面设置 — 上下 padding 跟随密度档位
        padding: 'var(--ui-page-pad-y) 32px calc(var(--ui-page-pad-y) - 2px)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        flexDirection: stackActions ? 'column' : 'row',
        alignItems: stackActions ? 'stretch' : 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* breadcrumb — monospaced 标识 */}
        {breadcrumb && (
          <div
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--subtle)',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            {breadcrumb}
          </div>
        )}

        {/* 主标题 + tags */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              fontFamily: 'var(--font-display)',
              color: 'var(--text)',
              letterSpacing: 0,
              lineHeight: 1.2,
              // 窄屏允许 title ellipsis(标题一般不长,但防御性)
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {title}
          </h1>
          {tags.map((t, i) => (
            <Tag key={i} tone={t.tone}>{t.label}</Tag>
          ))}
          {live && <LiveBadge status={live} />}
        </div>

        {showDescription && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              marginTop: 6,
              // 中等屏允许 ellipsis
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            // 窄屏换行后,actions 沿右对齐(避免顶到最左)
            justifyContent: stackActions ? 'flex-end' : 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          {actions}
        </div>
      )}
    </header>
  );
}

function LiveBadge({ status }: { status: 'connected' | 'disconnected' | 'loading' }) {
  const config = {
    connected: { dot: 'var(--ok)', label: '已连接', tone: 'ok' as const },
    disconnected: { dot: 'var(--danger)', label: '已断开', tone: 'danger' as const },
    loading: { dot: 'var(--warn)', label: '连接中', tone: 'warn' as const },
  }[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        color: 'var(--muted)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: config.dot,
          animation: status === 'loading' ? 'pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {config.label}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </span>
  );
}
