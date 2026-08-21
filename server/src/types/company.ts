/**
 * Company 组织配置类型定义
 * 对应 company.yaml
 */

export type AgentRole = 'head' | 'leader' | 'worker';
export type AgentStatus = 'idle' | 'busy' | 'offline';

export interface AgentConfig {
  id: string;
  name: string;
  department: string;
  /** 部门下的 team(可选) */
  team?: string;
  role: AgentRole;
  /** 引用的 llm provider id */
  llm: string;
  systemPrompt: string;
  tools: string[];
  skills?: string[];
  /** 同时能处理的任务数 */
  maxConcurrent?: number;
  /** 描述(可选) */
  description?: string;
  /** 头像 emoji(可选) */
  avatar?: string;
  /** false 时不参与会话调度 */
  enabled?: boolean;
  /**
   * 执行器类型:
   *   - 'llm' (默认): 走 chat loop,调 LLM provider
   *   - 'cli':        跳过 LLM,直接 spawn 本地 CLI(claude code / trae cli),模型由 CLI 决定
   */
  executor?: 'llm' | 'cli';
  /** executor='cli' 时,引用 custom_tools 表里 type=cli 的工具名 */
  cliTool?: string;
  /** executor='cli' 时必须显式选择的 CLI 模型 */
  cliModel?: string;
}

export interface DepartmentConfig {
  id: string;
  name: string;
  description?: string;
  /** 部门负责人 agent id */
  head: string;
  /** 部门下的 team(可选) */
  teams?: string[];
  /** 父部门 id(用于层级架构)。顶级部门为 undefined。 */
  parentId?: string;
}

export interface CompanyConfig {
  name: string;
  description?: string;
  boss: string;
  departments: DepartmentConfig[];
  agents: AgentConfig[];
  llm_providers: import('../llm/registry.js').ProviderConfig[];
}

export interface WorkflowTaskTemplate {
  phase: string;
  department: string;
  assigneeHint: string;
  title: string;
  promptTemplate: string;
  dependsOn: string[];
  parallel?: boolean;
  guided?: {
    taskType: 'frontend' | 'backend' | 'design' | 'test' | 'review' | 'custom';
    deliverables: string[];
    acceptanceCriteria: string[];
    promptMode?: 'generated' | 'custom';
  };
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  stages: string[];
  templates: Record<string, WorkflowTaskTemplate[]>;
  graph: import('../workflows/model.js').WorkflowGraph;
  legacyCompatible: boolean;
  builtIn?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type WorkflowNodeRunStatus = 'running' | 'completed' | 'failed';

export interface WorkflowNodeOutputInput {
  sourceNodeId: string;
  sourceRunId: string;
  sourceName: string;
  outputText: string;
  outputFileRefs: string[];
}

export type WorkflowNodeControlResult =
  | { type: 'condition'; matched: boolean }
  | { type: 'loop'; action: 'continue' | 'end' };

export interface WorkflowNodeOutput {
  id: string;
  projectId: string;
  workflowNodeId: string;
  workflowNodeType: import('../workflows/model.js').WorkflowNodeType;
  runId: string;
  iteration: number;
  status: WorkflowNodeRunStatus;
  inputSnapshot: WorkflowNodeOutputInput[];
  outputText: string;
  outputTaskIds: string[];
  outputFileRefs: string[];
  controlResult?: WorkflowNodeControlResult;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface WorkflowNodeRun {
  runId: string;
  nodeId: string;
  nodeType: import('../workflows/model.js').WorkflowNodeType;
  iteration?: number;
  status: WorkflowNodeRunStatus;
  startedAt: number;
  completedAt?: number;
  outputRefs?: string[];
  reason?: string;
  error?: string;
}

export interface SchedulerDecisionRecord {
  runId: string;
  nodeId: string;
  providerId: string;
  decision: 'approved' | 'rejected';
  reason: string;
  decidedAt: number;
}

export interface WorkflowRuntimeState {
  currentNodeId: string;
  currentIteration: number;
  currentRunId?: string;
  error?: string;
  loopContext?: import('../workflows/model.js').WorkflowConditionContext;
  nodeRuns: WorkflowNodeRun[];
  loopCounts: Record<string, number>;
  schedulerDecisions: SchedulerDecisionRecord[];
}

/**
 * 项目配置 - 运行时
 */
export type ProjectStatus =
  | 'idea'
  | 'prd'
  | 'design'
  | 'dev'
  | 'qa'
  | 'delivery'
  | 'done'
  | 'failed';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked';

export interface Project {
  id: string;
  title: string;
  description?: string;
  boss: string;
  status: ProjectStatus;
  phase: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface Task {
  id: string;
  projectId: string;
  phase: string;
  workflowNodeId?: string;
  workflowIteration: number;
  department: string;
  assignee: string; // agent id
  title: string;
  prompt: string;
  status: TaskStatus;
  inputFiles: string[];
  outputFiles: string[];
  outputSummary?: string;
  dependsOn: string[]; // task ids
  attempts: number;
  maxAttempts: number;
  cost: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface Deliverable {
  id: string;
  projectId: string;
  taskId: string;
  type: 'prd' | 'design' | 'code' | 'test' | 'doc' | 'video' | 'audio' | 'image' | 'other';
  path: string;
  mimeType?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  projectId?: string;
  taskId?: string;
  channel: string; // 'general' / 'boss' / 'dm:agent-id' ...
  fromId: string; // 'boss' | agent id
  fromName: string;
  fromRole?: string;
  content: string;
  type: 'message' | 'system' | 'tool' | 'thought' | 'agent';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  mentions: string[];
  createdAt: number;
}
