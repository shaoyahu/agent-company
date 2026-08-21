import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, relative } from 'node:path';

function isWithin(candidate: string, root: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (
    child !== '..'
    && !child.startsWith('../')
    && !isAbsolute(child)
  );
}

export function validateProjectDir(
  value: unknown,
): { dir: string } | { error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: 'projectDir 不能为空' };
  }
  if (value.length > 4096) {
    return { error: '项目目录路径过长' };
  }
  if (!isAbsolute(value)) {
    return { error: '项目目录必须是绝对路径' };
  }

  let directory: string;
  try {
    directory = realpathSync(value);
  } catch {
    return { error: `projectDir 路径不合法: ${value}` };
  }
  if (!statSync(directory).isDirectory()) {
    return { error: `不是目录: ${directory}` };
  }

  const allowedRoots = [homedir(), tmpdir()].map((root) => (
    realpathSync(root)
  ));
  if (!allowedRoots.some((root) => isWithin(directory, root))) {
    return {
      error: `项目目录必须在 home 或 system tmp 下,拒绝: ${directory}`,
    };
  }
  return { dir: directory };
}
