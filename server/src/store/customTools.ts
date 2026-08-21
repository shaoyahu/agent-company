import type Database from 'better-sqlite3';
import { getDB } from './db.js';

export type CustomToolType = 'http' | 'shell' | 'prompt' | 'cli';

export interface HttpToolConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  /** 把 input 的哪些字段映射到 query / body,默认全塞到 body */
  bodyMode?: 'json' | 'form' | 'query';
  /** 鉴权:简单 bearer 头(更复杂的留 TODO) */
  bearerToken?: string;
  /** 超时 ms */
  timeoutMs?: number;
}

export interface ShellToolConfig {
  /** shell 命令模板,用 {{paramName}} 占位 */
  command: string;
  /** 必填参数名列表(从 input 里取) */
  params: string[];
  /** 超时 ms */
  timeoutMs?: number;
}

export interface PromptToolConfig {
  /** prompt 模板,用 {{paramName}} 占位 */
  template: string;
}

export interface CliModelsParser {
  type: 'lines' | 'json-path' | 'regex';
  path?: string;
  pattern?: string;
  flags?: string;
  group?: number;
}

export interface CliToolConfig {
  /** 实际可执行文件路径(e.g. /usr/local/bin/claude 或 /Users/x/.local/bin/traecli) */
  command: string;
  /** 参数模板,用 {{prompt}} {{model}} {{cwd}} 占位;支持 {key:q} quoting(防 clap 拆 token) */
  argsTemplate: string;
  /**
   * 球球 review 2026-08-16:可选 stdin 模板 — 把渲染后内容写到 child.stdin
   * 适用于 traecli exec 这种"PROMPT 当 argv 它仍等 stdin 追加"的设计:
   * traecli 必须靠 stdin 喂 prompt 才会"Reading prompt from stdin..."立即处理。
   * 不传则默认关 stdin(stdio: 'ignore'),适用于 claude --print 这种纯 argv 模式。
   */
  stdinTemplate?: string;
  /** 可选,默认 model(给 {{model}} 用) */
  defaultModel?: string;
  /** 已验证但无法由 CLI 稳定枚举的模型选项 */
  staticModels?: string[];
  /** 列出当前 CLI 可用模型的参数串,例如 "models" */
  modelsCommand?: string;
  /** 模型命令输出解析方式 */
  modelsParser?: CliModelsParser;
  /** 模型探测超时,默认 15 秒 */
  modelsTimeoutMs?: number;
  /** 超时 ms,默认 10 分钟 */
  timeoutMs?: number;
  /** 环境变量 */
  env?: Record<string, string>;
}

export type CustomToolConfig = HttpToolConfig | ShellToolConfig | PromptToolConfig | CliToolConfig;

export interface StoredCustomTool {
  id: string;
  name: string;
  type: CustomToolType;
  description: string;
  config: CustomToolConfig;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export class CustomToolRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  list(): StoredCustomTool[] {
    const rows = this.db
      .prepare(`SELECT * FROM custom_tools ORDER BY name ASC`)
      .all() as any[];
    return rows.map(this.fromRow);
  }

  get(id: string): StoredCustomTool | null {
    const row = this.db.prepare(`SELECT * FROM custom_tools WHERE id = ?`).get(id) as any;
    return row ? this.fromRow(row) : null;
  }

  getByName(name: string): StoredCustomTool | null {
    const row = this.db.prepare(`SELECT * FROM custom_tools WHERE name = ?`).get(name) as any;
    return row ? this.fromRow(row) : null;
  }

  upsert(t: Omit<StoredCustomTool, 'createdAt' | 'updatedAt'>): StoredCustomTool {
    const now = Date.now();
    const existing = this.get(t.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE custom_tools SET
            name = ?, type = ?, description = ?, config = ?, enabled = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          t.name,
          t.type,
          t.description,
          JSON.stringify(t.config),
          t.enabled ? 1 : 0,
          now,
          t.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO custom_tools (id, name, type, description, config, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          t.id,
          t.name,
          t.type,
          t.description,
          JSON.stringify(t.config),
          t.enabled ? 1 : 0,
          now,
          now,
        );
    }
    return this.get(t.id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM custom_tools WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(`UPDATE custom_tools SET enabled = ?, updated_at = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, Date.now(), id);
  }

  private fromRow = (row: any): StoredCustomTool => ({
    id: row.id,
    name: row.name,
    type: row.type as CustomToolType,
    description: row.description ?? '',
    config: JSON.parse(row.config || '{}'),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
