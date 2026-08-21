export type DevToolsToggleInput = {
  key?: string;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
};

export function shouldAutoOpenDevTools(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.AGENT_COMPANY_OPEN_DEVTOOLS;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

export function isDevToolsToggleInput(input: DevToolsToggleInput): boolean {
  const key = input.key?.toLowerCase();
  if (key === 'f12') return true;
  return key === 'i' && Boolean(input.alt) && Boolean(input.meta || input.control);
}
