/**
 * AvatarPicker — agent 头像选择器
 *
 * 4 种方式:
 * 1. 常见 emoji 网格(12 个,工种速选)
 * 2. lucide 图标网格(8 个,几何风格统一)
 * 3. 纯色方块(6 个,大写字母/数字,极简)
 * 4. 文本输入(任意字符,兜底)
 *
 * 设计原因:之前 agent.avatar 是个 Input + maxLength=4,球球根本没办法选(键盘根本输不出 emoji 也没图标库)。
 * 现在给球球一个"看见就点"的网格,默认进 emoji 标签,文本输入是兜底。
 */

import { useState } from 'react';
import {
  User, Bot, Code, Briefcase, Palette, BarChart3, Wrench, Heart,
  Cpu, Globe, Lightbulb, Music,
} from 'lucide-react';
import { Input } from './Input.js';

const EMOJI_PRESETS = [
  '👤', '🤖', '👨‍💻', '👩‍💻', '🧑‍🎨', '🧑‍🔬',
  '👨‍🏫', '🧑‍💼', '🦸', '🧙', '🧝', '🧞',
];

const LUCIDE_PRESETS = [
  { Icon: User,      name: 'user' },
  { Icon: Bot,       name: 'bot' },
  { Icon: Code,      name: 'code' },
  { Icon: Briefcase, name: 'briefcase' },
  { Icon: Palette,   name: 'palette' },
  { Icon: BarChart3, name: 'chart' },
  { Icon: Wrench,    name: 'wrench' },
  { Icon: Heart,     name: 'heart' },
  { Icon: Cpu,       name: 'cpu' },
  { Icon: Globe,     name: 'globe' },
  { Icon: Lightbulb, name: 'idea' },
  { Icon: Music,     name: 'music' },
];

/** 纯色方块:用 CSS var 里的语义色,显示 "1-2 字符" 让球球也能用纯色方块当头像 */
const COLOR_PRESETS = [
  { bg: 'var(--cat-openai)',     text: 'A', label: 'openai' },
  { bg: 'var(--cat-anthropic)',  text: 'C', label: 'anthropic' },
  { bg: 'var(--cat-both)',       text: 'B', label: 'both' },
  { bg: 'var(--accent)',         text: '◆', label: 'accent' },
  { bg: 'var(--info)',           text: 'i', label: 'info' },
  { bg: 'var(--ok)',             text: '✓', label: 'ok' },
];

type Tab = 'emoji' | 'icon' | 'color' | 'text';

export interface AvatarPickerProps {
  /** 当前选中的值(emoji 字符串 / lucide icon name / "color:text" / 自由文本) */
  value: string;
  onChange: (v: string) => void;
}

export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  // 推断初始 tab:有 ::color: 前缀 → color,默认 emoji
  const initial: Tab = value.startsWith('color:') ? 'color'
    : LUCIDE_PRESETS.some((p) => p.name === value) ? 'icon'
    : 'emoji';
  const [tab, setTab] = useState<Tab>(initial);
  const [text, setText] = useState(() =>
    value.startsWith('color:') ? value.slice('color:'.length) : '',
  );

  const select = (v: string) => onChange(v);

  return (
    <div>
      {/* 4 个 tab */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 10,
          padding: 3,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
        }}
      >
        {([
          ['emoji', 'Emoji'],
          ['icon',  '图标'],
          ['color', '色块'],
          ['text',  '文本'],
        ] as Array<[Tab, string]>).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              height: 28,
              padding: '0 10px',
              fontSize: 11,
              fontWeight: 500,
              color: tab === t ? 'var(--canvas)' : 'var(--text-2)',
              background: tab === t ? 'var(--text)' : 'transparent',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 当前 tab 内容 */}
      {tab === 'emoji' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 4,
          }}
        >
          {EMOJI_PRESETS.map((e) => {
            const active = value === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() => select(e)}
                style={{
                  height: 36,
                  fontSize: 20,
                  background: active ? 'var(--accent-soft)' : 'var(--surface)',
                  border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                  borderRadius: 'var(--ui-radius)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={e}
              >
                {e}
              </button>
            );
          })}
        </div>
      )}

      {tab === 'icon' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 4,
          }}
        >
          {LUCIDE_PRESETS.map(({ Icon, name }) => {
            const active = value === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => select(name)}
                style={{
                  height: 36,
                  background: active ? 'var(--accent-soft)' : 'var(--surface)',
                  border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                  borderRadius: 'var(--ui-radius)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-2)',
                }}
                title={name}
              >
                <Icon size={18} strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
      )}

      {tab === 'color' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 4,
          }}
        >
          {COLOR_PRESETS.map((c) => {
            const v = `color:${c.text}`;
            const active = value === v;
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => select(v)}
                style={{
                  height: 36,
                  background: c.bg,
                  border: `2px solid ${active ? 'var(--text)' : 'transparent'}`,
                  borderRadius: 'var(--ui-radius)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 14,
                }}
                title={c.label}
              >
                {c.text}
              </button>
            );
          })}
        </div>
      )}

      {tab === 'text' && (
        <div>
          <Input
            value={text}
            onChange={(e) => {
              const v = e.target.value.slice(0, 4);
              setText(v);
              select(v);
            }}
            placeholder="任意字符,最多 4 个"
            maxLength={4}
            mono
          />
          <div
            style={{
              fontSize: 10,
              color: 'var(--subtle)',
              marginTop: 4,
              fontFamily: 'var(--font-mono)',
            }}
          >
            兜底选项 — emoji / 图标 / 色块没有想要的,自己输
          </div>
        </div>
      )}
    </div>
  );
}
