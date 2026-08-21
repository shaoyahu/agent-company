import { api } from '../../api/client';
import { getDesktopBridge } from '../../runtime/desktopBridge';

export async function validateProjectDirectory(path: string): Promise<string> {
  const validated = await api.validateDir({ path });
  if (!validated.writable) {
    throw new Error(`项目目录不可写: ${validated.path}`);
  }
  return validated.path;
}

export async function chooseProjectDirectory(
  currentPath: string,
): Promise<
  | { changed: false; path: string }
  | { changed: true; path: string }
> {
  const bridge = getDesktopBridge();
  if (bridge) {
    const selected = await bridge.selectProjectDirectory();
    if (selected.canceled) {
      return { changed: false, path: currentPath };
    }
    if (typeof selected.path !== 'string' || !selected.path.startsWith('/')) {
      throw new Error('Finder 未返回有效的绝对目录');
    }
    const path = await validateProjectDirectory(selected.path);
    return { changed: true, path };
  }

  if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
    return { changed: false, path: currentPath };
  }
  const input = window.prompt('请输入项目绝对路径', currentPath);
  if (typeof input !== 'string' || !input.trim()) {
    return { changed: false, path: currentPath };
  }

  const path = await validateProjectDirectory(input);
  return { changed: true, path };
}
