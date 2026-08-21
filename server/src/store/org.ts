import type Database from 'better-sqlite3';
import { getDB } from './db.js';
import type { DepartmentConfig, AgentConfig } from '../types/company.js';

// ─── Departments ────────────────────────────────────────
export class DepartmentRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  list(): DepartmentConfig[] {
    const rows = this.db
      .prepare(`SELECT * FROM departments ORDER BY id ASC`)
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      head: r.head ?? '',
      teams: r.teams ? JSON.parse(r.teams) : undefined,
      parentId: r.parent_id ?? undefined,
    }));
  }

  get(id: string): DepartmentConfig | null {
    const row = this.db.prepare(`SELECT * FROM departments WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      head: row.head ?? '',
      teams: row.teams ? JSON.parse(row.teams) : undefined,
      parentId: row.parent_id ?? undefined,
    };
  }

  upsert(d: DepartmentConfig): DepartmentConfig {
    const now = Date.now();
    const existing = this.get(d.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE departments SET name = ?, description = ?, head = ?, teams = ?, parent_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          d.name,
          d.description ?? null,
          d.head,
          d.teams ? JSON.stringify(d.teams) : null,
          d.parentId ?? null,
          now,
          d.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO departments (id, name, description, head, teams, parent_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          d.id,
          d.name,
          d.description ?? null,
          d.head,
          d.teams ? JSON.stringify(d.teams) : null,
          d.parentId ?? null,
          now,
          now,
        );
    }
    return this.get(d.id)!;
  }

  delete(id: string): boolean {
    // 子部门的 parent_id 会被 ON DELETE SET NULL 自动置空
    const result = this.db.prepare(`DELETE FROM departments WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  /**
   * 找出 id 的所有后代(用于防环校验)
   */
  getDescendants(id: string): string[] {
    const result: string[] = [];
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = this.db
        .prepare(`SELECT id FROM departments WHERE parent_id = ?`)
        .all(current) as any[];
      for (const c of children) {
        result.push(c.id);
        queue.push(c.id);
      }
    }
    return result;
  }

  /**
   * 防止 parentId 形成循环(把 A 设为自己的后代)
   */
  wouldCreateCycle(deptId: string, newParentId: string | undefined): boolean {
    if (!newParentId) return false;
    if (deptId === newParentId) return true;
    const descendants = this.getDescendants(deptId);
    return descendants.includes(newParentId);
  }
}

// ─── Agents ────────────────────────────────────────
export class AgentRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  list(): AgentConfig[] {
    const rows = this.db
      .prepare(`SELECT * FROM agents ORDER BY department, id`)
      .all() as any[];
    return rows.map(this.fromRow);
  }

  get(id: string): AgentConfig | null {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as any;
    return row ? this.fromRow(row) : null;
  }

  upsert(a: AgentConfig & { enabled?: boolean }): AgentConfig {
    const now = Date.now();
    const existing = this.db.prepare(`SELECT id FROM agents WHERE id = ?`).get(a.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE agents SET
            name = ?, department = ?, team = ?, role = ?, llm = ?,
            system_prompt = ?, tools = ?, skills = ?, description = ?, avatar = ?,
            executor = ?, cli_tool = ?, cli_model = ?,
            enabled = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          a.name ?? null,
          a.department,
          a.team ?? null,
          a.role,
          a.llm,
          a.systemPrompt,
          JSON.stringify(a.tools ?? []),
          JSON.stringify(a.skills ?? []),
          a.description ?? null,
          a.avatar ?? null,
          a.executor ?? 'llm',
          a.cliTool ?? null,
          a.cliModel ?? null,
          (a as any).enabled === false ? 0 : 1,
          now,
          a.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO agents (id, name, department, team, role, llm, system_prompt, tools, skills, description, avatar, executor, cli_tool, cli_model, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          a.id,
          a.name ?? null,
          a.department,
          a.team ?? null,
          a.role,
          a.llm,
          a.systemPrompt,
          JSON.stringify(a.tools ?? []),
          JSON.stringify(a.skills ?? []),
          a.description ?? null,
          a.avatar ?? null,
          a.executor ?? 'llm',
          a.cliTool ?? null,
          a.cliModel ?? null,
          (a as any).enabled === false ? 0 : 1,
          now,
          now,
        );
    }
    return this.get(a.id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  private fromRow = (row: any): AgentConfig => ({
    id: row.id,
    name: row.name ?? undefined,
    department: row.department,
    team: row.team ?? undefined,
    role: row.role,
    llm: row.llm,
    systemPrompt: row.system_prompt,
    tools: JSON.parse(row.tools || '[]'),
    skills: row.skills ? JSON.parse(row.skills) : undefined,
    description: row.description ?? undefined,
    avatar: row.avatar ?? undefined,
    enabled: row.enabled !== 0,
    executor: row.executor ?? 'llm',
    cliTool: row.cli_tool ?? undefined,
    cliModel: row.cli_model ?? undefined,
  });
}
