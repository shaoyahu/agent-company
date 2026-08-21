/**
 * SectionHeader — 工业控制台风格的 section 标题
 *
 * 双层 hierarchy(替代旧的 "SectionLabel" + "// 装饰" 模式):
 *   - eyebrow: 10px 大写英文 mono 标签(行业惯例: PROVIDERS / DEPARTMENTS / AGENTS)
 *   - title: 16px 中文章粗,主色
 *   - count: monospaced 数字徽章,subtle 背景
 *   - rail: 左侧 2px 短色条 (signature 元素)
 *   - actions / meta: 右侧操作
 *
 * 用法:
 *   <SectionHeader eyebrow="PROVIDERS" title="活跃" count={active.length} actions={<Button>+ 添加</Button>} />
 *   <SectionHeader eyebrow="DEPARTMENTS" title="部门全景" count={depts.length} />
 *
 * 设计依据: frontend-design skill 强调"先定方向再写码" + "Type & structure carry the personality"
 * — 不要把 `//` 当 UI 装饰,那是 code 里的注释,不是设计语言。
 */
import { type ReactNode } from 'react';

export interface SectionHeaderProps {
  /** 10px 大写英文 mono 标签,如 "PROVIDERS" / "DEPARTMENTS" / "AGENTS" */
  eyebrow: string;
  /** 16px 中文章粗 */
  title: ReactNode;
  /** 数字徽章,monospaced */
  count?: number | string;
  /** 右侧操作(按钮等) */
  actions?: ReactNode;
  /** 右侧辅助 meta 文字(如 "Last sync 12s ago") */
  meta?: ReactNode;
  /** 显示左侧 2px 短色条(默认 true) */
  rail?: boolean;
  /** 紧凑模式(在 220px 窄列里用) */
  compact?: boolean;
  /** 自定义色条颜色,默认 var(--accent) */
  railColor?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  count,
  actions,
  meta,
  rail = true,
  compact = false,
  railColor = 'var(--accent)',
}: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 10 : 14,
        marginTop: 0,
        marginBottom: compact ? 10 : 18,
        // 紧凑模式不显示色条,让 220px 窄列更省空间
        ...(rail && !compact ? { paddingLeft: 14, position: 'relative' } : {}),
      }}
    >
      {rail && !compact && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 4,
            bottom: 4,
            width: 2,
            background: railColor,
            borderRadius: 1,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: compact ? 6 : 8, flexWrap: 'wrap' }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--subtle)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            lineHeight: 1,
            // eyebrow 比 title 高一点,让两者 baseline 对齐时 eyebrow 视觉在 title 上方
            transform: 'translateY(-1px)',
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: compact ? 14 : 16,
            fontWeight: 600,
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
            lineHeight: 1.2,
            // 标题放最左,确保视觉 anchor 在文字
            order: -1,
          }}
        >
          {title}
        </div>
        {count !== undefined && count !== null && (
          <span
            style={{
              background: 'var(--surface-2)',
              color: 'var(--muted)',
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 'var(--ui-radius)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              fontFeatureSettings: '"tnum"',
              letterSpacing: '0.02em',
              lineHeight: 1,
              transform: 'translateY(-1px)',
            }}
          >
            {count}
          </span>
        )}
        {meta && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--subtle)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.02em',
            }}
          >
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
