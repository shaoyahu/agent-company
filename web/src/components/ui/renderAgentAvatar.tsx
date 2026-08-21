/**
 * renderAgentAvatar — 统一渲染 agent.avatar 字段
 *
 * agent.avatar 字段支持 4 种格式(由 AvatarPicker 选出来):
 * - '' / null / undefined        → 默认 ◆ 几何字符
 * - 'color:X'                    → 纯色方块 + X 字符
 * - lucide icon name(在 LUCIDE 里)→ lucide icon
 * - 其他(emoji / 自由文本)       → 直接渲染
 */

import { User, Bot, Code, Briefcase, Palette, BarChart3, Wrench, Heart, Cpu, Globe, Lightbulb, Music, Diamond } from 'lucide-react';
import type { ReactNode } from 'react';

const LUCIDE_MAP: Record<string, typeof User> = {
  user: User, bot: Bot, code: Code, briefcase: Briefcase, palette: Palette,
  chart: BarChart3, wrench: Wrench, heart: Heart, cpu: Cpu, globe: Globe,
  idea: Lightbulb, music: Music,
};

/** @internal - exported for testing */
export const LUCIDE_PRESETS_FOR_TEST = LUCIDE_MAP;

const COLOR_BG_MAP: Record<string, string> = {
  'A': 'var(--cat-openai)',
  'C': 'var(--cat-anthropic)',
  'B': 'var(--cat-both)',
  '◆': 'var(--accent)',
  'i': 'var(--info)',
  '✓': 'var(--ok)',
};

export interface RenderAvatarOpts {
  /** 头像视觉尺寸(像素) */
  size?: number;
  /** 字体大小覆盖(默认跟随 size) */
  fontSize?: number;
}

/**
 * 把 avatar 字符串渲染成可放进任意容器的 ReactNode
 * 默认 32x32,跟 list 卡片头像一致
 */
export function renderAgentAvatar(value: string | null | undefined, opts: RenderAvatarOpts = {}): ReactNode {
  const size = opts.size ?? 32;
  const fontSize = opts.fontSize ?? Math.round(size * 0.5);

  // 防御:null / undefined / 非 string 都走默认 ◆
  if (typeof value !== 'string' || !value) {
    // 空 → 默认 ◆
    return (
      <span
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
          fontSize,
        }}
      >
        <Diamond size={Math.round(size * 0.6)} strokeWidth={1.5} />
      </span>
    );
  }

  // color:X → 纯色方块
  if (value.startsWith('color:')) {
    const ch = value.slice('color:'.length);
    const bg = COLOR_BG_MAP[ch] ?? 'var(--muted)';
    return (
      <span
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: bg,
          color: '#fff',
          fontWeight: 600,
          fontSize: Math.round(size * 0.45),
          borderRadius: 'var(--ui-radius)',
          flexShrink: 0,
        }}
      >
        {ch}
      </span>
    );
  }

  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value)) {
    return (
      <img
        src={value}
        alt=""
        style={{
          width: size,
          height: size,
          display: 'inline-block',
          objectFit: 'cover',
          borderRadius: 'var(--ui-radius)',
          flexShrink: 0,
        }}
      />
    );
  }

  // lucide icon name
  const LucideIcon = LUCIDE_MAP[value];
  if (LucideIcon) {
    return (
      <span
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-2)',
          flexShrink: 0,
        }}
      >
        <LucideIcon size={Math.round(size * 0.6)} strokeWidth={1.75} />
      </span>
    );
  }

  // 兜底:emoji / 任意字符
  return (
    <span
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        fontSize,
        flexShrink: 0,
      }}
    >
      {value}
    </span>
  );
}
