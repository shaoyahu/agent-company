import { apiUrl } from '../runtime/runtimeConfig';

// 简化的 API client

export interface CompanyInfo {
  name: string;
  boss: string;
  providers: Array<{ id: string; type: string; model: string; endpoint?: string }>;
  agents: Agent[];
  departments?: Array<{ id: string; name: string; description?: string; head: string; teams?: string[] }>;
}

export interface Agent {
  id: string;
  name?: string;
  department: string;
  team?: string;
  role: 'head' | 'leader' | 'worker';
  llm: string;
  systemPrompt: string;
  tools: string[];
  skills?: string[];
  description?: string;
  avatar?: string;
  enabled: boolean;
  executor?: 'llm' | 'cli';
  cliTool?: string;
  cliModel?: string;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  boss: string;
  status: string;
  phase: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface Task {
  id: string;
  projectId: string;
  phase: string;
  department: string;
  assignee: string;
  title: string;
  prompt: string;
  status: string;
  outputFiles: string[];
  outputSummary?: string;
  attempts: number;
  cost: { inputTokens: number; outputTokens: number; durationMs: number };
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkflowNodeOutputInput {
  sourceNodeId: string;
  sourceRunId: string;
  sourceName: string;
  outputText: string;
  outputFileRefs: string[];
}

export interface WorkflowNodeOutput {
  id: string;
  projectId: string;
  workflowNodeId: string;
  workflowNodeType: WorkflowNode['type'];
  runId: string;
  iteration: number;
  status: 'running' | 'completed' | 'failed';
  inputSnapshot: WorkflowNodeOutputInput[];
  outputText: string;
  outputTaskIds: string[];
  outputFileRefs: string[];
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface WorkflowTaskTemplate {
  phase: string;
  department: string;
  assigneeHint: string;
  title: string;
  promptTemplate: string;
  dependsOn: string[];
  parallel?: boolean;
  guided?: WorkflowTaskTemplateGuidedConfig;
}

export interface WorkflowTaskTemplateGuidedConfig {
  taskType: 'frontend' | 'backend' | 'design' | 'test' | 'review' | 'custom';
  deliverables: string[];
  acceptanceCriteria: string[];
  promptMode?: 'generated' | 'custom';
}

export type WorkflowCondition = {
  type: 'llm_judgment';
  agentId: string;
  prompt: string;
  inputNodeIds: string[];
};

export type WorkflowLoopExitCondition = WorkflowCondition;

export interface WorkflowPosition {
  x: number;
  y: number;
}

type WorkflowNodeBase = {
  id: string;
  name?: string;
  description?: string;
  position?: WorkflowPosition;
};

export type WorkflowNode =
  | (WorkflowNodeBase & { type: 'start' })
  | (WorkflowNodeBase & {
      type: 'stage';
      stage: string;
      name?: string;
      description?: string;
      agentId: string;
      inputNodeIds: string[];
      prompt: string;
    })
  | (WorkflowNodeBase & {
      type: 'condition';
      name?: string;
      description?: string;
      inputNodeIds?: string[];
    })
  | (WorkflowNodeBase & {
      type: 'loop_start';
      loopId: string;
      maxIterations: 3 | 10 | 20 | 40 | 100 | null;
    })
  | (WorkflowNodeBase & {
      type: 'loop_end';
      loopId: string;
      startNodeId: string;
      name?: string;
      description?: string;
      inputNodeIds: string[];
      exitCondition: WorkflowLoopExitCondition;
    })
  | (WorkflowNodeBase & { type: 'end' });

type WorkflowEdgeBase = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type WorkflowEdge =
  | (WorkflowEdgeBase & { type: 'default' })
  | (WorkflowEdgeBase & { type: 'condition'; condition: WorkflowCondition })
  | (WorkflowEdgeBase & { type: 'loop_back' });

export interface WorkflowGraph {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  stages: string[];
  templates: Record<string, WorkflowTaskTemplate[]>;
  graph: WorkflowGraph;
  legacyCompatible: boolean;
  builtIn?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface WorkflowWriteInput {
  id: string;
  name: string;
  description?: string;
  graph: WorkflowGraph;
}

export interface Message {
  id: string;
  projectId?: string;
  taskId?: string;
  channel: string;
  fromId: string;
  fromName: string;
  fromRole?: string;
  content: string;
  type: 'message' | 'system' | 'agent' | 'tool' | 'thought';
  toolName?: string;
  mentions: string[];
  createdAt: number;
}

export type ConversationKind = 'direct' | 'group';
export type ConversationSenderType = 'human' | 'agent' | 'system';
export type ConversationPauseReason = 'manual' | 'limit' | 'scheduler';
export type ParticipantState =
  | 'idle'
  | 'cooling'
  | 'deciding'
  | 'speaking'
  | 'paused'
  | 'error';

export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string;
  avatar?: string;
  createdBy: string;
  agentMessageLimit: number;
  maxConsecutiveSpeeches: number;
  maxMessageChars: number;
  cooldownMs: number;
  paused: boolean;
  pauseReason?: ConversationPauseReason;
  pinned: boolean;
  muted: boolean;
  lastReadSequence: number;
  schedulerMode: 'none' | 'llm' | 'agent';
  schedulerLlm?: string;
  schedulerAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMember {
  conversationId: string;
  memberId: string;
  memberType: 'human' | 'agent';
  enabled: boolean;
  paused: boolean;
  joinedAt: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sequence: number;
  senderId: string;
  senderType: ConversationSenderType;
  content: string;
  mentions: string[];
  protectionBoundary?: 'discussion_limit_resume';
  createdAt: number;
}

export interface ConversationSummary extends Conversation {
  memberCount: number;
  unreadCount: number;
  lastMessage?: ConversationMessage;
}

export interface ConversationDetail extends Conversation {
  members: ConversationMember[];
}

export type ConversationSocketEvent =
  | {
      type: 'conversation_message';
      conversationId: string;
      message: ConversationMessage;
    }
  | {
      type: 'conversation_state';
      conversationId: string;
      agentId: string;
      state: ParticipantState;
      since: number;
    }
  | {
      type: 'conversation_updated';
      conversationId: string;
      }
    | {
        type: 'conversation_deleted';
        conversationId: string;
    };

export interface CreateConversationInput {
  kind: ConversationKind;
  title?: string;
  agentIds: string[];
  agentMessageLimit?: number;
  maxConsecutiveSpeeches?: number;
  maxMessageChars?: number;
  cooldownMs?: number;
  schedulerMode?: 'none' | 'llm' | 'agent';
  schedulerLlm?: string;
  schedulerAgentId?: string;
}

export interface UpdateConversationProfileInput {
  title: string;
  avatar?: string | null;
}

export interface DataRestoreResult {
  ok: true;
  backupPath: string;
  tableRows: Record<string, number>;
  skillCounts: { user: number; project: number };
}

export async function http(method: string, path: string, body?: unknown) {
  // 球球 bug fix:DELETE/PUT 等没 body 的请求不能设 Content-Type: application/json,
  // 否则 Fastify 报 "Body cannot be empty when content-type is set to 'application/json'"。
  // 只在 body 有值时设 header + 序列化。
  const hasBody = body !== undefined && body !== null;
  const res = await fetch(apiUrl(path), {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // 球球 review 2026-08-15:后端错因必须透出来,不然 toast 只能显示 "HTTP 400",
    // 球球看不到具体错因(像 "id must be alphanumeric/dash/underscore")。
    // 解析 { error: "..." } body,塞进 Error.message;同时把 status code 挂到 err.status。
    let message = `HTTP ${res.status}`;
    let errorBody: any = null;
    try {
      errorBody = await res.json();
      if (errorBody && typeof errorBody.error === 'string') {
        message = errorBody.error;
      } else if (errorBody && typeof errorBody.message === 'string') {
        message = errorBody.message;
      }
    } catch {
      // body 不是 JSON,保留默认 "HTTP 400"
    }
    const err = new Error(message) as Error & { status?: number; body?: any };
    err.status = res.status;
    err.body = errorBody;
    throw err;
  }
  return res.json();
}

async function httpBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  const hasBody = body !== undefined && body !== null;
  const res = await fetch(apiUrl(path), {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const errorBody = await res.json();
      if (errorBody && typeof errorBody.error === 'string') {
        message = errorBody.error;
      } else if (errorBody && typeof errorBody.message === 'string') {
        message = errorBody.message;
      }
    } catch {
      // body 不是 JSON,保留默认 "HTTP 400"
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.blob();
}

function conversationPath(id: string): string {
  return `/conversations/${encodeURIComponent(id)}`;
}

function projectPath(id: string): string {
  return `/projects/${encodeURIComponent(id)}`;
}

export const api = {
  company: () => http('GET', '/company') as Promise<CompanyInfo>,
  conversations: () =>
    http('GET', '/conversations') as Promise<ConversationSummary[]>,
  createConversation: (input: CreateConversationInput) =>
    http('POST', '/conversations', input) as Promise<ConversationDetail>,
  conversation: (id: string) =>
    http('GET', conversationPath(id)) as Promise<ConversationDetail>,
  updateConversationProfile: (id: string, input: UpdateConversationProfileInput) =>
    http('PATCH', conversationPath(id), input) as Promise<ConversationDetail>,
  deleteConversation: (id: string) =>
    http('DELETE', conversationPath(id)) as Promise<{ ok: true }>,
  pinConversation: (id: string) =>
    http('POST', `${conversationPath(id)}/pin`) as Promise<ConversationDetail>,
  unpinConversation: (id: string) =>
    http('POST', `${conversationPath(id)}/unpin`) as Promise<ConversationDetail>,
  muteConversation: (id: string) =>
    http('POST', `${conversationPath(id)}/mute`) as Promise<ConversationDetail>,
  unmuteConversation: (id: string) =>
    http('POST', `${conversationPath(id)}/unmute`) as Promise<ConversationDetail>,
  markConversationRead: (id: string) =>
    http('POST', `${conversationPath(id)}/read`) as Promise<ConversationDetail>,
  addConversationMember: (id: string, agentId: string) =>
    http('POST', `${conversationPath(id)}/members`, { agentId }) as Promise<ConversationMember>,
  removeConversationMember: (id: string, agentId: string) =>
    http(
      'DELETE',
      `${conversationPath(id)}/members/${encodeURIComponent(agentId)}`,
    ) as Promise<{ ok: true }>,
  conversationMessages: (
    id: string,
    options: { beforeSequence?: number; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.beforeSequence !== undefined) {
      query.set('beforeSequence', String(options.beforeSequence));
    }
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return http(
      'GET',
      `${conversationPath(id)}/messages${suffix}`,
    ) as Promise<ConversationMessage[]>;
  },
  sendConversationMessage: (id: string, content: string) =>
    http('POST', `${conversationPath(id)}/messages`, { content }) as Promise<ConversationMessage>,
  pauseConversation: (id: string) =>
    http('POST', `${conversationPath(id)}/pause`) as Promise<Conversation>,
  resumeConversation: (id: string) =>
    http('POST', `${conversationPath(id)}/resume`) as Promise<Conversation>,
  pauseConversationAgent: (id: string, agentId: string) =>
    http(
      'POST',
      `${conversationPath(id)}/members/${encodeURIComponent(agentId)}/pause`,
    ) as Promise<ConversationMember>,
  resumeConversationAgent: (id: string, agentId: string) =>
    http(
      'POST',
      `${conversationPath(id)}/members/${encodeURIComponent(agentId)}/resume`,
    ) as Promise<ConversationMember>,
  projects: () => http('GET', '/projects') as Promise<Project[]>,
  project: (id: string) =>
    http('GET', projectPath(id)) as Promise<{
      project: Project;
      tasks: Task[];
      messages: Message[];
      workflowNodeOutputs: WorkflowNodeOutput[];
    }>,
  createProject: (data: {
    title: string;
    description?: string;
    initialMessage?: string;
    projectDir?: string;     // 球球 review 2026-08-16:本地文件夹路径(白名单:home 或 tmp)
    /** 球球 review 2026-08-16:选 agent 不是选 model — agent 用自己配的 llm */
    agentId?: string;
    mode?: 'creative' | 'solo';
      workflowId?: string;
    llmId?: string;          // (deprecated) — 改用 agentId
    initialTasks?: any[];
    /**
     * 球球 review 2026-08-16:ChatInputBox 思考开关真接 — 存到 project.metadata.thinking
     * server 端 AgentRuntime.buildSystemPrompt 会读这个值,影响 LLM 是否做 CoT
     */
    thinking?: boolean;
    /**
     * 球球 review 2026-08-16:ChatInputBox 授权开关真接 — 存到 project.metadata.autoApprove
     * 'always' = 危险工具(bash/write/edit/web_fetch)直接跑
     * 'never'  = 危险工具直接返"老板拒绝"错误
     * 'prompt' = MVP 简化为 always 跑,文案说明
     */
    autoApprove?: 'always' | 'never' | 'prompt';
    attachments?: Array<{ name: string; size: number; contentBase64: string }>;
  }) => http('POST', '/projects', data) as Promise<Project>,
    workflows: () =>
      http('GET', '/workflows') as Promise<{ workflows: WorkflowDefinition[] }>,
    upsertWorkflow: (data: WorkflowWriteInput) =>
      http('POST', '/workflows', {
        id: data.id,
        name: data.name,
        description: data.description,
        graph: data.graph,
      }) as Promise<{ workflow: WorkflowDefinition }>,
    deleteWorkflow: (id: string) => http('DELETE', `/workflows/${encodeURIComponent(id)}`),
  deleteProject: (id: string) => http('DELETE', projectPath(id)),
  // 球球 review 2026-08-16:文件浏览器 — 列出 home 下的候选根目录(白名单,不允许任意路径)
  homeDirs: () =>
    http('GET', '/fs/home-dirs') as Promise<{
      home: string;
      dirs: Array<{ key: string; label: string; path: string; writable: boolean }>;
      tmp: string;
    }>,
  validateDir: (data: { path: string }) =>
    http('POST', '/fs/validate-dir', data) as Promise<{
      path: string;
      exists: true;
      writable: boolean;
    }>,
    tick: (id: string) => http('POST', `${projectPath(id)}/tick`) as Promise<Project>,
    say: (id: string, content: string, options?: {
      attachments?: Array<{ name: string; size: number; contentBase64: string }>;
    }) =>
      http('POST', `${projectPath(id)}/say`, {
        content,
        ...(options?.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
      }) as Promise<Message>,
  agentStatuses: () => http('GET', '/agents/status') as Promise<Array<{
    agentId: string;
    status: 'idle' | 'busy' | 'offline';
    currentTaskId?: string;
    lastActiveAt: number;
  }>>,
  providers: () =>
    http('GET', '/providers') as Promise<{
      providers: Array<{ id: string; type: string; model: string; source: string; enabled: boolean }>;
    }>,
  // 球球 review HIGH:LLMSettings / AgentsView 之前直接 fetch 不 catch res.ok,
  // 后端 400 时前端以为成功。这里走 http() helper,失败必 throw。
  // 球球 review 2026-08-15:apiKey 改成可选 — 编辑现有 provider 时不填就不传,
  // server 端 { ...existing, ...body } 会保留原 key。
  upsertProvider: (data: {
    id: string;
    type: 'anthropic' | 'openai';
    apiKey?: string;
    endpoint?: string;
    path?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    enabled?: boolean;
  }) => http('POST', '/providers', data),
  deleteProvider: (id: string) => http('DELETE', `/providers/${id}`),
  testProvider: (id: string) =>
    http('POST', `/providers/${id}/test`, {}) as Promise<{
      success: boolean;
      response?: string;
      model?: string;
      tokens?: { inputTokens: number; outputTokens: number };
      durationMs?: number;
      errorMessage?: string;
    }>,
  departments: () => http('GET', '/departments') as Promise<{
    active: Array<{ id: string; name: string; description?: string; head: string; teams?: string[] }>;
    db: Array<{ id: string; name: string; description?: string; head: string; teams?: string[]; source: string }>;
    yamlIds: string[];
  }>,
  agents: () => http('GET', '/agents') as Promise<{
    active: Agent[];
    db: Agent[];
    yamlIds: string[];
  }>,

  // ─── Tools (内置 + 自定义) ───
  tools: () =>
    http('GET', '/tools') as Promise<{
      builtin: Array<{ name: string; description: string; inputSchema: any }>;
      custom: Array<{
        id: string;
        name: string;
        type: 'http' | 'shell' | 'prompt' | 'cli';
        description: string;
        config: any;
        enabled: boolean;
        createdAt: number;
        updatedAt: number;
      }>;
    }>,
  cliTools: () =>
    http('GET', '/cli-tools') as Promise<{
      tools: Array<{
        name: string;
        command: string;
        available: boolean;
        modelsConfigured: boolean;
        error?: string;
      }>;
    }>,
  discoveredCliTools: () =>
    http('GET', '/cli-tools/discovered') as Promise<{
      tools: Array<{
        id: string;
        label: string;
        executable: string;
        path: string;
        preset: 'trae' | null;
      }>;
    }>,
  cliModels: (name: string, data: { refresh?: boolean } = {}) =>
    http('POST', `/cli-tools/${encodeURIComponent(name)}/models`, data) as Promise<{
      available: boolean;
      models: string[];
      cached: boolean;
    }>,
  upsertTool: (data: any) =>
    http('POST', '/tools', data) as Promise<any>,
  deleteTool: (id: string) =>
    http('DELETE', `/tools/${id}`) as Promise<{ ok: boolean }>,
  testTool: (data: { type: string; config: any; input?: Record<string, unknown> }) =>
    http('POST', '/tools/test', data) as Promise<{ success: boolean; output: string }>,

  // ─── Skills ───
  skills: () =>
    http('GET', '/skills') as Promise<{
      installed: Array<{
        name: string;
        description: string;
        source: 'project' | 'user' | 'hub';
        path: string;
        extraFiles: number;
      }>;
      hub: Array<{
        name: string;
        displayName?: string;
        description: string;
        sourceUrl?: string;
        installed: boolean;
      }>;
    }>,
  skill: (name: string) =>
    http('GET', `/skills/${encodeURIComponent(name)}`) as Promise<{
      name: string;
      description: string;
      source: string;
      body: string;
    }>,
  installSkill: (data: {
    source: 'url' | 'upload' | 'hub' | 'content';
    url?: string;
    fileBase64?: string;
    filename?: string;
    content?: string;
    name?: string;
  }) => http('POST', '/skills/install', data) as Promise<{ ok: boolean; name: string; source: string }>,
  uninstallSkill: (name: string) =>
    http('DELETE', `/skills/${encodeURIComponent(name)}`) as Promise<{ ok: boolean; removed: string }>,

  // ─── Agents / Departments / Templates (Web → 设置 → 部门 / 职员) ───
  // 球球 review HIGH:AgentsView handleDeleteAgent 之前 fetch 不 check res.ok,
  // 失败也 toast "已删除"。改走 http() helper 统一 throw/return。
  upsertAgent: (data: any) => http('POST', '/agents', data),
  deleteAgent: (id: string) =>
    http('DELETE', `/agents/${id}`) as Promise<{ ok: boolean }>,
  // 多轮对话 — UI 上点 agent 详情里 '对话' 按钮
  chatAgent: (id: string, data: {
    messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; toolCalls?: any[] }>;
    systemPrompt?: string;
  }) =>
    http('POST', `/agents/${id}/chat`, data) as Promise<{
      success: boolean;
      text?: string;
      toolCalls?: Array<{ name: string; input: any; output: string }>;
      usage?: { inputTokens: number; outputTokens: number };
      durationMs: number;
      stopReason?: string;
      executor: 'llm' | 'cli';
      command?: string;
      args?: string[];
      exitCode?: number | null;
      error?: string;
      /**
       * 球球 review 2026-08-16:CLI tool 走 OAuth/SSO 时,spawn 期间会打印
       * https://... 链接让用户去授权。前端拿到这个 URL 弹 toast 提示 + 提供可点链接。
       */
      oauthUrl?: string;
    }>,
  upsertDepartment: (data: any) => http('POST', '/departments', data),
  deleteDepartment: (id: string) =>
    http('DELETE', `/departments/${id}`) as Promise<{ ok: boolean }>,
  applyTemplate: (data: { template: any; llmOverride?: string }) =>
    http('POST', '/templates/apply', data),

  // ─── Settings Helper(设置页里的对话框) ───
  settingsMetaTools: () =>
    http('GET', '/settings/meta-tools') as Promise<{
      tools: Array<{ name: string; description: string }>;
    }>,
  settingsChat: (data: {
    tab: 'tools' | 'skills';
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    llmId?: string;
  }) =>
    http('POST', '/settings/chat', data) as Promise<{
      ok: boolean;
      reply: string;
      toolCalls: Array<{ name: string; input: any; result: { success: boolean; output: string; data?: any } }>;
      usage: { inputTokens: number; outputTokens: number };
      llmId: string;
    }>,

  // ─── Data Backup / Restore(设置 → 数据) ───
  exportData: () => httpBlob('GET', '/data/export'),
  importData: (data: { fileBase64: string; filename?: string }) =>
    http('POST', '/data/import', data) as Promise<DataRestoreResult>,
  resetData: () =>
    http('POST', '/data/reset', { confirm: 'RESET_AGENT_COMPANY' }) as Promise<DataRestoreResult>,

  // UI 设置(密度/字号/圆角)改 localStorage 持久化,见 hooks/useUISettings.ts
  // 不再走 db — 个人浏览器偏好,不是系统配置
};
