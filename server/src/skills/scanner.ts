/**
 * Skills 系统
 *
 * 约定:
 *  - 扫描路径(后到前,前面的优先):
 *      1. <companyRoot>/.minimax/skills/         (项目级,不放进 git 也行)
 *      2. ~/.minimax/skills/                     (用户全局)
 *  - 每个 skill 一个目录,里必有 SKILL.md(frontmatter + body)
 *  - 装(安装)= 从 URL/上传/hub 抓 → 解到 ~/.minimax/skills/<name>/
 *  - 卸(卸载)= 仅删除本机的 skill 目录(不动 source)
 *
 * Hub: 复用 ~/.minimax/skill-hub.json 里已有的清单(无需自己维护)
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { assertValidSkillName, assertPathWithin, InvalidSkillNameError } from '../utils/validateSkillName.js';
import { safeFetch } from '../utils/safeFetch.js';

const execAsync = promisify(exec);

export interface SkillMeta {
  name: string;
  description: string;
  source: 'project' | 'user' | 'hub';
  path: string; // SKILL.md 绝对路径
  /** 该 skill 目录下附属文件数(SKILL.md 本身不计) */
  extraFiles: number;
}

export interface SkillDetail extends SkillMeta {
  body: string; // SKILL.md 全文
}

export interface HubEntry {
  name: string;
  displayName?: string;
  description: string;
  sourceUrl?: string;
  installed: boolean;
  content?: string;
}

/** 解析 SKILL.md 的 frontmatter(只解析 name / description) */
function parseFrontmatter(md: string): { name: string; description: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m || !m[1]) {
    return { name: '', description: '', body: md };
  }
  const fm = m[1];
  const body = m[2] ?? '';
  const nameMatch = fm.match(/^\s*name:\s*(.+?)\s*$/m);
  const descMatch = fm.match(/^\s*description:\s*(.+?)\s*$/m);
  return {
    name: nameMatch?.[1] ?? '',
    description: descMatch?.[1] ?? '',
    body,
  };
}

/** 单个目录扫一次,返回 meta 列表 */
function scanDir(dir: string, source: 'project' | 'user'): SkillMeta[] {
  if (!existsSync(dir)) return [];
  const out: SkillMeta[] = [];
  for (const entry of readdirSync(dir)) {
    const skillMd = join(dir, entry, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    try {
      const raw = readFileSync(skillMd, 'utf-8');
      const { name, description } = parseFrontmatter(raw);
      // 统计附属文件
      let extraFiles = 0;
      try {
        const inner = readdirSync(join(dir, entry));
        extraFiles = inner.filter((f) => f !== 'SKILL.md').length;
      } catch {}
      out.push({
        name: name || entry,
        description,
        source,
        path: skillMd,
        extraFiles,
      });
    } catch {}
  }
  return out;
}

export function getSkillsRoot(companyRoot: string): string {
  return join(homedir(), '.minimax', 'skills');
}

export function getProjectSkillsRoot(companyRoot: string): string {
  return join(companyRoot, '.minimax', 'skills');
}

export function listSkills(companyRoot: string): SkillMeta[] {
  const user = scanDir(getSkillsRoot(companyRoot), 'user');
  const project = scanDir(getProjectSkillsRoot(companyRoot), 'project');
  // 项目级优先;同 name 的,project 覆盖 user
  const map = new Map<string, SkillMeta>();
  for (const s of user) map.set(s.name, s);
  for (const s of project) map.set(s.name, s);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(companyRoot: string, name: string): SkillDetail | null {
  // 球球 review C1: 即使是读,name 也不应包含路径分隔符(防止直接传 ".." 等异常)
  assertValidSkillName(name);
  const list = listSkills(companyRoot);
  const meta = list.find((s) => s.name === name);
  if (!meta) return null;
  const raw = readFileSync(meta.path, 'utf-8');
  return { ...meta, body: raw };
}

/** 把一个目录"装"到 ~/.minimax/skills/<name>/ */
async function installDir(srcDir: string, name: string): Promise<{ installed: string }> {
  // 球球 review C2: name 完全不可信(frontmatter / hint),先校验再 resolve
  assertValidSkillName(name);
  const skillsRoot = getSkillsRoot(process.cwd());
  const dest = assertPathWithin(name, skillsRoot);
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });
  // 拷贝:用 cp 命令(JSON.stringify 防 shell injection)
  try {
    await execAsync(`cp -R ${JSON.stringify(srcDir) + '/.'} ${JSON.stringify(dest) + '/'}`);
  } catch (e: any) {
    throw new Error(`cp failed: ${e.message}`);
  }
  return { installed: dest };
}

