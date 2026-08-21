import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { getDB, getDBPath } from '../store/db.js';
import { getProjectSkillsRoot, getSkillsRoot } from '../skills/scanner.js';
import { assertPathWithin, assertValidSkillName } from '../utils/validateSkillName.js';
import { createZip, readZip, type ZipEntry, type ZipEntryInput } from '../utils/zipArchive.js';

export const BACKUP_TABLES = [
  'conversation_deliveries',
  'conversation_messages',
  'conversation_members',
  'conversations',
  'messages',
  'deliverables',
  'tasks',
  'projects',
  'agent_status',
  'llm_providers',
  'departments',
  'agents',
  'custom_tools',
  'workflows',
] as const;

const INSERT_ORDER = [
  'projects',
  'tasks',
  'deliverables',
  'messages',
  'agent_status',
  'llm_providers',
  'departments',
  'agents',
  'custom_tools',
  'workflows',
  'conversations',
  'conversation_members',
  'conversation_messages',
  'conversation_deliveries',
] as const;

const BACKUP_FORMAT = {
  app: 'agent-company',
  format: 'agent-company-backup',
  version: 1,
} as const;

export interface DataRestoreResult {
  ok: true;
  backupPath: string;
  tableRows: Record<string, number>;
  skillCounts: { user: number; project: number };
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function readTable(table: string): Record<string, unknown>[] {
  return getDB().prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
}

function collectFiles(root: string, currentDir: string, prefix: 'skills/user' | 'skills/project'): ZipEntryInput[] {
  const out: ZipEntryInput[] = [];
  for (const dirent of readdirSync(currentDir, { withFileTypes: true })) {
    if (dirent.name.includes('\\') || dirent.name === '..' || dirent.name === '') {
      throw new Error(`非法 skill 文件名: ${dirent.name}`);
    }
    const fullPath = join(currentDir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...collectFiles(root, fullPath, prefix));
      continue;
    }
    if (!dirent.isFile()) continue;
    const rel = relative(root, fullPath).split('/').join('/');
    out.push({
      path: `${prefix}/${rel}`,
      data: readFileSync(fullPath),
    });
  }
  return out;
}

function collectSkillEntries(root: string, prefix: 'skills/user' | 'skills/project'): ZipEntryInput[] {
  if (!existsSync(root)) return [];
  const entries: ZipEntryInput[] = [];
  for (const skillName of readdirSync(root)) {
    assertValidSkillName(skillName);
    const skillDir = assertPathWithin(skillName, root);
    const skillMd = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    entries.push(...collectFiles(root, skillDir, prefix));
  }
  return entries;
}

export function exportBackup(input: { companyRoot: string }): Buffer {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const tableRows: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = readTable(table);
    tableRows[table] = tables[table].length;
  }

  const userSkillEntries = collectSkillEntries(getSkillsRoot(input.companyRoot), 'skills/user');
  const projectSkillEntries = collectSkillEntries(getProjectSkillsRoot(input.companyRoot), 'skills/project');
  const userSkillNames = new Set(userSkillEntries.map((entry) => entry.path.split('/')[2]).filter(Boolean));
  const projectSkillNames = new Set(projectSkillEntries.map((entry) => entry.path.split('/')[2]).filter(Boolean));

  const manifest = {
    ...BACKUP_FORMAT,
    createdAt: Date.now(),
    tables: BACKUP_TABLES,
    tableRows,
    skillCounts: { user: userSkillNames.size, project: projectSkillNames.size },
  };

  return createZip([
    { path: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { path: 'database.json', data: JSON.stringify({ tables }, null, 2) },
    ...userSkillEntries,
    ...projectSkillEntries,
  ]);
}

function parseJsonEntry(entries: ZipEntry[], path: string): unknown {
  const entry = entries.find((item) => item.path === path);
  if (!entry) throw new Error(`备份包缺少 ${path}`);
  try {
    return JSON.parse(entry.data.toString('utf8'));
  } catch {
    throw new Error(`${path} 不是合法 JSON`);
  }
}

function createSafetyBackup(companyRoot: string): string {
  const backupDir = join(dirname(getDBPath()), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const path = join(backupDir, `agent-company-auto-backup-${timestamp()}.zip`);
  writeFileSync(path, exportBackup({ companyRoot }));
  return path;
}

function clearTables(): void {
  const db = getDB();
  for (const table of [...INSERT_ORDER].reverse()) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

function insertRows(tables: Record<string, Record<string, unknown>[]>): Record<string, number> {
  const db = getDB();
  const counts: Record<string, number> = {};
  for (const table of INSERT_ORDER) {
    const rows = tables[table] ?? [];
    counts[table] = rows.length;
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]!);
    if (columns.length === 0) continue;
    const placeholders = columns.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
    for (const row of rows) {
      stmt.run(columns.map((column) => row[column]));
    }
  }
  return counts;
}

