export type ThemeId = 'console' | 'workspace' | 'terminal';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
}

export const DEFAULT_THEME: ThemeId = 'console';

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'console',
    name: '专业控制台',
    description: '高信息密度，适合持续监控与批量操作',
  },
  {
    id: 'workspace',
    name: '明亮工作台',
    description: '清晰舒展，适合长时间阅读与编辑',
  },
  {
    id: 'terminal',
    name: '深色终端',
    description: '深色高对比，适合开发与运行监控',
  },
] as const;

const THEME_IDS = new Set<ThemeId>(THEMES.map((theme) => theme.id));

export function resolveTheme(value: unknown): ThemeId {
  if (typeof value !== 'string') return DEFAULT_THEME;
  const normalized = value.trim() as ThemeId;
  return THEME_IDS.has(normalized) ? normalized : DEFAULT_THEME;
}