/** 从 URL 装(支持 .zip / .tar.gz / 直传目录) */
export async function installFromUrl(url: string, nameHint?: string): Promise<{ name: string; source: string }> {
  // 球球 review C4: 下载 URL 走 SSRF deny-list(但允许任意 https 公网 — 用户从 hub 装 skill 要能下)
  const res = await safeFetch(url, undefined, { timeoutMs: 60000 });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const tmpZip = join(tmpdir(), `skill-${Date.now()}.zip`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(tmpZip, buf);

  // 解压到一个临时目录
  const tmpExtract = join(tmpdir(), `skill-extract-${Date.now()}`);
  mkdirSync(tmpExtract, { recursive: true });
  // 球球 review LOW #20: 旧 unzip 不挡 zip-slip;用 tar 替代(只支持 .tar.gz,够用)
  // 但项目当前用 .zip — 先用 unzip,后面 LOW 修 zip-slip
  await execAsync(`unzip -q ${JSON.stringify(tmpZip)} -d ${JSON.stringify(tmpExtract)}`);
  rmSync(tmpZip, { force: true });

  // 找 SKILL.md(可能在根目录,也可能在唯一子目录里)
  const root = readdirSync(tmpExtract);
  let skillDir = tmpExtract;
  if (root.length === 1 && root[0]) {
    const candidate = join(tmpExtract, root[0]);
    if (statSync(candidate).isDirectory() && existsSync(join(candidate, 'SKILL.md'))) {
      skillDir = candidate;
    }
  }
  if (!existsSync(join(skillDir, 'SKILL.md'))) {
    rmSync(tmpExtract, { recursive: true, force: true });
    throw new Error('downloaded archive does not contain SKILL.md at root or one level deep');
  }

  // 读 name
  const raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
  const { name: parsedName } = parseFrontmatter(raw);
  const finalName = nameHint || parsedName || skillDir.split('/').pop() || 'unnamed-skill';

  // 球球 review C2: installDir 内部已 assertValidSkillName,失败会抛 InvalidSkillNameError
  try {
    await installDir(skillDir, finalName);
  } finally {
    rmSync(tmpExtract, { recursive: true, force: true });
  }
  return { name: finalName, source: url };
}

/** 从 base64 zip 装 */
export async function installFromUpload(
  base64: string,
  filename: string,
  nameHint?: string,
): Promise<{ name: string; source: string }> {
  const buf = Buffer.from(base64, 'base64');
  const tmpZip = join(tmpdir(), `skill-upload-${Date.now()}-${filename}`);
  writeFileSync(tmpZip, buf);
  // 复用 URL 安装路径(写一个 file:// URL 不合适,直接解压)
  const tmpExtract = join(tmpdir(), `skill-extract-${Date.now()}`);
  mkdirSync(tmpExtract, { recursive: true });
  await execAsync(`unzip -q ${JSON.stringify(tmpZip)} -d ${JSON.stringify(tmpExtract)}`);
  rmSync(tmpZip, { force: true });

  const root = readdirSync(tmpExtract);
  let skillDir = tmpExtract;
  if (root.length === 1 && root[0]) {
    const candidate = join(tmpExtract, root[0]);
    if (statSync(candidate).isDirectory() && existsSync(join(candidate, 'SKILL.md'))) {
      skillDir = candidate;
    }
  }
  if (!existsSync(join(skillDir, 'SKILL.md'))) {
    rmSync(tmpExtract, { recursive: true, force: true });
    throw new Error('uploaded archive does not contain SKILL.md');
  }
  const raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
  const { name: parsedName } = parseFrontmatter(raw);
  const finalName = nameHint || parsedName || 'unnamed-skill';

  installDir(skillDir, finalName);
  rmSync(tmpExtract, { recursive: true, force: true });
  return { name: finalName, source: `upload:${filename}` };
}

/**
 * 直接写入 SKILL.md 内容(用户在前端 textarea 里手写的)
 * 必须带 frontmatter(--- ... ---),从 frontmatter.name 拿名字;失败回退到 nameHint
 */
export async function installFromContent(
  content: string,
  nameHint?: string,
): Promise<{ name: string; source: string }> {
  if (!content || !content.trim()) {
    throw new Error('content is empty');
  }
  // 解析 frontmatter
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    throw new Error('SKILL.md 格式不对:必须有 frontmatter,以 --- 开头和结尾');
  }
  const fm = m[1] ?? '';
  const nameMatch = fm.match(/^\s*name:\s*(.+?)\s*$/m);
  const finalName = nameHint || nameMatch?.[1]?.trim() || 'unnamed-skill';

  // 球球 review C2: name 完全不可信(frontmatter 由用户填),先校验
  assertValidSkillName(finalName);
  const skillsRoot = getSkillsRoot(process.cwd());
  const dest = assertPathWithin(finalName, skillsRoot);

  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'SKILL.md'), content, 'utf-8');
  return { name: finalName, source: 'content' };
}

