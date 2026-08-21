import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  WorkflowNodeOutput,
  WorkflowNodeOutputInput,
  WorkflowNodeControlResult,
  WorkflowNodeRunStatus,
} from '../types/company.js';
import type { WorkflowNodeType } from '../workflows/model.js';
import { getDB } from './db.js';

const STATUSES = new Set<WorkflowNodeRunStatus>(['running', 'completed', 'failed']);

function parseControlResult(value: unknown): WorkflowNodeControlResult | undefined {
  if (value === null || value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof value === 'string' ? value : '');
  } catch {
    throw new Error('节点控制结果 JSON 解析失败');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('节点控制结果必须是对象');
  }
  const result = parsed as Record<string, unknown>;
  if (result.type === 'condition' && typeof result.matched === 'boolean') {
    return { type: 'condition', matched: result.matched };
  }
  if (
    result.type === 'loop'
    && (result.action === 'continue' || result.action === 'end')
  ) {
    return { type: 'loop', action: result.action };
  }
  throw new Error('节点控制结果字段无效');
}

function parseStringArray(value: unknown, label: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof value === 'string' ? value : '[]');
  } catch {
    throw new Error(`${label} JSON 解析失败`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  return parsed;
}

function parseInputSnapshot(value: unknown): WorkflowNodeOutputInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof value === 'string' ? value : '[]');
  } catch {
    throw new Error('节点输入快照 JSON 解析失败');
  }
  if (!Array.isArray(parsed)) throw new Error('节点输入快照必须是数组');
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`节点输入快照第 ${index + 1} 项必须是对象`);
    }
    const input = item as Record<string, unknown>;
    if (
      typeof input.sourceNodeId !== 'string'
      || typeof input.sourceRunId !== 'string'
      || typeof input.sourceName !== 'string'
      || typeof input.outputText !== 'string'
    ) {
      throw new Error(`节点输入快照第 ${index + 1} 项字段无效`);
    }
    if (!Array.isArray(input.outputFileRefs) || input.outputFileRefs.some((ref) => typeof ref !== 'string')) {
      throw new Error(`节点输入快照第 ${index + 1} 项文件引用无效`);
    }
    return {
      sourceNodeId: input.sourceNodeId,
      sourceRunId: input.sourceRunId,
      sourceName: input.sourceName,
      outputText: input.outputText,
      outputFileRefs: [...input.outputFileRefs],
    };
  });
}

