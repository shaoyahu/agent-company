export interface AgentCompanyDesktopBridge {
  isElectron: true;
  getServerOrigin(): Promise<string>;
  selectProjectDirectory(): Promise<
    { canceled: true } | { canceled: false; path: string }
  >;
  openExternal(url: string): Promise<void>;
  getAppInfo(): Promise<{ version: string; platform: 'darwin' }>;
}

export function getDesktopBridge(): AgentCompanyDesktopBridge | null {
  if (typeof window === 'undefined') return null;

  try {
    const bridge = window.agentCompanyDesktop as unknown;
    if (!bridge || typeof bridge !== 'object') return null;

    const candidate = bridge as Record<string, unknown>;
    if (
      candidate.isElectron !== true
      || typeof candidate.getServerOrigin !== 'function'
      || typeof candidate.selectProjectDirectory !== 'function'
      || typeof candidate.openExternal !== 'function'
      || typeof candidate.getAppInfo !== 'function'
    ) {
      return null;
    }

    return bridge as AgentCompanyDesktopBridge;
  } catch {
    return null;
  }
}
