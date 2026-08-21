/**
 * PlatformIcon — LLM / AI 厂商品牌图标
 *
 * 单一来源:14 个厂商的 brand SVG 全部来自 @lobehub/icons(Mono 变体,单色 outline)
 * 而不是 lucide 通用 icon — 用户一眼能认出"哦这是 Anthropic"。
 *
 * 用法:
 *   <PlatformIcon id="openai" size={16} />
 *   <PlatformIcon id="anthropic" size={14} />        // 跟随父 color
 *   <PlatformIcon id="anthropic" size={14} branded /> // 用品牌原色(Anthropic 橘色)
 *
 * 支持的平台 id:
 *   openai / anthropic / gemini / grok / mistral / openrouter
 *   deepseek / moonshot / qwen / doubao / zhipu / yi / minimax
 *   ollama
 */

import { useMemo } from 'react';
import OpenAI from '@lobehub/icons/es/OpenAI';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Gemini from '@lobehub/icons/es/Gemini';
import Grok from '@lobehub/icons/es/Grok';
import Mistral from '@lobehub/icons/es/Mistral';
import OpenRouter from '@lobehub/icons/es/OpenRouter';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import Moonshot from '@lobehub/icons/es/Moonshot';
import Qwen from '@lobehub/icons/es/Qwen';
import Doubao from '@lobehub/icons/es/Doubao';
import Zhipu from '@lobehub/icons/es/Zhipu';
import Yi from '@lobehub/icons/es/Yi';
import Minimax from '@lobehub/icons/es/Minimax';
import Ollama from '@lobehub/icons/es/Ollama';

export type PlatformId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'grok'
  | 'mistral'
  | 'openrouter'
  | 'deepseek'
  | 'moonshot'
  | 'qwen'
  | 'doubao'
  | 'zhipu'
  | 'yi'
  | 'minimax'
  | 'ollama';

interface PlatformIconProps {
  id: PlatformId | string;
  size?: number;
  /**
   * 品牌色:开启后用厂商原色(Anthropic 橘、OpenAI 绿、Gemini 蓝...)
   * 默认关闭(单色,跟随父 color,跟整套设计系统一致)
   */
  branded?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

const ICON_MAP: Record<PlatformId, React.ComponentType<{ size?: number; color?: string; title?: string }>> = {
  openai: OpenAI as any,
  anthropic: Anthropic as any,
  gemini: Gemini as any,
  grok: Grok as any,
  mistral: Mistral as any,
  openrouter: OpenRouter as any,
  deepseek: DeepSeek as any,
  moonshot: Moonshot as any,
  qwen: Qwen as any,
  doubao: Doubao as any,
  zhipu: Zhipu as any,
  yi: Yi as any,
  minimax: Minimax as any,
  ollama: Ollama as any,
};

const BRAND_COLOR: Partial<Record<PlatformId, string>> = {
  openai: OpenAI.colorPrimary ?? '#10A37F',
  anthropic: Anthropic.colorPrimary ?? '#D97757',
  gemini: Gemini.colorPrimary ?? '#4796E3',
  grok: Grok.colorPrimary ?? '#000000',
  mistral: Mistral.colorPrimary ?? '#000000',
  openrouter: OpenRouter.colorPrimary ?? '#0A6EFA',
  deepseek: DeepSeek.colorPrimary ?? '#1A4D8F',
  moonshot: Moonshot.colorPrimary ?? '#3B45FD',
  qwen: Qwen.colorPrimary ?? '#615CED',
  doubao: Doubao.colorPrimary ?? '#2477FF',
  zhipu: Zhipu.colorPrimary ?? '#3859FF',
  yi: Yi.colorPrimary ?? '#7B3CFD',
  minimax: Minimax.colorPrimary ?? '#7A45E0',
  ollama: Ollama.colorPrimary ?? '#000000',
};

const PLATFORM_LABEL: Record<PlatformId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot Kimi',
  qwen: '通义千问 Qwen',
  doubao: '豆包 Doubao',
  zhipu: '智谱 GLM',
  yi: '零一万物 Yi',
  minimax: 'MiniMax',
  ollama: 'Ollama',
};

export function PlatformIcon({
  id,
  size = 14,
  branded = false,
  className,
  style,
  title,
}: PlatformIconProps) {
  const Icon = ICON_MAP[id as PlatformId];
  const color = useMemo(() => (branded ? BRAND_COLOR[id as PlatformId] : undefined), [branded, id]);
  const label = title ?? PLATFORM_LABEL[id as PlatformId] ?? id;

  if (!Icon) {
    // 未知平台 id 兜底 — 渲染一个空心菱形 monospaced
    return (
      <span
        className={className}
        title={label}
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: size,
          lineHeight: 1,
          ...style,
        }}
      >
        ◇
      </span>
    );
  }

  return (
    <span
      className={className}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        color: color ?? 'currentColor',
        flexShrink: 0,
        ...style,
      }}
    >
      <Icon size={size} color={color ?? 'currentColor'} title={label} />
    </span>
  );
}

/** Helper — 从 platform id 取 label(给 Card / List / QuickPick 等用) */
export function getPlatformLabel(id: string): string {
  return PLATFORM_LABEL[id as PlatformId] ?? id;
}
