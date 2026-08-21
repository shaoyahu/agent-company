import type Database from 'better-sqlite3';
import { getDB } from './db.js';
import type {
  Project,
  Task,
  Deliverable,
  ChatMessage,
  ProjectStatus,
  TaskStatus,
} from '../types/company.js';

/**
 * Project repository
 */
export class ProjectRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  create(p: Omit<Project, 'createdAt' | 'updatedAt'>): Project {
    const now = Date.now();
    const project: Project = { ...p, createdAt: now, updatedAt: now };
    this.db
      .prepare(
        `INSERT INTO projects (id, title, description, boss, status, phase, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.title,
        project.description ?? null,
        project.boss,
        project.status,
        project.phase,
        JSON.stringify(project.metadata),
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  get(id: string): Project | null {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as any;
    return row ? this.fromRow(row) : null;
  }

  list(): Project[] {
    const rows = this.db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all() as any[];
    return rows.map((r) => this.fromRow(r));
  }

  updateStatus(id: string, status: ProjectStatus, phase: string): void {
    this.db
      .prepare(
        `UPDATE projects SET status = ?, phase = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, phase, Date.now(), id);
  }

  delete(id: string): boolean {
    const remove = this.db.transaction((projectId: string) => {
      this.db.prepare(`DELETE FROM messages WHERE project_id = ?`).run(projectId);
      return this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    });
    const result = remove(id);
    return result.changes > 0;
  }

  private fromRow(row: any): Project {
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      boss: row.boss,
      status: row.status,
      phase: row.phase,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Task repository
 */
const MAX_WORKFLOW_NODE_ID_LENGTH = 200;

export class TaskRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  create(t: Omit<Task, 'createdAt'>): Task {
    if (
      t.workflowNodeId !== undefined
      && (
        typeof t.workflowNodeId !== 'string'
        || t.workflowNodeId.trim().length === 0
        || [...t.workflowNodeId].length > MAX_WORKFLOW_NODE_ID_LENGTH
      )
    ) {
      throw new Error(
        `工作流节点 ID 必须是 1-${MAX_WORKFLOW_NODE_ID_LENGTH} 个字符的非空字符串`,
      );
    }
    if (
      !Number.isSafeInteger(t.workflowIteration)
      || t.workflowIteration < 0
    ) {
      throw new Error('工作流轮次必须是非负安全整数');
    }
    const now = Date.now();
    const task: Task = { ...t, createdAt: now };
    this.db
      .prepare(
        `INSERT INTO tasks (
         id, project_id, phase, workflow_node_id, workflow_iteration,
         department, assignee, title, prompt, status,
         input_files, output_files, output_summary, depends_on, attempts, max_attempts,
         input_tokens, output_tokens, duration_ms, error, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.phase,
        task.workflowNodeId ?? null,
        task.workflowIteration,
        task.department,
        task.assignee,
        task.title,
        task.prompt,
        task.status,
        JSON.stringify(task.inputFiles),
        JSON.stringify(task.outputFiles),
        task.outputSummary ?? null,
        JSON.stringify(task.dependsOn),
        task.attempts,
        task.maxAttempts,
        task.cost.inputTokens,
        task.cost.outputTokens,
        task.cost.durationMs,
        task.error ?? null,
        task.createdAt,
        task.startedAt ?? null,
        task.finishedAt ?? null,
      );
    return task;
  }

  get(id: string): Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;
    return row ? this.fromRow(row) : null;
  }

  listByProject(projectId: string): Task[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as any[];
    return rows.map((r) => this.fromRow(r));
  }

  listByStatus(status: TaskStatus): Task[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC`)
      .all(status) as any[];
    return rows.map((r) => this.fromRow(r));
  }

  updateStatus(id: string, status: TaskStatus): void {
    const now = Date.now();
    const setStartedAt = status === 'running';
    const setFinishedAt = status === 'done' || status === 'failed';
    if (setStartedAt && setFinishedAt) {
      this.db
        .prepare(`UPDATE tasks SET status = ?, started_at = COALESCE(started_at, ?), finished_at = ? WHERE id = ?`)
        .run(status, now, now, id);
    } else if (setStartedAt) {
      this.db
        .prepare(`UPDATE tasks SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`)
        .run(status, now, id);
    } else if (setFinishedAt) {
      this.db
        .prepare(`UPDATE tasks SET status = ?, finished_at = ? WHERE id = ?`)
        .run(status, now, id);
    } else {
      this.db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).run(status, id);
    }
  }

  recordResult(
    id: string,
    result: {
      outputFiles?: string[];
      outputSummary?: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      error?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE tasks SET
          output_files = ?,
          output_summary = ?,
          input_tokens = ?,
          output_tokens = ?,
          duration_ms = ?,
          error = ?,
          status = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(result.outputFiles ?? []),
        result.outputSummary ?? null,
        result.inputTokens,
        result.outputTokens,
        result.durationMs,
        result.error ?? null,
        result.error ? 'failed' : 'done',
        id,
      );
  }

  incrementAttempts(id: string): void {
    this.db.prepare(`UPDATE tasks SET attempts = attempts + 1 WHERE id = ?`).run(id);
  }

  private fromRow(row: any): Task {
    return {
      id: row.id,
      projectId: row.project_id,
      phase: row.phase,
      workflowNodeId: row.workflow_node_id ?? undefined,
      workflowIteration:
        Number.isSafeInteger(row.workflow_iteration) && row.workflow_iteration >= 0
          ? row.workflow_iteration
          : 0,
      department: row.department,
      assignee: row.assignee,
      title: row.title,
      prompt: row.prompt,
      status: row.status,
      inputFiles: JSON.parse(row.input_files || '[]'),
      outputFiles: JSON.parse(row.output_files || '[]'),
      outputSummary: row.output_summary ?? undefined,
      dependsOn: JSON.parse(row.depends_on || '[]'),
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      cost: {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        durationMs: row.duration_ms,
      },
      error: row.error ?? undefined,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
    };
  }
}

