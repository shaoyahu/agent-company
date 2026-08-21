// 球球 2026-08-15 第 N 轮:UI 设置从 db 改 localStorage
// 原因:UI 偏好(密度/字号/圆角)是个人浏览器状态,不是系统配置
// - 不需要跨设备同步
// - 不需要服务端参与
// - 改完立即生效,无需 PUT 请求
// - 刷新 / 重启浏览器都保留
//
// 三个独立滑动条:
//   - density  密度系数 0.5-2.0(1.0 = 基准)
//   - fontSize 字号 10-26
//   - radius   圆角 0-24

import { useEffect, useState, useCallback } from 'react';

export interface UISettings {
  density: number;
  fontSize: number;
  radius: number;
}

const DEFAULTS: UISettings = {
  density: 1.0,
  fontSize: 14,
  radius: 4,
};

export const RANGES = {
  density:  { min: 0.5, max: 2.0, step: 0.01, default: 1.0 },
  fontSize: { min: 10,  max: 26,  step: 1,    default: 14 },
  radius:   { min: 0,   max: 24,  step: 1,    default: 4 },
} as const;

const BASE = {
  sidebarItemH: 40,
  sidebarGap:   2,
  controlHSm:   30,
  controlHMd:   36,
  controlHInput: 38,
  controlHInputSm: 32,
  pagePadY:     24,
} as const;

const STORAGE_KEY = 'agent-company:ui-settings';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 从 localStorage 读(带 try/catch + 默认值容错 + 范围 clamp) */
function readFromStorage(): UISettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      density:  clamp(Number(parsed.density)  || DEFAULTS.density,  RANGES.density.min,  RANGES.density.max),
      fontSize: clamp(Number(parsed.fontSize) || DEFAULTS.fontSize, RANGES.fontSize.min, RANGES.fontSize.max),
      radius:   clamp(Number(parsed.radius)   || DEFAULTS.radius,   RANGES.radius.min,   RANGES.radius.max),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 写 localStorage(静默失败,不影响 UI) */
function writeToStorage(s: UISettings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // quota exceeded / disabled — 静默,UI 仍然用内存值
  }
}

function applyToCSS(s: UISettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const factor = s.density;
  root.setProperty('--ui-sidebar-item-h',   `${BASE.sidebarItemH * factor}px`);
  root.setProperty('--ui-sidebar-gap',      `${BASE.sidebarGap * factor}px`);
  root.setProperty('--ui-control-h-sm',     `${BASE.controlHSm * factor}px`);
  root.setProperty('--ui-control-h-md',     `${BASE.controlHMd * factor}px`);
  root.setProperty('--ui-control-h-input',  `${BASE.controlHInput * factor}px`);
  root.setProperty('--ui-control-h-input-sm', `${BASE.controlHInputSm * factor}px`);
  root.setProperty('--ui-page-pad-y',       `${BASE.pagePadY * factor}px`);
  root.setProperty('--ui-font-size',        `${s.fontSize}px`);
  root.setProperty('--ui-radius',           `${s.radius}px`);
}

/** 公开:直接 apply UISettings 到 CSS variables(用于拖动时实时生效) */
export function applyUISettingsToCSS(s: UISettings) {
  applyToCSS(s);
}

// ─── Singleton cache ───
let cache: UISettings = (() => {
  const initial = readFromStorage();
  // 同步 init apply,避免首屏 flash
  if (typeof document !== 'undefined') {
    // 用 setTimeout 0 把 apply 推到下一 tick,让 :root 的默认 var 先应用
    setTimeout(() => applyToCSS(initial), 0);
  }
  return initial;
})();
const listeners = new Set<(s: UISettings) => void>();

/** App 启动时调一次(目前 cache 已经在模块加载时初始化 + 异步 apply,这里保留作明示) */
export function loadUISettings(): UISettings {
  applyToCSS(cache);
  return cache;
}

/** 拿到当前 cache(同步) */
export function getUISettingsCached(): UISettings {
  return cache;
}

export function useUISettings() {
  const [s, setS] = useState<UISettings>(cache);

  useEffect(() => {
    const l = (next: UISettings) => setS(next);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const update = useCallback((patch: Partial<UISettings>) => {
    const next = { ...cache, ...patch };
    cache = next;
    applyToCSS(next);
    writeToStorage(next);
    listeners.forEach(l => l(next));
    return next;
  }, []);

  return { settings: s, update };
}