function validateTables(value: unknown): Record<string, Record<string, unknown>[]> {
  if (!value || typeof value !== 'object') throw new Error('备份包缺少数据库数据');
  const tables = (value as { tables?: unknown }).tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    throw new Error('备份包缺少数据库数据');
  }
  const allowed = new Set<string>(BACKUP_TABLES);
  for (const [table, rows] of Object.entries(tables)) {
    if (!allowed.has(table)) throw new Error(`备份数据包含未知表: ${table}`);
    if (!Array.isArray(rows)) throw new Error(`备份表 ${table} 必须是数组`);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`备份表 ${table} 包含非法行`);
      }
    }
  }
  return tables as Record<string, Record<string, unknown>[]>;
}

function validateManifest(value: unknown): void {
  const manifest = value as {
    app?: unknown;
    format?: unknown;
    version?: unknown;
  } | null;
  if (
    !manifest
    || manifest.app !== BACKUP_FORMAT.app
    || manifest.format !== BACKUP_FORMAT.format
    || manifest.version !== BACKUP_FORMAT.version
  ) {
    throw new Error('备份包格式不兼容');
  }
}

function makeTempSkillRoot(root: string): string {
  const parent = dirname(root);
  mkdirSync(parent, { recursive: true });
  return join(parent, `.skills-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function writeSkillEntry(root: string, skillName: string, fileParts: string[], data: Buffer): void {
  assertValidSkillName(skillName);
  if (fileParts.length === 0 || fileParts.some((part) => !part || part === '..' || part.includes('\\'))) {
    throw new Error(`非法 skill 备份路径: ${skillName}/${fileParts.join('/')}`);
  }
  const skillRoot = assertPathWithin(skillName, root);
  const dest = join(skillRoot, ...fileParts);
  const rel = relative(skillRoot, dest);
  if (rel.startsWith('..') || rel.includes('\\')) {
    throw new Error(`非法 skill 备份路径: ${skillName}/${fileParts.join('/')}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
}

function stageSkills(
  companyRoot: string,
  entries: ZipEntry[],
): { userRoot: string; projectRoot: string; userTemp: string; projectTemp: string; counts: { user: number; project: number } } {
  const userRoot = getSkillsRoot(companyRoot);
  const projectRoot = getProjectSkillsRoot(companyRoot);
  const userTemp = makeTempSkillRoot(userRoot);
  const projectTemp = makeTempSkillRoot(projectRoot);
  const counts = { user: new Set<string>(), project: new Set<string>() };
  mkdirSync(userTemp, { recursive: true });
  mkdirSync(projectTemp, { recursive: true });

  try {
    for (const entry of entries) {
      const parts = entry.path.split('/');
      if (parts[0] !== 'skills') continue;
      const scope = parts[1];
      const skillName = parts[2];
      const fileParts = parts.slice(3);
      if ((scope !== 'user' && scope !== 'project') || !skillName) {
        throw new Error(`非法 skill 备份路径: ${entry.path}`);
      }
      const targetRoot = scope === 'user' ? userTemp : projectTemp;
      writeSkillEntry(targetRoot, skillName, fileParts, entry.data);
      counts[scope].add(skillName);
    }
    return {
      userRoot,
      projectRoot,
      userTemp,
      projectTemp,
      counts: { user: counts.user.size, project: counts.project.size },
    };
  } catch (error) {
    rmSync(userTemp, { recursive: true, force: true });
    rmSync(projectTemp, { recursive: true, force: true });
    throw error;
  }
}

function replaceDirectory(target: string, staged: string): void {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  try {
    renameSync(staged, target);
  } catch {
    cpSync(staged, target, { recursive: true });
    rmSync(staged, { recursive: true, force: true });
  }
}

function resetSkillRoot(path: string): void {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

export function importBackup(input: {
  companyRoot: string;
  zipBuffer: Buffer;
  createSafetyBackup?: boolean;
}): DataRestoreResult {
  const entries = readZip(input.zipBuffer);
  validateManifest(parseJsonEntry(entries, 'manifest.json'));
  const tables = validateTables(parseJsonEntry(entries, 'database.json'));

  const staged = stageSkills(input.companyRoot, entries);
  const backupPath = input.createSafetyBackup === false ? '' : createSafetyBackup(input.companyRoot);
  try {
    const transaction = getDB().transaction(() => {
      clearTables();
      return insertRows(tables);
    });
    const tableRows = transaction();
    replaceDirectory(staged.userRoot, staged.userTemp);
    replaceDirectory(staged.projectRoot, staged.projectTemp);
    return { ok: true, backupPath, tableRows, skillCounts: staged.counts };
  } catch (error) {
    rmSync(staged.userTemp, { recursive: true, force: true });
    rmSync(staged.projectTemp, { recursive: true, force: true });
    throw error;
  }
}

export function resetData(input: { companyRoot: string; createSafetyBackup?: boolean }): DataRestoreResult {
  const backupPath = input.createSafetyBackup === false ? '' : createSafetyBackup(input.companyRoot);
  const transaction = getDB().transaction(() => {
    clearTables();
    const counts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) counts[table] = 0;
    return counts;
  });
  const tableRows = transaction();
  resetSkillRoot(join(homedir(), '.minimax', 'skills'));
  resetSkillRoot(getProjectSkillsRoot(input.companyRoot));
  return { ok: true, backupPath, tableRows, skillCounts: { user: 0, project: 0 } };
}
