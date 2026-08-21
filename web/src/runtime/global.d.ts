import type { AgentCompanyDesktopBridge } from './desktopBridge';

declare global {
  interface Window {
    agentCompanyDesktop?: AgentCompanyDesktopBridge;
  }
}

export {};
