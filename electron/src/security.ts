import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const secureWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const;

export const projectDirectoryDialogOptions = {
  properties: ['openDirectory', 'createDirectory'],
} as const;

export type RendererTarget = {
  kind: 'url';
  url: string;
  origin: string;
} | {
  kind: 'file';
  filePath: string;
  rootPath: string;
  url: string;
};

export type RendererNavigationDecision = {
  action: 'allow';
} | {
  action: 'open-external';
  url: string;
} | {
  action: 'deny';
};

type IpcWebContentsLike = {
  mainFrame: unknown;
};

type IpcEventLike = {
  sender: unknown;
  senderFrame?: unknown;
};

type NavigationEventLike = {
  preventDefault(): void;
};

type RendererWebContentsLike = {
  on(
    eventName: 'will-navigate' | 'will-redirect',
    listener: (event: NavigationEventLike, url: string) => void,
  ): unknown;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' },
  ): unknown;
};

export function assertDarwin(platform: unknown): asserts platform is 'darwin' {
  if (platform !== 'darwin') {
    throw new Error('首版桌面应用仅支持 macOS');
  }
}

export function assertAllowedExternalUrl(url: unknown): string {
  try {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error();
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error();
    }
    return parsed.href;
  } catch {
    throw new Error('仅允许打开 http: 或 https: 外链');
  }
}

export function resolveRendererTarget(
  isPackaged: boolean,
  rendererUrl: unknown,
  localIndexPath: string,
): RendererTarget {
  if (!isAbsolute(localIndexPath)) {
    throw new Error('本地渲染器入口必须是绝对路径');
  }

  if (!isPackaged && rendererUrl !== undefined) {
    if (typeof rendererUrl !== 'string') {
      throw new Error('开发模式渲染器地址仅允许无凭据的本机 http URL');
    }
    const trimmedUrl = rendererUrl.trim();
    if (trimmedUrl !== '') {
      try {
        const parsed = new URL(trimmedUrl);
        const authorityMatch = trimmedUrl.match(
          /^http:\/\/(\[[^\]]+\]|[^:/?#]+)(?::\d+)?(?:[/?#]|$)/i,
        );
        const rawHostname = authorityMatch?.[1]?.toLowerCase();
        if (
          parsed.protocol !== 'http:'
          || parsed.username !== ''
          || parsed.password !== ''
          || !rawHostname
          || !['localhost', '127.0.0.1', '[::1]'].includes(rawHostname)
        ) {
          throw new Error();
        }
        return {
          kind: 'url',
          url: parsed.href,
          origin: parsed.origin,
        };
      } catch {
        throw new Error('开发模式渲染器地址仅允许无凭据的本机 http URL');
      }
    }
  }

  return {
    kind: 'file',
    filePath: localIndexPath,
    rootPath: dirname(localIndexPath),
    url: pathToFileURL(localIndexPath).href,
  };
}

export function isTrustedRendererUrl(
  url: unknown,
  target: RendererTarget,
): boolean {
  if (typeof url !== 'string' || url.trim() === '') {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.username !== '' || parsed.password !== '') {
      return false;
    }
    if (target.kind === 'url') {
      return parsed.origin === target.origin;
    }
    if (parsed.protocol !== 'file:') {
      return false;
    }

    const candidatePath = fileURLToPath(parsed);
    const relativePath = relative(target.rootPath, candidatePath);
    return relativePath === ''
      || (
        relativePath !== '..'
        && !relativePath.startsWith(`..${sep}`)
        && !isAbsolute(relativePath)
      );
  } catch {
    return false;
  }
}

export function assertTrustedIpcSender(
  event: IpcEventLike,
  currentWebContents: IpcWebContentsLike | null,
  target: RendererTarget,
): void {
  if (!currentWebContents || event.sender !== currentWebContents) {
    throw new Error('拒绝来自非当前窗口的 IPC 请求');
  }
  if (
    !event.senderFrame
    || event.senderFrame !== currentWebContents.mainFrame
  ) {
    throw new Error('仅允许主页面发送 IPC 请求');
  }

  const frameUrl = (event.senderFrame as { url?: unknown }).url;
  if (!isTrustedRendererUrl(frameUrl, target)) {
    throw new Error('拒绝来自不可信页面的 IPC 请求');
  }
}

export function classifyRendererNavigation(
  url: unknown,
  target: RendererTarget,
): RendererNavigationDecision {
  if (isTrustedRendererUrl(url, target)) {
    return { action: 'allow' };
  }
  try {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error();
    }
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { action: 'open-external', url: parsed.href };
    }
  } catch {
    return { action: 'deny' };
  }
  return { action: 'deny' };
}

export function installRendererNavigationGuards(
  webContents: RendererWebContentsLike,
  target: RendererTarget,
  openExternal: (url: string) => void,
): void {
  const handleNavigation = (
    event: NavigationEventLike,
    url: string,
  ): void => {
    const decision = classifyRendererNavigation(url, target);
    if (decision.action === 'allow') return;

    event.preventDefault();
    if (decision.action === 'open-external') {
      openExternal(decision.url);
    }
  };

  webContents.on('will-navigate', handleNavigation);
  webContents.on('will-redirect', handleNavigation);
  webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyRendererNavigation(url, target);
    if (decision.action === 'open-external') {
      openExternal(decision.url);
    }
    return { action: 'deny' };
  });
}

export function withDesktopExecutablePaths(
  currentPath: string | undefined,
  homeDir: string,
): string {
  const entries = currentPath?.split(delimiter).filter(Boolean) ?? [];
  const additions = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homeDir, '.local/bin'),
    join(homeDir, '.bun/bin'),
  ];
  return [...new Set([...entries, ...additions])].join(delimiter);
}
