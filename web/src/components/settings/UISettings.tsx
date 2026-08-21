/**
 * 球球 2026-08-15 第 23 轮:从三档 segmented control 改成无极滑动条
 *
 * 设计:
 *   - 三个独立 slider(密度 / 字号 / 圆角),无档位,无离散选项
 *   - 拖动立即 apply 到 CSS variables(实时生效)
 *   - 松手时 PUT /api/ui-settings 持久化(避免拖动时频繁写库 — 改用 onMouseUp / onTouchEnd)
 *   - 底部"实时预览"卡片,展示真实 nav item / button / input
 *
 * 视觉风格:跟 Settings 系列一致 — 卡片 + SectionHeader + 双层 hierarchy
 */
import { useState, useRef, useEffect } from 'react';
import { useToast } from '../ui/Toast';
import { SectionHeader } from '../ui/SectionHeader';
import { ThemePicker } from '../ui/ThemePicker';
import { useUISettings, applyUISettingsToCSS, RANGES, type UISettings } from '../../hooks/useUISettings';
import { applyTheme, readStoredTheme } from '../../theme/applyTheme';
import type { ThemeId } from '../../theme/themes';

// ─── Slider 组件 ───────────────────────────────────────────

interface SliderProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  desc: string;
  /** 当前值格式化函数,默认 `${value}${unit}` */
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}

