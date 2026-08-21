import { DEFAULT_THEME, resolveTheme, type ThemeId } from './themes';

export const THEME_STORAGE_KEY = 'agent-company-ui-theme';

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

function documentRoot(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement;
}

export function readStoredTheme(
  storage: Storage | undefined = browserStorage(),
): ThemeId {
  if (!storage) return DEFAULT_THEME;
  try {
    return resolveTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(
  theme: unknown,
  root: HTMLElement | undefined = documentRoot(),
  storage: Storage | undefined = browserStorage(),
): ThemeId {
  const resolved = resolveTheme(theme);
  if (root) {
    root.dataset.theme = resolved;
    root.dataset.acTheme = resolved;
  }
  if (storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, resolved);
    } catch {
      // 浏览器禁用持久化时，当前页面主题仍然生效。
    }
  }
  return resolved;
}
