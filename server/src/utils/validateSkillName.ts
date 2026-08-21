/**
 * validateSkillName — 校验 skill 名字段,防止路径穿越
 *
 * 球球 review C1 + C2: scanner.ts installFromUrl/Content + uninstallSkill
 * 接收的 name 来自 frontmatter (user-controlled) 或 URL hint,完全不可信。
 *
 * 规则:
 *   1. 非空
 *   2. 不含路径分隔符(/ \\) 也不含 .. 或 null byte
 *   3. 只允许 [a-z0-9_-] (跟公司 id 命名规范一致)
 *   4. resolve 后必须仍在 skills 根目录内(防"../"被任何路径库 normalize 之前)
 */

import { resolve } from 'node:path';

export class InvalidSkillNameError extends Error {
  constructor(name: string, reason: string) {
    super(`Invalid skill name "${name}": ${reason}`);
    this.name = 'InvalidSkillNameError';
  }
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** 校验 name 字段合法(纯字符串层) */
export function isValidSkillName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 64) return false;
  if (!NAME_RE.test(name)) return false;
  return true;
}

/** 抛错版本,scanner 安装/卸载/读路径前必调 */
export function assertValidSkillName(name: string): void {
  if (!isValidSkillName(name)) {
    throw new InvalidSkillNameError(
      name,
      'must be 1-64 chars, lowercase letters/digits/underscore/dash, starting with letter or digit',
    );
  }
}

/**
 * 解析后路径必须仍位于 skillsRoot 内。
 * 防御性 — 即使 assertValidSkillName 通过,根目录被换也兜一道。
 */
export function assertPathWithin(skillName: string, skillsRoot: string): string {
  const target = resolve(skillsRoot, skillName);
  const root = resolve(skillsRoot);
  if (target !== root && !target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
    throw new InvalidSkillNameError(skillName, `path "${target}" escapes skills root`);
  }
  return target;
}
