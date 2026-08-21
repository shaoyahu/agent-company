import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDB, closeDB } from '../../src/store/db.js';
import { exportBackup, importBackup, resetData } from '../../src/api/dataBackup.js';
import { readZip, createZip } from '../../src/utils/zipArchive.js';

let root: string;
let dataDir: string;
let fakeHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-company-backup-root-'));
  dataDir = mkdtempSync(join(tmpdir(), 'agent-company-backup-db-'));
  fakeHome = mkdtempSync(join(tmpdir(), 'agent-company-backup-home-'));
  originalHome = process.env.HOME;
  process.env.HOME = fakeHome;
  closeDB();
  getDB(join(dataDir, 'company.db'));
});

afterEach(() => {
  closeDB();
  rmSync(root, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

function seedData(): void {
  const db = getDB();
  db.prepare(`INSERT INTO departments (id, name, head, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('d1', '研发', 'a1', 1, 1);
  db.prepare(`INSERT INTO llm_providers (id, type, api_key, endpoint, model, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('p1', 'openai', 'key', 'https://api.example.com/v1', 'm1', 1, 1, 1);

  const userSkill = join(fakeHome, '.minimax', 'skills', 'demo-user');
  mkdirSync(join(userSkill, 'references'), { recursive: true });
  writeFileSync(join(userSkill, 'SKILL.md'), '---\nname: demo-user\ndescription: 用户\n---\n\nbody');
  writeFileSync(join(userSkill, 'references', 'guide.md'), 'guide');

  const projectSkill = join(root, '.minimax', 'skills', 'demo-project');
  mkdirSync(projectSkill, { recursive: true });
  writeFileSync(join(projectSkill, 'SKILL.md'), '---\nname: demo-project\ndescription: 项目\n---\n\nbody');
}

test('exportBackup 导出 manifest/database 和 user/project skills', () => {
  seedData();
  const zip = exportBackup({ companyRoot: root });
  const entries = readZip(zip);
  const paths = entries.map((entry) => entry.path);

  assert.ok(paths.includes('manifest.json'));
  assert.ok(paths.includes('database.json'));
  assert.ok(paths.includes('skills/user/demo-user/SKILL.md'));
  assert.ok(paths.includes('skills/user/demo-user/references/guide.md'));
  assert.ok(paths.includes('skills/project/demo-project/SKILL.md'));

  const databaseEntry = entries.find((entry) => entry.path === 'database.json');
  assert.ok(databaseEntry);
  const database = JSON.parse(databaseEntry.data.toString('utf8'));
  assert.equal(database.tables.departments[0].id, 'd1');
});

test('importBackup 恢复 SQLite 行和 skills', () => {
  seedData();
  const zip = exportBackup({ companyRoot: root });
  resetData({ companyRoot: root, createSafetyBackup: false });

  const result = importBackup({ companyRoot: root, zipBuffer: zip, createSafetyBackup: false });
  const db = getDB();
  const dept = db.prepare(`SELECT name FROM departments WHERE id = ?`).get('d1') as { name: string };

  assert.equal(result.ok, true);
  assert.equal(dept.name, '研发');
  assert.equal(existsSync(join(fakeHome, '.minimax', 'skills', 'demo-user', 'SKILL.md')), true);
  assert.equal(existsSync(join(fakeHome, '.minimax', 'skills', 'demo-user', 'references', 'guide.md')), true);
  assert.equal(existsSync(join(root, '.minimax', 'skills', 'demo-project', 'SKILL.md')), true);
});

test('importBackup 拒绝未知表', () => {
  const zip = createZip([
    { path: 'manifest.json', data: JSON.stringify({ app: 'agent-company', format: 'agent-company-backup', version: 1 }) },
    { path: 'database.json', data: JSON.stringify({ tables: { evil_table: [] } }) },
  ]);

  assert.throws(
    () => importBackup({ companyRoot: root, zipBuffer: zip, createSafetyBackup: false }),
    /未知表/,
  );
});

test('resetData 清空 SQLite 和 skills 并生成安全备份', () => {
  seedData();
  const result = resetData({ companyRoot: root, createSafetyBackup: true });
  const db = getDB();
  const count = db.prepare(`SELECT COUNT(*) AS count FROM departments`).get() as { count: number };

  assert.equal(count.count, 0);
  assert.equal(existsSync(join(fakeHome, '.minimax', 'skills', 'demo-user')), false);
  assert.equal(existsSync(join(root, '.minimax', 'skills', 'demo-project')), false);
  assert.equal(existsSync(result.backupPath), true);
  assert.ok(readFileSync(result.backupPath).length > 0);
});