/**
 * 读 ~/.minimax/skill-hub.json 里的 hub 列表,
 * 合并已安装状态(以 listSkills 为准)
 */
export function listHub(companyRoot: string): HubEntry[] {
  const hubPath = join(homedir(), '.minimax', 'skill-hub.json');
  if (!existsSync(hubPath)) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(hubPath, 'utf-8'));
  } catch {
    return [];
  }
  const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
  const installed = new Set(listSkills(companyRoot).map((s) => s.name));
  return skills.map((s: any) => ({
    name: s.name,
    displayName: s.display_name,
    description: s.description ?? '',
    sourceUrl: s.source_url,
    installed: installed.has(s.name),
  }));
}

/** 卸载 = 删除 ~/.minimax/skills/<name>/ */
export function uninstallSkill(companyRoot: string, name: string): { removed: string } {
  // 球球 review C1: name 完全不可信(从 URL `:name` 来),先校验
  assertValidSkillName(name);

  const userDir = assertPathWithin(name, getSkillsRoot(companyRoot));
  const projectDir = assertPathWithin(name, getProjectSkillsRoot(companyRoot));

  let removed = '';
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
    removed = projectDir;
  } else if (existsSync(userDir)) {
    rmSync(userDir, { recursive: true, force: true });
    removed = userDir;
  } else {
    throw new Error(`skill "${name}" not found in local skills directories`);
  }
  return { removed };
}

/**
 * 给 runtime 用的:取 agent 启用的 skills 的 body 摘要
 * (限制总长度,避免 prompt 爆炸)
 */
export function getSkillsForAgent(
  companyRoot: string,
  skillNames: string[],
  maxCharsPerSkill = 1500,
): Array<{ name: string; description: string; body: string }> {
  const all = listSkills(companyRoot);
  const byName = new Map(all.map((s) => [s.name, s]));
  const out: Array<{ name: string; description: string; body: string }> = [];
  for (const n of skillNames) {
    const meta = byName.get(n);
    if (!meta) continue;
    try {
      const raw = readFileSync(meta.path, 'utf-8');
      const { description, body } = parseFrontmatter(raw);
      out.push({
        name: meta.name,
        description: description || meta.description,
        body: body.length > maxCharsPerSkill
          ? body.slice(0, maxCharsPerSkill) + '\n\n…(已截断,查看完整请打开 SKILL.md)'
          : body,
      });
    } catch {}
  }
  return out;
}
