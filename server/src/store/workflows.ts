import type Database from 'better-sqlite3';
import { getDB } from './db.js';
import { DEFAULT_WORKFLOW } from '../orchestrator/templates.js';
import type { WorkflowDefinition, WorkflowTaskTemplate } from '../types/company.js';
import { linearWorkflowToGraph, normalizeWorkflowGraph, validateWorkflowGraph } from '../workflows/graph.js';
import type { WorkflowGraph } from '../workflows/model.js';

type WorkflowInput = Pick<WorkflowDefinition, 'id' | 'name' | 'description'> & {
  graph: WorkflowGraph;
};

type LegacyProjection = {
  stages: string[];
  templates: Record<string, WorkflowTaskTemplate[]>;
  legacyCompatible: boolean;
};

function parseLegacyJson(value: unknown, field: 'stages' | 'templates', workflowId: string): unknown {
  if (typeof value !== 'string') {
    throw new Error(`流程“${workflowId}”的旧 ${field} 数据损坏：必须是 JSON 字符串`);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`流程“${workflowId}”的旧 ${field} JSON 解析失败`);
  }
}

function parseLegacyFields(
  stagesValue: unknown,
  templatesValue: unknown,
  workflowId: string,
): Pick<LegacyProjection, 'stages' | 'templates'> {
  const stages = parseLegacyJson(stagesValue, 'stages', workflowId);
  if (!Array.isArray(stages)) {
    throw new Error(`流程“${workflowId}”的旧 stages 数据损坏：必须是数组`);
  }
  const templates = parseLegacyJson(templatesValue, 'templates', workflowId);
  if (
    typeof templates !== 'object' ||
    templates === null ||
    Array.isArray(templates)
  ) {
    throw new Error(`流程“${workflowId}”的旧 templates 数据损坏：必须是对象`);
  }
  return {
    stages: stages as string[],
    templates: templates as Record<string, WorkflowTaskTemplate[]>,
  };
}

function assertWorkflow(input: WorkflowInput): void {
  if (typeof input.id !== 'string' || !input.id.trim()) throw new Error('流程 id 必填');
  if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) throw new Error('流程 id 只能包含字母、数字、下划线和短横线');
  if (input.id === DEFAULT_WORKFLOW.id) throw new Error('内置流程不能覆盖');
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('流程名称必填');
  validateWorkflowGraph(input.graph);
}

function incompatibleLegacyProjection(): LegacyProjection {
  return {
    stages: [],
    templates: {},
    legacyCompatible: false,
  };
}

function graphToLegacyFields(graph: WorkflowGraph): LegacyProjection {
  if (
    graph.nodes.some((node) => (
      node.type !== 'start' &&
      node.type !== 'stage' &&
      node.type !== 'end'
    )) ||
    graph.edges.some((edge) => edge.type !== 'default')
  ) {
    return incompatibleLegacyProjection();
  }

  const start = graph.nodes.find((node) => node.type === 'start');
  if (!start) return incompatibleLegacyProjection();

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoingBySource = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const outgoing = outgoingBySource.get(edge.source) ?? [];
    outgoing.push(edge);
    outgoingBySource.set(edge.source, outgoing);
  }

  const stages: string[] = [];
  const templates: Record<string, WorkflowTaskTemplate[]> = {};
  const stageNames = new Set<string>();
  const visited = new Set<string>();
  let current: WorkflowGraph['nodes'][number] = start;

  while (current.type !== 'end') {
    if (visited.has(current.id)) return incompatibleLegacyProjection();
    visited.add(current.id);
    if (current.type === 'stage') {
      if (stageNames.has(current.stage)) return incompatibleLegacyProjection();
      stageNames.add(current.stage);
      stages.push(current.stage);
      Object.defineProperty(templates, current.stage, {
        value: [],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    const outgoing = outgoingBySource.get(current.id) ?? [];
    if (outgoing.length !== 1) return incompatibleLegacyProjection();
    const next = nodesById.get(outgoing[0]!.target);
    if (!next) return incompatibleLegacyProjection();
    current = next;
  }

  if (visited.has(current.id)) return incompatibleLegacyProjection();
  visited.add(current.id);
  if (
    (outgoingBySource.get(current.id) ?? []).length !== 0 ||
    visited.size !== graph.nodes.length
  ) {
    return incompatibleLegacyProjection();
  }

  return {
    stages,
    templates,
    legacyCompatible: true,
  };
}

function parseGraph(value: string, workflowId: string): WorkflowGraph {
  let graph: unknown;
  try {
    graph = JSON.parse(value);
  } catch {
    throw new Error(`流程“${workflowId}”的流程图 JSON 解析失败`);
  }
  return normalizeWorkflowGraph(graph);
}

export class WorkflowRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  list(): WorkflowDefinition[] {
    const rows = this.db.prepare(`SELECT * FROM workflows ORDER BY updated_at DESC`).all() as any[];
    return [DEFAULT_WORKFLOW, ...rows.map((r) => this.fromRow(r))];
  }

  get(id: string): WorkflowDefinition | null {
    if (id === DEFAULT_WORKFLOW.id) return DEFAULT_WORKFLOW;
    const row = this.db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as any;
    return row ? this.fromRow(row) : null;
  }

  upsert(input: WorkflowInput): WorkflowDefinition {
    assertWorkflow(input);
    const existing = this.db.prepare(
      `SELECT created_at FROM workflows WHERE id = ?`,
    ).get(input.id) as { created_at: number } | undefined;
    const now = Date.now();
    const legacy = graphToLegacyFields(input.graph);
    const workflow: WorkflowDefinition = {
      ...input,
      ...legacy,
      builtIn: false,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };
    this.db.prepare(
      `INSERT INTO workflows (id, name, description, stages, templates, graph, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         stages = excluded.stages,
         templates = excluded.templates,
         graph = excluded.graph,
         updated_at = excluded.updated_at`,
    ).run(
      workflow.id,
      workflow.name,
      workflow.description ?? null,
      JSON.stringify(workflow.stages),
      JSON.stringify(workflow.templates),
      JSON.stringify(workflow.graph),
      workflow.createdAt,
      workflow.updatedAt,
    );
    return workflow;
  }

  delete(id: string): boolean {
    if (id === DEFAULT_WORKFLOW.id) throw new Error('内置流程不能删除');
    const result = this.db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  private fromRow(row: any): WorkflowDefinition {
    const workflowId = String(row.id);
    const usesLegacyFields = (
      row.graph === null ||
      (typeof row.graph === 'string' && row.graph.trim().length === 0)
    );
    if (!usesLegacyFields && typeof row.graph !== 'string') {
      throw new Error(`流程“${workflowId}”的 graph 字段损坏：必须是 JSON 字符串`);
    }

    let graph: WorkflowGraph;
    let legacy: LegacyProjection;
    if (usesLegacyFields) {
      const fields = parseLegacyFields(row.stages, row.templates, workflowId);
      graph = linearWorkflowToGraph(fields.stages, fields.templates);
      legacy = { ...fields, legacyCompatible: true };
    } else {
      graph = parseGraph(row.graph, workflowId);
      legacy = graphToLegacyFields(graph);
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      ...legacy,
      graph,
      builtIn: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
