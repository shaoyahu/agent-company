// db test helper — 给 store repo 单测用
// 每次调 freshDB() 都创建一个临时 sqlite 文件,跑完 cleanupDB 删掉
// closeDB() 让 getDB 重新走单例 path(否则 dbInstance 已存在,getDB 忽略 path)
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDB, closeDB } from '../../src/store/db.js';

export function freshDB(): { dir: string; path: string } {
  closeDB();  // 清空单例
  const dir = mkdtempSync(join(tmpdir(), 'agent-co-test-'));
  const path = join(dir, 'test.db');
  // 立即 init(调用 getDB 触发 initSchema)
  getDB(path);
  return { dir, path };
}

export function cleanupDB(dir: string, path: string) {
  closeDB();
  if (existsSync(path)) {
    try { rmSync(path); } catch {}
  }
  if (existsSync(dir)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/** 清空所有表 — between tests 跑(不重建 db instance) */
export function truncateAll() {
  const db = getDB();
  // 按外键依赖顺序清理,保留 schema。
  for (const t of [
    'conversation_deliveries',
    'conversation_messages',
    'conversation_members',
    'conversations',
    'agents',
    'departments',
    'custom_tools',
    'llm_providers',
  ]) {
    db.exec(`DELETE FROM ${t}`);
  }
}
