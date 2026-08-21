import type { ReactNode } from 'react';

type TagTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'openai' | 'anthropic' | 'both' | 'mono';

interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  size?: 'xs' | 'sm';
  uppercase?: boolean;
  dot?: boolean;
  mono?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

const toneStyles: Record<TagTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: 'var(--surface-2)', fg: 'var(--muted)', border: 'var(--line)' },
  accent: { bg: 'var(--accent-soft)', fg: 'var(--accent-2)', border: 'var(--accent-line)' },
  ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)', border: 'var(--ok-line)' },
  warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)', border: 'var(--warn-line)' },
  danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)', border: 'var(--danger-line)' },
  info: { bg: 'var(--info-soft)', fg: 'var(--info)', border: 'var(--info-line)' },
  openai: { bg: 'var(--cat-openai-soft)', fg: 'var(--cat-openai)', border: 'var(--ok-line)' },
  anthropic: { bg: 'var(--cat-anthropic-soft)', fg: 'var(--cat-anthropic)', border: 'var(--warn-line)' },
  both: { bg: 'var(--cat-both-soft)', fg: 'var(--cat-both)', border: 'var(--accent-line)' },
  mono: { bg: 'var(--text)', fg: 'var(--canvas)', border: 'var(--text)' },
};

/**
 * 球球 review 2026-08-16:未知 tone 兜底走 neutral
 * 防止未来加新 tone 但忘补 toneStyles 时 t.bg/t.fg 链式访问崩
 */
export function getTagToneStyle(tone: string) {
  return (toneStyles as Record<string, (typeof toneStyles)[keyof typeof toneStyles]>)[tone] ?? toneStyles.neutral;
}

export function Tag({ children, tone = 'neutral', size = 'sm', uppercase, dot, mono, title, style }: TagProps) {
  // 防御:未知 tone 兜底 neutral
  const t = getTagToneStyle(tone);
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: size === 'xs' ? '1px 5px' : '2px 7px',
        fontSize: size === 'xs' ? 9 : 10,
        fontWeight: 600,
        lineHeight: 1.4,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        borderRadius: 'var(--ui-radius)',
        fontFamily: (mono || tone === 'mono') ? 'var(--font-mono)' : 'inherit',
        textTransform: uppercase ? 'uppercase' : 'none',
        letterSpacing: uppercase ? '0.04em' : '0',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'currentColor',
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}
