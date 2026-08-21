import type Database from 'better-sqlite3';
import { getDB } from './db.js';

export interface StoredProvider {
  id: string;
  type: 'anthropic' | 'openai';
  apiKey: string;
  endpoint?: string;
  /** 自定义 API 路径 — NULL = 走协议标准(/chat/completions 或 /v1/messages);
   *  非空 = 跳过 pi-ai 自动 append,用 fetch 直接发到 {endpoint}{path} */
  path?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Provider 仓库 - 存 Web 上配置的 LLM providers
 * 优先级高于 yaml/env(用户主动配的覆盖默认)
 */
export class ProviderRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  list(): StoredProvider[] {
    const rows = this.db
      .prepare(`SELECT * FROM llm_providers ORDER BY created_at ASC`)
      .all() as any[];
    return rows.map(this.fromRow);
  }

  get(id: string): StoredProvider | null {
    const row = this.db.prepare(`SELECT * FROM llm_providers WHERE id = ?`).get(id) as any;
    return row ? this.fromRow(row) : null;
  }

  upsert(p: Omit<StoredProvider, 'createdAt' | 'updatedAt'>): StoredProvider {
    const now = Date.now();
    const existing = this.get(p.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE llm_providers SET
            type = ?, api_key = ?, endpoint = ?, path = ?, model = ?,
            max_tokens = ?, temperature = ?, enabled = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          p.type,
          p.apiKey,
          p.endpoint ?? null,
          p.path ?? null,
          p.model,
          p.maxTokens ?? null,
          p.temperature ?? null,
          p.enabled ? 1 : 0,
          now,
          p.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO llm_providers (id, type, api_key, endpoint, path, model, max_tokens, temperature, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          p.id,
          p.type,
          p.apiKey,
          p.endpoint ?? null,
          p.path ?? null,
          p.model,
          p.maxTokens ?? null,
          p.temperature ?? null,
          p.enabled ? 1 : 0,
          now,
          now,
        );
    }
    return this.get(p.id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM llm_providers WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(`UPDATE llm_providers SET enabled = ?, updated_at = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, Date.now(), id);
  }

  private fromRow = (row: any): StoredProvider => ({
    id: row.id,
    type: row.type,
    apiKey: row.api_key,
    endpoint: row.endpoint ?? undefined,
    path: row.path ?? undefined,
    model: row.model,
    maxTokens: row.max_tokens ?? undefined,
    temperature: row.temperature ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
