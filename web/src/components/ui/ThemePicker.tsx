import type { CSSProperties } from 'react';
import { THEMES, resolveTheme, type ThemeId } from '../../theme/themes';

interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
}

const PREVIEW: Record<ThemeId, Record<string, string>> = {
  console: {
    '--preview-canvas': '#f4f6f8',
    '--preview-surface': '#ffffff',
    '--preview-card': '#f8fafb',
    '--preview-line': '#dce2e7',
    '--preview-text': '#12181d',
    '--preview-accent': '#087e8b',
  },
  workspace: {
    '--preview-canvas': '#f7f8fa',
    '--preview-surface': '#ffffff',
    '--preview-card': '#f5f7fa',
    '--preview-line': '#e0e4eb',
    '--preview-text': '#16181d',
    '--preview-accent': '#2f6fdf',
  },
  terminal: {
    '--preview-canvas': '#111513',
    '--preview-surface': '#171c19',
    '--preview-card': '#202823',
    '--preview-line': '#303b34',
    '--preview-text': '#edf3ef',
    '--preview-accent': '#56c5aa',
  },
};

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  const selected = resolveTheme(value);

  return (
    <div className="theme-picker" role="group" aria-label="界面主题">
      {THEMES.map((theme) => (
        <button
          className="theme-picker__option"
          type="button"
          key={theme.id}
          data-theme-option={theme.id}
          data-selected={selected === theme.id}
          aria-pressed={selected === theme.id}
          onClick={() => onChange(theme.id)}
        >
          <div
            className="theme-picker__preview"
            style={PREVIEW[theme.id] as CSSProperties}
          >
            <div className="theme-picker__preview-shell">
              <div className="theme-picker__preview-nav" />
              <div className="theme-picker__preview-main">
                <div className="theme-picker__preview-line" />
                <div className="theme-picker__preview-blocks">
                  <div className="theme-picker__preview-block" />
                  <div className="theme-picker__preview-block" />
                </div>
              </div>
            </div>
          </div>
          <div className="theme-picker__copy">
            <div className="theme-picker__title">{theme.name}</div>
            <div className="theme-picker__description">{theme.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
