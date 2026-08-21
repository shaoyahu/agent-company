import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const MAX_TEST_PROJECT_DIR_LENGTH = 4096;

export function isElectronTestEnvironment(nodeEnv: unknown): boolean {
  return nodeEnv === 'test';
}

export function resolveTestProjectDirectory(
  nodeEnv: unknown,
  candidate: unknown,
): string | null {
  if (!isElectronTestEnvironment(nodeEnv)) return null;
  if (
    typeof candidate !== 'string'
    || candidate.trim() === ''
    || candidate.length > MAX_TEST_PROJECT_DIR_LENGTH
    || !isAbsolute(candidate)
  ) {
    throw new Error('测试项目目录必须是有效的绝对路径');
  }

  try {
    const directory = realpathSync(candidate);
    if (!statSync(directory).isDirectory()) {
      throw new Error();
    }
    return directory;
  } catch {
    throw new Error('测试项目目录必须指向真实存在的目录');
  }
}