function Slider({ label, unit, value, min, max, step, defaultValue, desc, format, onChange, onCommit }: SliderProps) {
  const isAtDefault = value === defaultValue;
  const display = format ? format(value) : `${value}${unit}`;

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--ui-radius)',
        padding: '14px 16px',
      }}
    >
      {/* 顶部:label + 当前值 */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {!isAtDefault && (
            <span
              onClick={() => onCommit(defaultValue)}
              title="恢复默认"
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                color: 'var(--subtle)',
                cursor: 'pointer',
                padding: '1px 6px',
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--ui-radius)',
                flexShrink: 0,
              }}
            >
              ↺ 默认
            </span>
          )}
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              fontFeatureSettings: '"tnum"',
              letterSpacing: '0.01em',
            }}
          >
            {display}
          </span>
        </div>
      </div>

      {/* 滑动条 */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onMouseUp={e => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={e => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={e => onCommit(Number((e.target as HTMLInputElement).value))}
        style={{ width: '100%', padding: 0, margin: 0, cursor: 'pointer' }}
      />

      {/* 底部:min/max 标 + desc */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--faint)' }}>
          {format ? format(min) : `${min}${unit}`}
        </span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--faint)' }}>
          {format ? format(max) : `${max}${unit}`}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 4, lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────

export function UISettings() {
  const { settings, update } = useUISettings();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeId>(() => readStoredTheme());
  // 本地拖动值(未持久化) — 拖动时更新这里 → applyToCSS → UI 立即变
  // onCommit 才把本地值推给 update() 持久化
  const [local, setLocal] = useState<UISettings>(settings);

  // 同步外部 settings → 本地(server push / 初始 load 后)
  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  // 拖动中:立即更新本地 + apply CSS,不发请求
  const handleSlide = (key: keyof UISettings) => (v: number) => {
    setLocal(prev => {
      const next = { ...prev, [key]: v };
      applyUISettingsToCSS(next);
      return next;
    });
  };

  // 松手:update 内部已经写 localStorage + apply CSS,这里只是 trap 错误(同步 try/catch)
  const handleCommit = (key: keyof UISettings) => (v: number) => {
    try {
      update({ [key]: v } as Partial<UISettings>);
    } catch (e: any) {
      toast.push({ title: '保存失败', description: e.message, tone: 'danger' });
    }
  };

  const handleThemeChange = (nextTheme: ThemeId) => {
    setTheme(applyTheme(nextTheme));
    toast.push({ title: '主题已切换', tone: 'ok' });
  };

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
          padding: 12,
          marginBottom: 16,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 'var(--ui-radius)', background: 'var(--accent-soft)', color: 'var(--accent-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>ⓘ</div>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          主题与界面参数都只保存在当前浏览器，不会影响其他用户。<br />
          关浏览器再开也保留。
        </div>
      </div>

      <section style={{ marginBottom: 20 }}>
        <SectionHeader
          eyebrow="THEME"
          title="主题"
          meta="仅改变视觉，不改变功能和信息密度"
        />
        <div style={{ marginTop: 12 }}>
          <ThemePicker value={theme} onChange={handleThemeChange} />
        </div>
      </section>

      {/* 三个滑块 */}
      <section style={{ marginBottom: 20 }}>
        <SectionHeader eyebrow="DENSITY" title="密度" meta="缩放 sidebar / 按钮 / 输入框 / 页面 padding" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 12 }}>
          <Slider
            label="密度系数"
            unit=""
            value={local.density}
            min={RANGES.density.min}
            max={RANGES.density.max}
            step={RANGES.density.step}
            defaultValue={RANGES.density.default}
            desc="1.0 = 基准(Linear / Vercel 风格)。大于 1 更大,小于 1 更紧"
            format={v => v.toFixed(2) + 'x'}
            onChange={handleSlide('density')}
            onCommit={handleCommit('density')}
          />
        </div>
      </section>

      <section style={{ marginBottom: 20 }}>
        <SectionHeader eyebrow="FONT SIZE" title="字号" meta="影响全局基础字号 (body font-size)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 12 }}>
          <Slider
            label="基础字号"
            unit="px"
            value={local.fontSize}
            min={RANGES.fontSize.min}
            max={RANGES.fontSize.max}
            step={RANGES.fontSize.step}
            defaultValue={RANGES.fontSize.default}
            desc="13 = 紧凑,14 = 默认,18 = 大屏阅读"
            onChange={handleSlide('fontSize')}
            onCommit={handleCommit('fontSize')}
          />
        </div>
      </section>

      <section style={{ marginBottom: 20 }}>
        <SectionHeader eyebrow="RADIUS" title="圆角" meta="影响按钮 / 输入框 / 卡片" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 12 }}>
          <Slider
            label="圆角"
            unit="px"
            value={local.radius}
            min={RANGES.radius.min}
            max={RANGES.radius.max}
            step={RANGES.radius.step}
            defaultValue={RANGES.radius.default}
            desc="0 = 锐利 (IDE 风格),12 = 圆润 (柔和)"
            onChange={handleSlide('radius')}
            onCommit={handleCommit('radius')}
          />
        </div>
      </section>

      {/* 实时预览 */}
      <section>
        <SectionHeader eyebrow="PREVIEW" title="实时预览" meta="拖动滑块,这里立即更新" />
        <div
          style={{
            marginTop: 12,
            padding: 16,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--ui-radius)',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              SIDEBAR ITEM
            </div>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                minHeight: 'var(--ui-sidebar-item-h)',
                marginBottom: 'var(--ui-sidebar-gap)',
                padding: '10px 12px',
                background: 'var(--accent-soft)',
                borderLeft: '2px solid var(--accent)',
                color: 'var(--accent-2)',
                borderRadius: 'var(--ui-radius)',
                fontSize: 14, fontWeight: 600,
              }}
            >
              <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>◆</span>
              <span>公司总览</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--faint)' }}>g d</span>
            </div>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                minHeight: 'var(--ui-sidebar-item-h)',
                marginBottom: 0,
                padding: '10px 12px',
                color: 'var(--text-2)',
                fontSize: 14, fontWeight: 500,
              }}
            >
              <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>◇</span>
              <span>部门 / Agent</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                BUTTON
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  style={{
                    background: 'var(--text)', color: 'var(--on-solid)',
                    border: '1px solid var(--text)',
                    borderRadius: 'var(--ui-radius)',
                    height: 'var(--ui-control-h-md)',
                    padding: '0 14px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  主操作
                </button>
                <button
                  style={{
                    background: 'var(--surface)', color: 'var(--text-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--ui-radius)',
                    height: 'var(--ui-control-h-md)',
                    padding: '0 14px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  次操作
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--subtle)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                INPUT
              </div>
              <input
                placeholder="搜索..."
                style={{
                  width: '100%', height: 'var(--ui-control-h-input)',
                  padding: '0 12px', fontSize: 14,
                  background: 'var(--surface)', color: 'var(--text)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--ui-radius)',
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
