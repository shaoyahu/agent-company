import { getDesktopBridge } from './desktopBridge';

export type RuntimeConfig = {
  apiOrigin: string;
  wsOrigin: string;
  desktop: boolean;
};

function browserRuntimeConfig(): RuntimeConfig {
  const wsOrigin = typeof location !== 'undefined' && typeof location.origin === 'string'
    ? location.origin
    : '';
  return {
    apiOrigin: '',
    wsOrigin,
    desktop: false,
  };
}

function parseServerOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function toWebSocketOrigin(origin: string): string {
  if (origin.startsWith('https://')) return `wss://${origin.slice(8)}`;
  if (origin.startsWith('http://')) return `ws://${origin.slice(7)}`;
  return origin;
}

function normalizePath(path: unknown): string {
  if (typeof path !== 'string') return '';

  const suffixIndex = [path.indexOf('?'), path.indexOf('#')]
    .filter((index) => index >= 0)
    .reduce((first, index) => Math.min(first, index), path.length);
  const normalizedPath = path.slice(0, suffixIndex).replace(/^\/+/, '');
  const suffix = path.slice(suffixIndex);

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(normalizedPath);
  } catch {
    return '';
  }

  const hasDotSegment = (value: string) => value
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
  const hasAsciiControl = (value: string) => /[\u0000-\u001f\u007f]/.test(value);
  if (
    hasAsciiControl(normalizedPath)
    || hasAsciiControl(decodedPath)
    || normalizedPath.includes('\\')
    || decodedPath.includes('\\')
    || hasDotSegment(normalizedPath)
    || hasDotSegment(decodedPath)
  ) {
    return '';
  }

  return `${normalizedPath}${suffix}`;
}

let cachedConfig = browserRuntimeConfig();
let configPromise: Promise<RuntimeConfig> | null = null;

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (configPromise) return configPromise;

  configPromise = (async () => {
    const browserConfig = browserRuntimeConfig();
    const bridge = getDesktopBridge();
    if (!bridge) {
      cachedConfig = browserConfig;
      return cachedConfig;
    }

    try {
      const apiOrigin = parseServerOrigin(await bridge.getServerOrigin());
      if (!apiOrigin) {
        cachedConfig = browserConfig;
        return cachedConfig;
      }

      cachedConfig = {
        apiOrigin,
        wsOrigin: toWebSocketOrigin(apiOrigin),
        desktop: true,
      };
      return cachedConfig;
    } catch {
      cachedConfig = browserConfig;
      return cachedConfig;
    }
  })();

  return configPromise;
}

export function apiUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  const suffix = normalizedPath ? `/api/${normalizedPath}` : '/api';
  return `${cachedConfig.apiOrigin}${suffix}`;
}

export function wsUrl(path: string = '/ws'): string {
  const normalizedPath = normalizePath(path);
  const suffix = normalizedPath ? `/${normalizedPath}` : '/';
  return `${toWebSocketOrigin(cachedConfig.wsOrigin)}${suffix}`;
}