/**
 * Deliverable repository
 */
export class DeliverableRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  create(d: Omit<Deliverable, 'createdAt'>): Deliverable {
    const now = Date.now();
    const del: Deliverable = { ...d, createdAt: now };
    this.db
      .prepare(
        `INSERT INTO deliverables (id, project_id, task_id, type, path, mime_type, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        del.id,
        del.projectId,
        del.taskId ?? null,
        del.type,
        del.path,
        del.mimeType ?? null,
        JSON.stringify(del.metadata),
        del.createdAt,
      );
    return del;
  }

  listByProject(projectId: string): Deliverable[] {
    const rows = this.db
      .prepare(`SELECT * FROM deliverables WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_id ?? undefined,
      type: r.type,
      path: r.path,
      mimeType: r.mime_type ?? undefined,
      metadata: JSON.parse(r.metadata || '{}'),
      createdAt: r.created_at,
    }));
  }
}

/**
 * Chat message repository
 */
export class MessageRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  create(m: Omit<ChatMessage, 'createdAt'>): ChatMessage {
    const now = Date.now();
    const msg: ChatMessage = { ...m, createdAt: now };
    this.db
      .prepare(
        `INSERT INTO messages (id, project_id, task_id, channel, from_id, from_name, from_role, content, type, tool_name, tool_input, mentions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.id,
        msg.projectId ?? null,
        msg.taskId ?? null,
        msg.channel,
        msg.fromId,
        msg.fromName,
        msg.fromRole ?? null,
        msg.content,
        msg.type,
        msg.toolName ?? null,
        msg.toolInput ? JSON.stringify(msg.toolInput) : null,
        JSON.stringify(msg.mentions),
        msg.createdAt,
      );
    return msg;
  }

  listByProject(projectId: string, limit: number = 200): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(projectId, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id ?? undefined,
      taskId: r.task_id ?? undefined,
      channel: r.channel,
      fromId: r.from_id,
      fromName: r.from_name,
      fromRole: r.from_role ?? undefined,
      content: r.content,
      type: r.type,
      toolName: r.tool_name ?? undefined,
      toolInput: r.tool_input ? JSON.parse(r.tool_input) : undefined,
      mentions: JSON.parse(r.mentions || '[]'),
      createdAt: r.created_at,
    }));
  }

  listByChannel(projectId: string, channel: string, limit: number = 200): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE project_id = ? AND channel = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(projectId, channel, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id ?? undefined,
      taskId: r.task_id ?? undefined,
      channel: r.channel,
      fromId: r.from_id,
      fromName: r.from_name,
      fromRole: r.from_role ?? undefined,
      content: r.content,
      type: r.type,
      toolName: r.tool_name ?? undefined,
      toolInput: r.tool_input ? JSON.parse(r.tool_input) : undefined,
      mentions: JSON.parse(r.mentions || '[]'),
      createdAt: r.created_at,
    }));
  }
}

/**
 * Agent status (in-memory backed by db for crash recovery)
 */
export class AgentStatusRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  setStatus(agentId: string, status: 'idle' | 'busy' | 'offline', currentTaskId?: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_status (agent_id, status, current_task_id, last_active_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET
           status = excluded.status,
           current_task_id = excluded.current_task_id,
           last_active_at = excluded.last_active_at`,
      )
      .run(agentId, status, currentTaskId ?? null, Date.now());
  }

  getAll(): Array<{
    agentId: string;
    status: 'idle' | 'busy' | 'offline';
    currentTaskId?: string;
    lastActiveAt: number;
  }> {
    const rows = this.db.prepare(`SELECT * FROM agent_status`).all() as any[];
    return rows.map((r) => ({
      agentId: r.agent_id,
      status: r.status,
      currentTaskId: r.current_task_id ?? undefined,
      lastActiveAt: r.last_active_at,
    }));
  }
}
