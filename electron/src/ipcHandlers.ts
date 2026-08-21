import { IPC_CHANNELS } from './channels.js';
import {
  assertTrustedIpcSender,
  type RendererTarget,
} from './security.js';

type IpcEventLike = {
  sender: unknown;
  senderFrame?: unknown;
};

type IpcRegistrar = {
  handle(
    channel: string,
    listener: (event: IpcEventLike, ...args: unknown[]) => unknown,
  ): void;
};

type ProjectDirectoryResult = {
  canceled: true;
} | {
  canceled: false;
  path: string;
};

type TrustedIpcDependencies = {
  target: RendererTarget;
  getCurrentWebContents(): {
    mainFrame: unknown;
  } | null;
  getServerOrigin(): string;
  selectProjectDirectory(): Promise<ProjectDirectoryResult>;
  openExternal(url: unknown): Promise<void>;
  getAppInfo(): {
    version: string;
    platform: 'darwin';
  };
};

export function registerTrustedIpcHandlers(
  registrar: IpcRegistrar,
  dependencies: TrustedIpcDependencies,
): void {
  const register = (
    channel: string,
    handler: (...args: unknown[]) => unknown,
  ): void => {
    registrar.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(
        event,
        dependencies.getCurrentWebContents(),
        dependencies.target,
      );
      return handler(...args);
    });
  };

  register(
    IPC_CHANNELS.getServerOrigin,
    () => dependencies.getServerOrigin(),
  );
  register(
    IPC_CHANNELS.selectProjectDirectory,
    () => dependencies.selectProjectDirectory(),
  );
  register(
    IPC_CHANNELS.openExternal,
    (url) => dependencies.openExternal(url),
  );
  register(
    IPC_CHANNELS.getAppInfo,
    () => dependencies.getAppInfo(),
  );
}