export class WorkflowNodeOutputRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  createRunning(input: {
    projectId: string;
    workflowNodeId: string;
    workflowNodeType: WorkflowNodeType;
    runId: string;
    iteration: number;
    inputSnapshot: WorkflowNodeOutputInput[];
    createdAt: number;
  }): WorkflowNodeOutput {
    if (!Number.isSafeInteger(input.iteration) || input.iteration < 0) {
      throw new Error('工作流节点运行轮次必须是非负安全整数');
    }
    this.db.prepare(
      `INSERT INTO workflow_node_outputs (
        id, project_id, workflow_node_id, workflow_node_type, run_id, iteration,
        status, input_snapshot, output_text, output_task_ids, output_file_refs, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '', '[]', '[]', ?)
      ON CONFLICT(project_id, run_id) DO NOTHING`,
    ).run(
      randomUUID(),
      input.projectId,
      input.workflowNodeId,
      input.workflowNodeType,
      input.runId,
      input.iteration,
      JSON.stringify(input.inputSnapshot),
      input.createdAt,
    );
    const output = this.getByRun(input.projectId, input.runId);
    if (!output) throw new Error('节点运行记录创建后不存在');
    if (
      output.workflowNodeId !== input.workflowNodeId
      || output.workflowNodeType !== input.workflowNodeType
      || output.iteration !== input.iteration
    ) {
      throw new Error('节点运行记录归属冲突');
    }
    return output;
  }

  complete(
    projectId: string,
    runId: string,
    result: {
      outputText: string;
      outputTaskIds: string[];
      outputFileRefs: string[];
      controlResult?: WorkflowNodeControlResult;
    },
  ): WorkflowNodeOutput {
    const update = this.db.prepare(
      `UPDATE workflow_node_outputs
       SET status = 'completed', output_text = ?, output_task_ids = ?,
           output_file_refs = ?, control_result = ?, error = NULL, completed_at = ?
       WHERE project_id = ? AND run_id = ?`,
    ).run(
      result.outputText,
      JSON.stringify(result.outputTaskIds),
      JSON.stringify(result.outputFileRefs),
      result.controlResult ? JSON.stringify(result.controlResult) : null,
      Date.now(),
      projectId,
      runId,
    );
    if (update.changes !== 1) throw new Error('节点运行记录不存在');
    const output = this.getByRun(projectId, runId);
    if (!output) throw new Error('节点运行记录不存在');
    return output;
  }

  fail(projectId: string, runId: string, error: string): WorkflowNodeOutput {
    const update = this.db.prepare(
      `UPDATE workflow_node_outputs
       SET status = 'failed', error = ?, completed_at = ?
       WHERE project_id = ? AND run_id = ?`,
    ).run(error, Date.now(), projectId, runId);
    if (update.changes !== 1) throw new Error('节点运行记录不存在');
    const output = this.getByRun(projectId, runId);
    if (!output) throw new Error('节点运行记录不存在');
    return output;
  }

  getByRun(projectId: string, runId: string): WorkflowNodeOutput | null {
    const row = this.db.prepare(
      `SELECT * FROM workflow_node_outputs WHERE project_id = ? AND run_id = ?`,
    ).get(projectId, runId) as Record<string, unknown> | undefined;
    return row ? this.fromRow(row) : null;
  }

  findLatestCompleted(projectId: string, nodeId: string, iteration: number): WorkflowNodeOutput | null {
    const row = this.db.prepare(
      `SELECT * FROM workflow_node_outputs
       WHERE project_id = ? AND workflow_node_id = ? AND iteration = ? AND status = 'completed'
       ORDER BY completed_at DESC, created_at DESC LIMIT 1`,
    ).get(projectId, nodeId, iteration) as Record<string, unknown> | undefined;
    return row ? this.fromRow(row) : null;
  }

  listByProject(projectId: string): WorkflowNodeOutput[] {
    const rows = this.db.prepare(
      `SELECT * FROM workflow_node_outputs WHERE project_id = ? ORDER BY created_at ASC`,
    ).all(projectId) as Record<string, unknown>[];
    return rows.map((row) => this.fromRow(row));
  }

  private fromRow(row: Record<string, unknown>): WorkflowNodeOutput {
    if (
      typeof row.status !== 'string'
      || !STATUSES.has(row.status as WorkflowNodeRunStatus)
      || typeof row.id !== 'string'
      || typeof row.project_id !== 'string'
      || typeof row.workflow_node_id !== 'string'
      || typeof row.workflow_node_type !== 'string'
      || typeof row.run_id !== 'string'
      || !Number.isSafeInteger(row.iteration)
      || typeof row.output_text !== 'string'
      || !Number.isSafeInteger(row.created_at)
    ) {
      throw new Error('节点运行记录数据损坏');
    }
    const iteration = row.iteration as number;
    const createdAt = row.created_at as number;
    const completedAt = Number.isSafeInteger(row.completed_at)
      ? row.completed_at as number
      : undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      workflowNodeId: row.workflow_node_id,
      workflowNodeType: row.workflow_node_type as WorkflowNodeType,
      runId: row.run_id,
      iteration,
      status: row.status as WorkflowNodeRunStatus,
      inputSnapshot: parseInputSnapshot(row.input_snapshot),
      outputText: row.output_text,
      outputTaskIds: parseStringArray(row.output_task_ids, '节点输出任务引用'),
      outputFileRefs: parseStringArray(row.output_file_refs, '节点输出文件引用'),
      controlResult: parseControlResult(row.control_result),
      error: typeof row.error === 'string' ? row.error : undefined,
      createdAt,
      completedAt,
    };
  }
}
