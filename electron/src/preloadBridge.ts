import type { AgentCompanyDesktopBridge } from '../../web/src/runtime/desktopBridge.js';
import { IPC_CHANNELS } from './channels.js';

type IpcInvoke = (
  channel: string,
  ...args: unknown[]
) => Promise<unknown>;

export function createDesktopBridge(
  invoke: IpcInvoke,
): AgentCompanyDesktopBridge {
  return {
    isElectron: true,
    getServerOrigin() {
      return invoke(IPC_CHANNELS.getServerOrigin) as Promise<string>;
    },
    selectProjectDirectory() {
      return invoke(
        IPC_CHANNELS.selectProjectDirectory,
      ) as ReturnType<AgentCompanyDesktopBridge['selectProjectDirectory']>;
    },
    openExternal(url) {
      return invoke(IPC_CHANNELS.openExternal, url) as Promise<void>;
    },
    getAppInfo() {
      return invoke(
        IPC_CHANNELS.getAppInfo,
      ) as ReturnType<AgentCompanyDesktopBridge['getAppInfo']>;
    },
  };
}
