import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { accessSync, constants, existsSync } from 'node:fs';
import type { Orchestrator } from '../orchestrator/index.js';
import type { LLMRegistry } from '../llm/registry.js';
import { MessageRepo, ProjectRepo } from '../store/repository.js';
import { WorkflowNodeOutputRepo } from '../store/workflowNodeOutputs.js';
import { ConversationRepo } from '../store/conversations.js';
import { ProviderRepo, type StoredProvider } from '../store/providers.js';
import { ConfigService } from '../store/config-merge.js';
import { DepartmentRepo, AgentRepo } from '../store/org.js';
import { WorkflowRepo } from '../store/workflows.js';
import { findUnavailableWorkflowAgent, workflowAgentAvailable } from '../workflows/providerScan.js';
import { tools as builtinTools } from '../agent/tools.js';
import { CustomToolRepo, type CustomToolType } from '../store/customTools.js';
import { reloadCustomTools, testCustomTool } from '../agent/customTools.js';
import { discoverCliModels } from '../agent/cliModels.js';
import { discoverInstalledClis } from '../agent/cliDiscovery.js';
import { validateAgentRequiredFields } from './agentValidation.js';
import { validateProjectDir } from './projectDirectory.js';
import { saveProjectAttachments, type ProjectAttachmentPayload } from './projectAttachments.js';
import {
  listSkills,
  getSkill,
  installFromUrl,
  installFromUpload,
  installFromContent,
  uninstallSkill,
  listHub,
} from '../skills/scanner.js';
import { randomUUID } from 'node:crypto';
import { runHelperAgent, listMetaTools } from '../agent/helperAgent.js';
import {
  executeAgentChat,
  type AgentChatExecutionDeps,
} from '../agent/agentChat.js';
import type { LLMMessage } from '../llm/types.js';
import type { AgentConfig, DepartmentConfig } from '../types/company.js';
import { registerConversationRoutes } from './conversations.js';
import { exportBackup, importBackup, resetData } from './dataBackup.js';
import { generateDirectReply } from '../conversations/directReply.js';
import { createAgentSpeaker } from '../conversations/agentSpeaker.js';
import { ConversationRuntimeManager } from '../conversations/runtime.js';
import { createConversationScheduler } from '../conversations/scheduler.js';

export interface ServerDeps {
  orchestrator: Orchestrator;
  llmRegistry: LLMRegistry;
  companyRoot: string;
  bossName: string;
  providerRepo: ProviderRepo;
  configService: ConfigService;
}

export interface ServerListenOptions {
  host?: string;
  port?: number;
}

export async function createServer(deps: ServerDeps, options: ServerListenOptions = {}): Promise<{
  app: FastifyInstance;
  wss: WebSocketServer;
  port: number;
}> {
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    },
  });

  async function validateCliAgent(agent: AgentConfig): Promise<string | undefined> {
    if ((agent.executor ?? 'llm') !== 'cli') return undefined;
    if (!agent.cliTool) return 'CLI Agent 必须选择 CLI 工具';
    if (!agent.cliModel?.trim()) return 'CLI Agent 必须选择 CLI 模型';
    const tool = new CustomToolRepo().getByName(agent.cliTool);
    if (!tool) return `CLI '${agent.cliTool}' 不存在`;
    const result = await discoverCliModels(tool);
    if (!result.available) return result.error ?? `CLI '${agent.cliTool}' 不可用`;
    if (!result.models.includes(agent.cliModel)) {
      return `Agent '${agent.id}' 选择的 CLI 模型 '${agent.cliModel}' 当前不可用`;
    }
    return undefined;
  }

  function formatCliFailureForUser(exitCode: number | null, output: string): string {
    const prefix = exitCode === null
      ? 'CLI 执行失败'
      : `CLI 执行失败（exit ${exitCode}）`;
    const suffix = '完整输出已记录到 Server 日志。';
    const normalized = output
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/^exit \d+\s*/i, '')
      .trim();
    const detailLimit = 500;
    const detail = normalized.length > detailLimit
      ? `...\n${normalized.slice(-detailLimit).trimStart()}`
      : normalized;
    return [prefix, detail, suffix].filter(Boolean).join('\n');
  }

  async function executeCliAgentOnce(
    agent: AgentConfig,
    prompt: string,
    phase: 'test' | 'chat',
    projectDir?: string,
  ): Promise<{
    validationError?: string;
    response?: {
      success: boolean;
      text: string;
      executor: 'cli';
      command: string;
      args: string[];
      exitCode: number | null;
      durationMs: number;
      oauthUrl?: string;
      error?: string;
    };
  }> {
    const validationError = await validateCliAgent(agent);
    if (validationError) return { validationError };

    const start = Date.now();
    const { runCliAgent } = await import('../agent/cliExecutor.js');
    const cliResult = await runCliAgent({
      agent,
      task: {
        id: `${phase}-${randomUUID()}`,
        projectId: '',
        phase,
        workflowIteration: 0,
        department: agent.department,
        assignee: agent.id,
        title: prompt.slice(0, 80),
        prompt,
        status: 'running',
        inputFiles: [],
        outputFiles: [],
        dependsOn: [],
        attempts: 0,
        maxAttempts: 1,
        cost: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
        createdAt: start,
      },
      promptOverride: prompt,
        ...(projectDir ? { projectDir } : {}),
    });
      if (!cliResult.success) {
        console.error(
          `[cliExecutor] Agent '${agent.id}' 执行失败`
          + `${cliResult.exitCode === null ? '' : `（exit ${cliResult.exitCode}）`}\n`
          + cliResult.output,
        );
      }

    return {
      response: {
        success: cliResult.success,
        text: cliResult.output,
        executor: 'cli',
        command: cliResult.command,
        args: cliResult.args,
        exitCode: cliResult.exitCode,
        durationMs: cliResult.durationMs,
        oauthUrl: cliResult.oauthUrl,
        error: cliResult.success
          ? undefined
            : formatCliFailureForUser(cliResult.exitCode, cliResult.output),
      },
    };
  }

  const agentChatExecutionDeps: AgentChatExecutionDeps = {
    companyRoot: deps.companyRoot,
    getProvider: (id) => deps.llmRegistry.get(id),
    executeCliAgentOnce,
  };

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<any>();

  const messageRepo = new MessageRepo();
  const workflowNodeOutputRepo = new WorkflowNodeOutputRepo();
  const projectRepo = new ProjectRepo();
  const workflowRepo = new WorkflowRepo();
  const conversationRepo = new ConversationRepo();
  const generateConversationDirectReply = (
    conversation: Parameters<typeof generateDirectReply>[0],
    agentId: string,
  ) => generateDirectReply(
    conversation,
    agentId,
    {
      getAgent: (id) => deps.configService.agents().find((agent) => agent.id === id),
      getHistory: (conversationId, limit) =>
        conversationRepo.listMessages(conversationId, { limit }),
      executeAgent: async (agent, messages) => {
        const result = await executeAgentChat(agent, messages, agentChatExecutionDeps);
        if (result.requestError) throw new Error(result.requestError);
        if (!result.response?.success) {
          throw new Error(result.response?.error ?? `Agent '${agent.id}' 回复失败`);
        }
        return result.response.text ?? '';
      },
    },
  );
  const conversationRuntime = new ConversationRuntimeManager(
    conversationRepo,
    createAgentSpeaker(agentChatExecutionDeps),
    () => deps.configService.agents(),
    {
      message: (message) => {
        broadcast({
          type: 'conversation_message',
          conversationId: message.conversationId,
          message,
        });
      },
      state: (event) => {
        broadcast({
          type: 'conversation_state',
          ...event,
        });
      },
      updated: (conversationId) => {
        broadcast({
          type: 'conversation_updated',
          conversationId,
        });
      },
    },
    undefined,
    generateConversationDirectReply,
    createConversationScheduler(agentChatExecutionDeps, () => deps.configService.agents()),
  );
  conversationRuntime.start();
  app.addHook('onClose', async () => {
    conversationRuntime.stop();
  });

  function projectDirectoryFor(projectId: string, metadata: Record<string, unknown>): string {
    const configured = metadata.projectDir;
    return typeof configured === 'string' && configured.trim()
      ? configured
      : join(deps.companyRoot, 'projects', projectId);
  }

  function toPlainText(content: LLMMessage['content']): string {
    if (typeof content === 'string') return content;
    return (content as any[]).map((block: any) => block?.text ?? '').join('');
  }

  function recentProjectChatMessages(projectId: string): LLMMessage[] {
    return messageRepo
      .listByProject(projectId, 12)
      .filter(m => m.fromId === 'boss' || m.type === 'agent')
      .map((m) => ({
        role: m.fromId === 'boss' ? 'user' : 'assistant',
        content: m.content,
      }));
  }

  function appendInputFilesToLatestUserMessage(messages: LLMMessage[], inputFiles: string[]): LLMMessage[] {
    if (inputFiles.length === 0) return messages;
    const index = messages.map(m => m.role).lastIndexOf('user');
    if (index < 0) return messages;
    const fileList = `\n\n# 输入文件\n${inputFiles.map(f => `- ${f}`).join('\n')}`;
    return messages.map((message, i) => {
      if (i !== index) return message;
      return {
        ...message,
        content: `${toPlainText(message.content)}${fileList}`,
      };
    });
  }

  async function replyInSoloProject(
    projectId: string,
    agent: AgentConfig,
    inputFiles: string[] = [],
  ): Promise<ReturnType<MessageRepo['create']>> {
    const project = deps.orchestrator.getProject(projectId);
    if (!project) throw new Error('Project not found');

    if ((agent.executor ?? 'llm') === 'cli') {
      const historyCtx = appendInputFilesToLatestUserMessage(recentProjectChatMessages(projectId), inputFiles)
        .map(m => `[${m.role}] ${toPlainText(m.content)}`)
        .join('\n');
      const result = await executeCliAgentOnce(agent, historyCtx, 'chat', projectDirectoryFor(projectId, project.metadata));
      if (result.validationError) throw new Error(result.validationError);
      if (!result.response?.success) {
        throw new Error(result.response?.error ?? 'CLI Agent 回复失败');
      }
      return messageRepo.create({
        id: randomUUID(),
        projectId,
        channel: 'general',
        fromId: agent.id,
        fromName: agent.name ?? agent.id,
        fromRole: `${agent.department} · ${agent.role}`,
        content: result.response.text,
        type: 'agent',
        mentions: [],
      });
    }

    const provider = deps.llmRegistry.get(agent.llm);
    if (!provider) throw new Error(`LLM '${agent.llm}' not available`);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `${agent.systemPrompt || ''}\n\n当前项目是 SOLO 模式。你是唯一参与该项目的 Agent,需要在项目上下文中持续对话开发。`,
      },
      ...appendInputFilesToLatestUserMessage(recentProjectChatMessages(projectId), inputFiles),
    ];
    const tools = builtinTools.listForNames(agent.tools);
    const ctx: any = {
      cwd: projectDirectoryFor(projectId, project.metadata),
      companyRoot: deps.companyRoot,
      agentId: agent.id,
      taskId: `solo-${randomUUID()}`,
    };
    let replyText = '';
    for (let i = 0; i < 5; i++) {
      const response = await provider.chat({
        messages,
        tools,
        maxTokens: 2000,
        temperature: 0.7,
      });
      replyText = response.text;
      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });
      if (response.toolCalls.length === 0 || response.stopReason === 'end_turn') break;
      for (const tc of response.toolCalls) {
        const handler = builtinTools.get(tc.name);
        let resultStr = '';
        if (!handler) {
          resultStr = `Unknown tool: ${tc.name}`;
        } else {
          try {
            const result = await handler(tc.input, ctx);
            resultStr = (result.output ?? '').toString();
          } catch (error) {
            resultStr = `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        messages.push({ role: 'tool', toolCallId: tc.id, content: resultStr });
      }
    }

    return messageRepo.create({
      id: randomUUID(),
      projectId,
      channel: 'general',
      fromId: agent.id,
      fromName: agent.name ?? agent.id,
      fromRole: `${agent.department} · ${agent.role}`,
      content: replyText,
      type: 'agent',
      mentions: [],
    });
  }

  // ─── CORS ───
  // 球球 review C3: 默认只允许 localhost:5173(球球日常用 Vite dev),
  // 通过 CORS_ORIGINS env 配 allowlist(逗号分隔)。
  // 部署到 LAN/公网时必须显式配,不允许 `*`(避免 CSRF)。
  const defaultOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS ?? defaultOrigins.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'true');
    }
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  });

  app.options('/*', async (_, reply) => reply.code(204).send());

  // ─── REST API ───

  registerConversationRoutes(app, {
    repo: conversationRepo,
    getAgents: () => deps.configService.agents(),
    hasProvider: (id) => Boolean(deps.llmRegistry.get(id)),
    bossName: deps.bossName,
    onMessage: (message) => {
      broadcast({
        type: 'conversation_message',
        conversationId: message.conversationId,
        message,
      });
    },
    notifyMessage: (conversationId) => {
      conversationRuntime.notifyMessage(conversationId);
    },
    notifyMembershipChanged: (conversationId) => {
      conversationRuntime.notifyMembershipChanged(conversationId);
    },
    pauseConversation: (conversationId) => {
      conversationRuntime.pauseConversation(conversationId);
    },
    resumeConversation: (conversationId) => {
      conversationRuntime.resumeConversation(conversationId);
    },
    pauseAgent: (conversationId, agentId) => {
      conversationRuntime.pauseAgent(conversationId, agentId);
    },
    resumeAgent: (conversationId, agentId) => {
      conversationRuntime.resumeAgent(conversationId, agentId);
    },
    removeConversation: (conversationId) => {
      conversationRuntime.removeConversation(conversationId);
    },
    onConversationUpdated: (conversationId) => {
      broadcast({ type: 'conversation_updated', conversationId });
    },
      onConversationDeleted: (conversationId) => {
        broadcast({ type: 'conversation_deleted', conversationId });
      },
  });

  // 公司信息
  app.get('/api/company', async () => {
    return {
      name: '球球的 AI 公司',
      boss: deps.bossName,
      providers: deps.llmRegistry.list(),
      agents: deps.configService.agents(),
      departments: deps.configService.departments(),
    };
  });

  // ─── Departments (Web 配置) ───

  // 列出(合并 yaml + db,带 source)
  app.get('/api/departments', async () => {
    const yamlDepts = new Set((deps.orchestrator as any).companyConfig?.departments?.map((d: any) => d.id) ?? []);
    const dbDepts = new DepartmentRepo().list();
    return {
      active: deps.configService.departments(),
      db: dbDepts.map((d) => ({ ...d, source: 'db' })),
      yamlIds: Array.from(yamlDepts),
    };
  });

  // 详情
  app.get('/api/departments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const merged = deps.configService.departments().find(d => d.id === id);
    if (!merged) return reply.code(404).send({ error: 'Not found' });
    return merged;
  });

  // 添加/更新
  app.post('/api/departments', async (req, reply) => {
    const body = req.body as Partial<DepartmentConfig> & { englishName?: unknown };
    const idSource = typeof body.id === 'string' && body.id.trim()
      ? body.id
      : typeof body.englishName === 'string'
        ? body.englishName
        : '';
    const id = idSource.trim();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!id || !name) {
      return reply.code(400).send({ error: '部门名称和英文名称是必填的' });
    }
    if (!/^[a-z0-9_-]+$/i.test(id)) {
      return reply.code(400).send({ error: '英文名称只能包含字母、数字、短横线或下划线' });
    }
    // 校验:parentId 不能是自己或自己的后代(防环)
    const parentId = typeof body.parentId === 'string' && body.parentId.trim()
      ? body.parentId.trim()
      : undefined;
    if (parentId) {
      const repo = new DepartmentRepo();
      if (repo.wouldCreateCycle(id, parentId)) {
        return reply.code(400).send({ error: `parentId '${parentId}' 会形成循环(是 ${id} 自身或后代)` });
      }
    }
    const repo = new DepartmentRepo();
    const existing = repo.get(id);
    const next: DepartmentConfig = {
      id,
      name,
      description: typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : undefined,
      head: typeof body.head === 'string' ? body.head : existing?.head ?? '',
      teams: Array.isArray(body.teams) ? body.teams : existing?.teams,
      parentId,
    };
    const saved = repo.upsert(next);
    refreshConfig();
    broadcast({ type: 'department_updated', department: saved });
    return saved;
  });

  // 删除
  app.delete('/api/departments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    // 警告:还有 agent 在这个部门的话不让删
    const agents = deps.configService.agents().filter(a => a.department === id);
    if (agents.length > 0) {
      return reply.code(400).send({
        error: `部门里还有 ${agents.length} 个 agent,请先删除或转移它们`,
        agents: agents.map(a => a.id),
      });
    }
    const ok = new DepartmentRepo().delete(id);
    if (ok) {
      refreshConfig();
      broadcast({ type: 'department_deleted', id });
    }
    return { ok };
  });

  // ─── Agents (Web 配置) ───

  // 列出(合并 yaml + db)
  app.get('/api/agents', async () => {
    const yamlAgents = new Set((deps.orchestrator as any).companyConfig?.agents?.map((a: any) => a.id) ?? []);
    const dbAgents = new AgentRepo().list();
    return {
      active: deps.configService.agents(),
      db: dbAgents,
      yamlIds: Array.from(yamlAgents),
    };
  });

  // 详情
  app.get('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const merged = deps.configService.agents().find(a => a.id === id);
    if (!merged) return reply.code(404).send({ error: 'Not found' });
    return merged;
  });

  // 添加/更新
  app.post('/api/agents', async (req, reply) => {
    const raw = req.body as Partial<AgentConfig> & { englishName?: unknown; enabled?: boolean };
    const idSource = typeof raw.id === 'string' && raw.id.trim()
      ? raw.id
      : typeof raw.englishName === 'string'
        ? raw.englishName
        : '';
    const id = idSource.trim();
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const body = {
      ...raw,
      id,
      name,
      team: undefined,
    } as AgentConfig & { enabled?: boolean };
    if (!id || !name) {
      return reply.code(400).send({ error: '显示名和英文名称是必填的' });
    }
    const requiredError = validateAgentRequiredFields(body);
    if (requiredError) return reply.code(400).send({ error: requiredError });
    if (!/^[a-z0-9_-]+$/i.test(id)) {
      return reply.code(400).send({ error: '英文名称只能包含字母、数字、短横线或下划线' });
    }
    if (!['head', 'leader', 'worker'].includes(body.role)) {
      return reply.code(400).send({ error: `role must be head|leader|worker` });
    }
    // 校验部门存在
    const deptExists = deps.configService.departments().some(d => d.id === body.department);
    if (!deptExists) {
      return reply.code(400).send({ error: `department '${body.department}' does not exist` });
    }
    // 校验 LLM 存在
    const llmExists = deps.llmRegistry.get(body.llm);
    if ((body.executor ?? 'llm') === 'llm' && !llmExists) {
      return reply.code(400).send({ error: `LLM '${body.llm}' not found. Add it first in 设置 → LLM` });
    }
    const cliError = await validateCliAgent(body);
    if (cliError) return reply.code(400).send({ error: cliError });
    const repo = new AgentRepo();
    const saved = repo.upsert({
      ...body,
      llm: body.executor === 'cli' ? '' : body.llm,
    });
    refreshConfig();
    conversationRuntime.notifyAgentChanged(id);
    broadcast({ type: 'agent_updated', agent: saved });
    return saved;
  });

  // 更新
  app.put('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<AgentConfig>;
    const existing = deps.configService.agents().find(a => a.id === id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const merged = { ...existing, ...body, id };
    // 校验:同 POST
    const requiredError = validateAgentRequiredFields(merged);
    if (requiredError) return reply.code(400).send({ error: requiredError });
    if (merged.department) {
      const deptExists = deps.configService.departments().some(d => d.id === merged.department);
      if (!deptExists) return reply.code(400).send({ error: `department '${merged.department}' does not exist` });
    }
    if ((merged.executor ?? 'llm') === 'llm' && merged.llm) {
      const llmExists = deps.llmRegistry.get(merged.llm);
      if (!llmExists) return reply.code(400).send({ error: `LLM '${merged.llm}' not found` });
    }
    const cliError = await validateCliAgent(merged);
    if (cliError) return reply.code(400).send({ error: cliError });
    const repo = new AgentRepo();
    const saved = repo.upsert({
      ...merged,
      llm: merged.executor === 'cli' ? '' : merged.llm,
    });
    refreshConfig();
    conversationRuntime.notifyAgentChanged(id);
    broadcast({ type: 'agent_updated', agent: saved });
    return saved;
  });

  // 删除
  app.delete('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = new AgentRepo().delete(id);
    if (ok) {
      const changedConversationIds = conversationRepo.removeAgentFromAllConversations(id);
      refreshConfig();
      conversationRuntime.notifyAgentChanged(id);
      for (const conversationId of changedConversationIds) {
        conversationRuntime.notifyMembershipChanged(conversationId);
        broadcast({ type: 'conversation_updated', conversationId });
      }
      broadcast({ type: 'agent_deleted', id });
    }
    return { ok };
  });

  // ─── Custom Tools (Web → 设置 → Tools) ───

  app.get('/api/cli-tools', async () => {
    const tools = new CustomToolRepo().list()
      .filter(tool => tool.type === 'cli')
      .map(tool => {
        const config = tool.config as any;
        const commandAvailable = typeof config.command === 'string' && existsSync(config.command);
        const staticModelsConfigured = Array.isArray(config.staticModels)
          && config.staticModels.some((model: unknown) => typeof model === 'string' && model.trim());
        const modelsConfigured = staticModelsConfigured
          || (!!config.modelsCommand?.trim() && !!config.modelsParser);
        const available = tool.enabled && commandAvailable && modelsConfigured;
        return {
          name: tool.name,
          command: config.command ?? '',
          available,
          modelsConfigured,
          error: available
            ? undefined
            : !tool.enabled
              ? `CLI '${tool.name}' 已禁用`
              : !commandAvailable
                ? `CLI 不存在或不可执行: ${config.command ?? ''}`
                : `CLI '${tool.name}' 未配置推荐模型或 modelsCommand/modelsParser`,
        };
      });
    return { tools };
  });

  app.get('/api/cli-tools/discovered', async () => ({
    tools: discoverInstalledClis(),
  }));

  app.post('/api/cli-tools/:name/models', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { refresh?: boolean };
    const tool = new CustomToolRepo().getByName(name);
    if (!tool || tool.type !== 'cli') return reply.code(404).send({ error: `CLI '${name}' 不存在` });
    const result = await discoverCliModels(tool, { refresh: body.refresh === true });
    if (!result.available) return reply.code(400).send({ error: result.error });
    return result;
  });

  // 列出 builtin + custom
  app.get('/api/tools', async () => {
    const builtinDefs = builtinTools.listDefinitions();
    const customRepo = new CustomToolRepo();
    const custom = customRepo.list();
    return {
      builtin: builtinDefs.map((d) => ({
        name: d.name,
        description: d.description,
        inputSchema: d.inputSchema,
      })),
      custom: custom.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        description: c.description,
        config: c.config,
        enabled: c.enabled,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    };
  });

  // 新增/更新 custom tool(id 缺失则 create)
  app.post('/api/tools', async (req, reply) => {
    const body = req.body as {
      id?: string;
      name: string;
      type: CustomToolType;
      description?: string;
      config: any;
      enabled?: boolean;
    };
    if (!body.name || !body.type) {
      return reply.code(400).send({ error: 'name and type are required' });
    }
    if (!/^[a-z0-9_-]+$/i.test(body.name)) {
      return reply.code(400).send({ error: 'name must be alphanumeric/dash/underscore' });
    }
    if (!['http', 'shell', 'prompt', 'cli'].includes(body.type)) {
      return reply.code(400).send({ error: `type must be http|shell|prompt|cli` });
    }
    const repo = new CustomToolRepo();
    // 同名检查(创建时)
    if (!body.id) {
      const dup = repo.getByName(body.name);
      if (dup) return reply.code(400).send({ error: `tool name "${body.name}" already exists` });
    }
    if (body.type === 'cli') {
      const result = await discoverCliModels({
        id: body.id || body.name,
        name: body.name,
        type: 'cli',
        description: body.description ?? '',
        config: body.config ?? {},
        enabled: body.enabled !== false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { refresh: true });
      if (!result.available) return reply.code(400).send({ error: result.error });
    }
    const saved = repo.upsert({
      id: body.id || body.name,
      name: body.name,
      type: body.type,
      description: body.description ?? '',
      config: body.config ?? {},
      enabled: body.enabled !== false,
    });
    const stats = reloadCustomTools();
    broadcast({ type: 'tool_updated', tool: { id: saved.id, name: saved.name, type: saved.type } });
    return { ...saved, _registry: stats };
  });

  app.put('/api/tools/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const repo = new CustomToolRepo();
    const existing = repo.get(id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const saved = repo.upsert({
      ...existing,
      name: body.name ?? existing.name,
      type: body.type ?? existing.type,
      description: body.description ?? existing.description,
      config: body.config ?? existing.config,
      enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
    });
    reloadCustomTools();
    broadcast({ type: 'tool_updated', tool: { id: saved.id, name: saved.name, type: saved.type } });
    return saved;
  });

  app.delete('/api/tools/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = new CustomToolRepo();
    const existing = repo.get(id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    repo.delete(id);
    reloadCustomTools();
    broadcast({ type: 'tool_deleted', id, name: existing.name });
    return { ok: true };
  });

  // 单跑一次(不写入 DB 也不持久注册,只测试配置)
  app.post('/api/tools/test', async (req, reply) => {
    const body = req.body as {
      type: CustomToolType;
      config: any;
      input?: Record<string, unknown>;
    };
    if (!body.type || !body.config) {
      return reply.code(400).send({ error: 'type and config are required' });
    }
    try {
      if (body.type === 'cli') {
        const result = await discoverCliModels({
          id: 'cli-test',
          name: '待测试 CLI',
          type: 'cli',
          description: '',
          config: body.config,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, { refresh: true });
        return result.available
          ? { success: true, output: result.models.join('\n') }
          : { success: false, output: result.error ?? 'CLI 模型探测失败' };
      }
      const result = await testCustomTool(body.type, body.config, body.input ?? {}, {
        cwd: deps.companyRoot,
        companyRoot: deps.companyRoot,
      });
      return result;
    } catch (e: any) {
      return reply.code(500).send({ success: false, output: e.message ?? String(e) });
    }
  });

  // ─── Skills (Web → 设置 → Skills) ───

  // 列表 + hub
  app.get('/api/skills', async () => {
    const installed = listSkills(deps.companyRoot);
    const hub = listHub(deps.companyRoot);
    return { installed, hub };
  });

  // 详情
  app.get('/api/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const detail = getSkill(deps.companyRoot, name);
      if (!detail) return reply.code(404).send({ error: 'skill not found' });
      return detail;
    } catch (e: any) {
      // 球球 review C1: 非法 name → 400
      if (e.name === 'InvalidSkillNameError') {
        return reply.code(400).send({ error: e.message });
      }
      throw e;
    }
  });

  // 安装(source: 'url' | 'upload' | 'hub' | 'content')
  app.post('/api/skills/install', async (req, reply) => {
    const body = req.body as {
      source: 'url' | 'upload' | 'hub' | 'content';
      url?: string;
      fileBase64?: string;
      filename?: string;
      content?: string;
      name?: string;
    };
    if (!body.source) return reply.code(400).send({ error: 'source required' });
    try {
      let result: { name: string; source: string };
      if (body.source === 'url') {
        if (!body.url) return reply.code(400).send({ error: 'url required for source=url' });
        result = await installFromUrl(body.url, body.name);
      } else if (body.source === 'upload') {
        if (!body.fileBase64) return reply.code(400).send({ error: 'fileBase64 required for source=upload' });
        result = await installFromUpload(body.fileBase64, body.filename ?? 'skill.zip', body.name);
      } else if (body.source === 'content') {
        if (!body.content) return reply.code(400).send({ error: 'content required for source=content' });
        result = await installFromContent(body.content, body.name);
      } else if (body.source === 'hub') {
        // hub 安装:从 listHub 找匹配的 name,再走 url 流程
        const hubList = listHub(deps.companyRoot);
        const target = hubList.find((h) => h.name === body.name);
        if (!target?.sourceUrl) return reply.code(404).send({ error: `hub entry "${body.name}" not found or no sourceUrl` });
        result = await installFromUrl(target.sourceUrl, target.name);
      } else {
        return reply.code(400).send({ error: `unknown source: ${body.source}` });
      }
      broadcast({ type: 'skill_installed', name: result.name });
      return { ok: true, ...result };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message ?? String(e) });
    }
  });

  // 卸载
  app.delete('/api/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const result = uninstallSkill(deps.companyRoot, name);
      broadcast({ type: 'skill_uninstalled', name });
      return { ok: true, ...result };
    } catch (e: any) {
      // 球球 review C1: 区分"非法 name(400)"和"没找到(404)"
      if (e.name === 'InvalidSkillNameError') {
        return reply.code(400).send({ error: e.message });
      }
      return reply.code(404).send({ error: e.message ?? String(e) });
    }
  });

  // ─── Data Backup / Restore (Web → 设置 → 数据) ───

  app.get('/api/data/export', async (_, reply) => {
    const zip = exportBackup({ companyRoot: deps.companyRoot });
    const filename = `agent-company-backup-${
      new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
    }.zip`;
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(zip);
  });

  app.post('/api/data/import', async (req, reply) => {
    const body = req.body as { fileBase64?: string; filename?: string };
    if (!body?.fileBase64) {
      return reply.code(400).send({ error: '导入数据必须提供 fileBase64' });
    }
    try {
      const result = importBackup({
        companyRoot: deps.companyRoot,
        zipBuffer: Buffer.from(body.fileBase64, 'base64'),
        createSafetyBackup: true,
      });
      deps.configService.reload();
      deps.llmRegistry.init([], deps.providerRepo.list());
      reloadCustomTools();
      return result;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/data/reset', async (req, reply) => {
    const body = req.body as { confirm?: string };
    if (body?.confirm !== 'RESET_AGENT_COMPANY') {
      return reply.code(400).send({ error: '一键还原需要正确的确认标记' });
    }
    try {
      const result = resetData({ companyRoot: deps.companyRoot, createSafetyBackup: true });
      deps.configService.reload();
      deps.llmRegistry.init([], deps.providerRepo.list());
      reloadCustomTools();
      return result;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─── Settings Helper(工具/技能设置页里的对话框) ───

  // 列出可用的 meta-tool(给前端展示"我能帮你做什么")
  app.get('/api/settings/meta-tools', async () => {
    return { tools: listMetaTools() };
  });

  // 对话入口 — 调 helper agent,跑 chat loop
  app.post('/api/settings/chat', async (req, reply) => {
    const body = req.body as {
      tab: 'tools' | 'skills';
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      llmId?: string;
    };
    if (!body.tab || !['tools', 'skills'].includes(body.tab)) {
      return reply.code(400).send({ error: 'tab must be "tools" or "skills"' });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: 'messages must be a non-empty array' });
    }

    // 选 LLM:用前端传的 > 第一个 enabled provider > 报错
    const allProviders = deps.llmRegistry.list();
    let llmId = body.llmId;
    if (!llmId) {
      const first = allProviders.find(p => p.enabled) ?? allProviders[0];
      llmId = first?.id;
    }
    if (!llmId || !deps.llmRegistry.get(llmId)) {
      return reply.code(400).send({
        error: '没有可用的 LLM provider — 请先在「设置 → LLM」里加一个',
      });
    }

    try {
      const llmMessages: LLMMessage[] = body.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
      const result = await runHelperAgent({
        tab: body.tab,
        messages: llmMessages,
        llmId,
        llmRegistry: deps.llmRegistry,
        companyRoot: deps.companyRoot,
      });

      // 通知前端刷新(可能创建/更新了 tool 或 skill)
      if (result.toolCalls.some(t => t.name.startsWith('create_custom_tool') || t.name.startsWith('update_custom_tool') || t.name.startsWith('delete_custom_tool'))) {
        broadcast({ type: 'tool_updated', tool: { id: '*', name: '*', type: '*' } });
      }
      if (result.toolCalls.some(t => t.name.startsWith('install_skill') || t.name.startsWith('uninstall_skill'))) {
        broadcast({ type: 'skill_installed', name: '*' });
      }

      return {
        ok: true,
        reply: result.reply,
        toolCalls: result.toolCalls,
        usage: result.usage,
        llmId,
      };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message ?? String(e) });
    }
  });

  /** 重新加载配置并通知 Orchestrator */
  function refreshConfig(): void {
    const merged = deps.configService.merged();
    deps.orchestrator.updateConfig(merged);
  }

  // ─── Agent 能力测试 ───

  app.post('/api/agents/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { prompt?: string; systemPrompt?: string };
    if (!body.prompt) return reply.code(400).send({ error: 'prompt required' });

    const agent = deps.configService.agents().find(a => a.id === id);
    if (!agent) return reply.code(404).send({ error: 'agent not found' });

    if (agent.executor === 'cli') {
      const sysPrompt = body.systemPrompt ?? agent.systemPrompt;
      const cliPrompt = sysPrompt?.trim()
        ? `[system]\n${sysPrompt}\n\n[user]\n${body.prompt}`
        : body.prompt;
      const result = await executeCliAgentOnce(agent, cliPrompt, 'test');
      if (result.validationError) {
        return reply.code(400).send({ error: result.validationError });
      }
      return result.response;
    }

    const provider = deps.llmRegistry.get(agent.llm);
    if (!provider) return reply.code(400).send({ error: `LLM '${agent.llm}' not available` });

    const sysPrompt = body.systemPrompt ?? agent.systemPrompt;
    const start = Date.now();
    try {
      const toolDefs = builtinTools.listForNames(agent.tools);
      const response = await provider.chat({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: body.prompt },
        ],
        tools: toolDefs,
        maxTokens: 1000,
        temperature: 0.7,
      });
      return {
        success: true,
        text: response.text,
        toolCalls: response.toolCalls,
        usage: response.usage,
        durationMs: Date.now() - start,
        model: response.raw ? '(see raw)' : 'unknown',
        stopReason: response.stopReason,
      };
    } catch (e: any) {
      return reply.code(200).send({
        success: false,
        error: e.message,
        stack: e.stack?.split('\n').slice(0, 3),
        durationMs: Date.now() - start,
      });
    }
  });

  // 旧入口保留兼容，执行逻辑与持久化私聊共用同一适配器。
  app.post('/api/agents/:id/chat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      messages?: LLMMessage[];
      systemPrompt?: string;
    };

    const agent = deps.configService.agents().find((candidate) => candidate.id === id);
    if (!agent) return reply.code(404).send({ error: `Agent '${id}' 不存在` });

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: '消息不能为空' });
    }

    const result = await executeAgentChat(
      agent,
      body.messages,
      agentChatExecutionDeps,
      body.systemPrompt,
    );
    if (result.requestError) {
      return reply.code(400).send({ error: result.requestError });
    }
    return result.response;
  });

  // ─── 公司模板 ───
  // 公司模板在前端(companyTemplates.ts),后端只负责"应用"
  // 端点:POST /api/templates/apply
  // body: { template: CompanyTemplate, llmOverride?: string }
  //  - 创建所有部门(支持嵌套 parentId)
  //  - 创建所有 agent(llm 字段:如果用户指定的 llm 不存在,fallback 到任意第一个)
  app.post('/api/templates/apply', async (req, reply) => {
    const body = req.body as {
      template: {
        departments: Array<{ id: string; name: string; description?: string; parentId?: string; head?: string; teams?: string[] }>;
        agents: Array<{
          id: string; name: string; department: string; team?: string; role: 'head' | 'leader' | 'worker';
          llm: string; systemPrompt: string; tools: string[]; avatar?: string; description?: string;
        }>;
      };
      llmOverride?: string;  // 强制用某个 LLM
    };

    if (!body.template || !Array.isArray(body.template.departments) || !Array.isArray(body.template.agents)) {
      return reply.code(400).send({ error: 'template 格式错误,需要 departments + agents' });
    }

    // 校验:用户指定的 llm 列表
    const availableLlms = deps.llmRegistry.list();
    const validLlmIds = new Set(availableLlms.map(p => p.id));
    // 球球要求"完全不要 mock 兜底" — 套用模板时如果 agent 引用了不在注册表里的 LLM,
    // 直接报错让用户去配,而不是悄悄换成一个不存在的 'mock-default'。
    const fallbackLlm = body.llmOverride || (availableLlms[0]?.id ?? '');

    const deptRepo = new DepartmentRepo();
    const agentRepo = new AgentRepo();
    const stats = { departments: { added: 0, skipped: 0 }, agents: { added: 0, skipped: 0, llmFallback: 0 } };

    // 1. 创部门(先父后子,确保 parentId 引用有效)
    const sortedDepts = [...body.template.departments].sort((a, b) => {
      // 无 parentId 的先(顶级),有 parentId 的后
      if (!a.parentId && b.parentId) return -1;
      if (a.parentId && !b.parentId) return 1;
      return 0;
    });
    for (const d of sortedDepts) {
      if (deptRepo.get(d.id)) {
        stats.departments.skipped++;
        continue;
      }
      // 校验 parentId 引用存在
      if (d.parentId && !deptRepo.get(d.parentId) && !sortedDepts.find(x => x.id === d.parentId)) {
        // parent 还没创建,跳过(下一轮)
        // 简化:警告但创建,后续 setNull
      }
      deptRepo.upsert({
        id: d.id,
        name: d.name,
        description: d.description,
        head: d.head ?? '',
        teams: d.teams,
        parentId: d.parentId,
      });
      stats.departments.added++;
    }

    // 2. 创 agent
    for (const a of body.template.agents) {
      if (agentRepo.get(a.id)) {
        stats.agents.skipped++;
        continue;
      }
      // 校验部门存在
      if (!deptRepo.get(a.department)) {
        // 部门不在 — 用 LLM fallback 让 agent 仍然能跑
        stats.agents.skipped++;
        continue;
      }
      // 解析 LLM — 球球要求"完全不要 mock 兜底":找不到真实 LLM 就跳过这个 agent,不创建。
      if (!validLlmIds.has(a.llm)) {
        if (!fallbackLlm) {
          // 一个可用 LLM 都没有 — 这个 agent 没法跑,跳过
          stats.agents.skipped++;
          continue;
        }
        stats.agents.llmFallback++;
      }
      const llm = validLlmIds.has(a.llm) ? a.llm : fallbackLlm;
      agentRepo.upsert({
        id: a.id,
        name: a.name,
        department: a.department,
        team: a.team,
        role: a.role,
        llm,
        systemPrompt: a.systemPrompt,
        tools: a.tools,
        avatar: a.avatar,
        description: a.description,
      });
      stats.agents.added++;
    }

    refreshConfig();

    return {
      ok: true,
      stats,
      message: `✅ 套用成功!新增 ${stats.departments.added} 部门 / ${stats.agents.added} agent(跳过 ${stats.departments.skipped + stats.agents.skipped} 个已存在的)${stats.agents.llmFallback > 0 ? `; ${stats.agents.llmFallback} 个 agent 用了 fallback LLM (${fallbackLlm})` : ''}`,
    };
  });

  // ─── LLM Providers (Web 配置) ───

  // 球球 review 2026-08-15:之前返 { active, db } 两个分类,前端根本不用 db 视图,合并成一个 providers 字段
  // db 原始数据(带 apiKey)从 db 单独 list 即可,不应跟 active 混在一起
  app.get('/api/providers', async () => {
    return { providers: deps.llmRegistry.list() };
  });

  // 添加或更新一个 provider
  app.post('/api/providers', async (req, reply) => {
    const body = req.body as Partial<StoredProvider>;
    if (!body.id || !body.type || !body.model) {
      return reply.code(400).send({ error: 'id, type, model are required' });
    }
    // 球球要求"完全不要 mock" — 任何注册新 provider 的请求,type 必须是真实协议。
    if (!['anthropic', 'openai'].includes(body.type)) {
      return reply.code(400).send({ error: `Unknown type: ${body.type}。仅支持 anthropic / openai(OpenAI 兼容),已不支持 mock。` });
    }
    if (body.id && !/^[a-z0-9_-]+$/i.test(body.id)) {
      return reply.code(400).send({ error: 'id must be alphanumeric/dash/underscore' });
    }

    const stored = deps.providerRepo.upsert({
      id: body.id,
      type: body.type,
      apiKey: body.apiKey ?? '',
      endpoint: body.endpoint,
      path: body.path,
      model: body.model,
      maxTokens: body.maxTokens,
      temperature: body.temperature,
      enabled: body.enabled ?? true,
    });

    // 立即更新 registry
    deps.llmRegistry.add({
      id: stored.id,
      type: stored.type,
      apiKey: stored.apiKey,
      endpoint: stored.endpoint,
      path: stored.path,
      model: stored.model,
      maxTokens: stored.maxTokens,
      temperature: stored.temperature,
      enabled: stored.enabled,
    });

    broadcast({ type: 'provider_added', provider: { id: stored.id, type: stored.type, model: stored.model } });
    return { ...stored, apiKey: maskKey(stored.apiKey) };
  });

  // 更新一个 provider
  app.put('/api/providers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = deps.providerRepo.get(id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = req.body as Partial<StoredProvider>;
    const updated = deps.providerRepo.upsert({
      ...existing,
      ...body,
      id, // 不允许改 id
    });
    deps.llmRegistry.add({
      id: updated.id,
      type: updated.type,
      apiKey: updated.apiKey,
      endpoint: updated.endpoint,
      path: updated.path,
      model: updated.model,
      maxTokens: updated.maxTokens,
      temperature: updated.temperature,
      enabled: updated.enabled,
    });
    broadcast({ type: 'provider_updated', provider: { id: updated.id, type: updated.type, model: updated.model } });
    return { ...updated, apiKey: maskKey(updated.apiKey) };
  });

  // 删除
  app.delete('/api/providers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deps.providerRepo.delete(id);
    if (ok) {
      deps.llmRegistry.remove(id);
      broadcast({ type: 'provider_deleted', id });
    }
    return { ok };
  });

  // 测试 provider(发一个 hello 请求)
  app.post('/api/providers/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const provider = deps.llmRegistry.get(id);
    if (!provider) {
      return reply.code(404).send({ success: false, error: 'Provider not found or disabled' });
    }
    try {
      const start = Date.now();
      const response = await provider.chat({
        messages: [
          { role: 'system', content: 'You are a test agent. Reply with exactly "OK" and one short Chinese sentence.' },
          { role: 'user', content: 'ping' },
        ],
        maxTokens: 50,
        temperature: 0,
      });
      // raw 是 pi-ai 内部的 AssistantMessageEvent,可能含 errorMessage
      // 球球之前说测试像假的,实际是 raw 里有 error 但没暴露
      // 把 raw 里的 errorMessage 拉出来,而不是藏到 "(see raw)"
      const raw = response.raw as any | undefined;
      const errMsg = raw?.errorMessage ?? raw?.error?.message;
      return {
        success: true,
        durationMs: Date.now() - start,
        response: response.text.slice(0, 200),
        tokens: response.usage,
        model: raw?.model ?? 'unknown',
        stopReason: response.stopReason,
        errorMessage: errMsg,
        // 只截 600 字符,避免响应巨大
        raw: raw ? JSON.stringify(raw).slice(0, 600) : undefined,
      };
    } catch (e: any) {
      return reply.code(200).send({ success: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3) });
    }
  });

  // 项目列表
  app.get('/api/projects', async () => {
    return deps.orchestrator.listProjects();
  });

  // 项目详情
  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = deps.orchestrator.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    const tasks = deps.orchestrator.listTasks(id);
    const messages = messageRepo.listByProject(id, 200);
    const workflowNodeOutputs = workflowNodeOutputRepo.listByProject(id);
    return { project, tasks, messages, workflowNodeOutputs };
  });

  app.get('/api/workflows', async () => {
    return { workflows: workflowRepo.list() };
  });

  app.post('/api/workflows', async (req, reply) => {
    const body = req.body as {
      id?: string;
      name?: string;
      description?: string;
      graph?: unknown;
    };
    try {
      const workflow = workflowRepo.upsert({
        id: body.id ?? '',
        name: body.name ?? '',
        description: body.description,
        graph: body.graph as any,
      });
      return { workflow };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.delete('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = workflowRepo.delete(id);
      if (!ok) return reply.code(404).send({ error: '流程不存在' });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  // 创建项目
  app.post('/api/projects', async (req, reply) => {
    const body = req.body as {
      title: string;
      description?: string;
      projectDir?: string;        // 球球 review 2026-08-16:可指定本地文件夹作为项目目录
      llmId?: string;             // 球球要的 LLM provider(chat 场景用,createProject 暂不直接用)
      agentId?: string;           // 球球 review 2026-08-16 追问:选 agent,不是选 model
        mode?: 'creative' | 'solo';
        workflowId?: string;
      thinking?: boolean;
      autoApprove?: 'always' | 'never' | 'prompt';
      initialMessage?: string;
      attachments?: ProjectAttachmentPayload[];
      initialTasks?: Array<{ phase: string; dept: string; title: string; prompt: string; assignee: string }>;
    };
    if (!body.title) return reply.code(400).send({ error: 'title required' });

    // 球球 review 2026-08-16:projectDir 必须经过白名单验证(防 SSRF / 路径穿越)
    let validatedDir: string | undefined;
    if (body.projectDir) {
      const r = validateProjectDir(body.projectDir);
      if ('error' in r) return reply.code(400).send({ error: r.error });
      validatedDir = r.dir;
    }
    if (body.attachments !== undefined && !validatedDir) {
      return reply.code(400).send({ error: '上传附件必须先选择项目目录' });
    }
    if (
      body.autoApprove !== undefined
      && !['always', 'never', 'prompt'].includes(body.autoApprove)
    ) {
      return reply.code(400).send({
        error: 'autoApprove 仅支持 always、never 或 prompt',
      });
    }
    if (body.mode !== undefined && !['creative', 'solo'].includes(body.mode)) {
      return reply.code(400).send({ error: 'mode 必须是 creative 或 solo' });
    }
    if (body.mode === 'solo' && !body.agentId) {
      return reply.code(400).send({ error: 'SOLO 模式必须选择 Agent' });
    }
    const initialMessage = typeof body.initialMessage === 'string'
      ? body.initialMessage.trim()
      : '';

    const projectMode = body.mode ?? 'creative';

    if (projectMode !== 'solo' && body.initialTasks !== undefined) {
      return reply.code(400).send({
        error: '新图项目不支持 initialTasks，请使用流程 snapshot 中的 stage 模板',
      });
    }

    // SOLO 模式才需要显式 Agent;创造模式由公司开发流程分配任务。
    let ownerAgentId: string | undefined;
    if (projectMode === 'solo' && body.agentId) {
      const agent = deps.configService.agents().find(a => a.id === body.agentId);
      if (!agent) return reply.code(400).send({ error: `agent "${body.agentId}" 不存在` });
      ownerAgentId = body.agentId;
    }

    const workflowId = body.workflowId ?? 'standard';
    let workflow;
    try {
      workflow = projectMode === 'solo'
        ? undefined
        : workflowRepo.get(workflowId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
    if (projectMode !== 'solo' && !workflow) {
      return reply.code(400).send({ error: `流程 "${workflowId}" 不存在` });
    }
    if (workflow) {
      const agentError = findUnavailableWorkflowAgent(
        workflow.graph,
        workflowAgentAvailable(
          deps.configService.agents(),
          (llmId) => Boolean(
            deps.llmRegistry.get(llmId)
            && deps.llmRegistry.list().find((item) => item.id === llmId)?.enabled === true,
          ),
        ),
      );
      if (agentError) {
        return reply.code(400).send({ error: agentError });
      }
    }

    let initialInputFiles: string[] | undefined;
    if (body.attachments !== undefined && validatedDir) {
      try {
        initialInputFiles = await saveProjectAttachments(validatedDir, body.attachments);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      }
    }

    const project = await deps.orchestrator.createProject({
      title: body.title,
      description: body.description,
      boss: deps.bossName,
        mode: projectMode,
      projectOwnerAgentId: ownerAgentId,
        ...(workflow ? { workflow } : {}),
      projectDir: validatedDir,
      thinking: body.thinking,
      autoApprove: body.autoApprove,
      ...(initialMessage ? { initialMessage } : {}),
      ...(initialInputFiles ? { initialInputFiles } : {}),
      initialTasks: body.initialTasks,
    });
    if (initialMessage) {
      const msg = messageRepo.create({
        id: randomUUID(),
        projectId: project.id,
        channel: 'general',
        fromId: 'boss',
        fromName: deps.bossName,
        fromRole: 'Boss',
        content: initialMessage,
        type: 'message',
        mentions: extractMentions(initialMessage),
      });
      broadcast({
        type: 'message',
        projectId: project.id,
        channel: 'general',
        message: msg,
      });

      if (projectMode === 'solo' && ownerAgentId) {
        const agent = deps.configService.agents().find(a => a.id === ownerAgentId);
        if (!agent) return reply.code(400).send({ error: `Agent '${ownerAgentId}' 不存在` });
        try {
            const assistantMessage = await replyInSoloProject(project.id, agent, initialInputFiles ?? []);
          broadcast({
            type: 'message',
            projectId: project.id,
            channel: 'general',
            message: assistantMessage,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return reply.code(400).send({ error: message });
        }
      }
    }
    return project;
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = deps.orchestrator.deleteProject(id);
    if (!deleted) return reply.code(404).send({ error: '项目不存在' });
    return { ok: true };
  });

  // 推进项目
  app.post('/api/projects/:id/tick', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.orchestrator.getProject(id)) {
      return reply.code(404).send({ error: '项目不存在' });
    }
    await deps.orchestrator.tick(id);
    const project = deps.orchestrator.getProject(id);
    return project;
  });

  // Agent 状态
  app.get('/api/agents/status', async () => {
    return deps.orchestrator.getStatusReport();
  });

  // 球球 review 2026-08-16:文件浏览器 — 列 home 下候选根目录,供前端 ChatInputBox 选择
  // 严格白名单,只返 home 下的标准目录,不暴露任意文件系统
  app.get('/api/fs/home-dirs', async () => {
    const home = homedir();
    const candidates = [
      { key: 'documents', label: '文档 (Documents)', path: join(home, 'Documents') },
      { key: 'desktop',   label: '桌面 (Desktop)',   path: join(home, 'Desktop') },
      { key: 'projects',  label: '项目 (Projects)',  path: join(home, 'Projects') },
      { key: 'home',      label: '家目录 (Home)',     path: home },
    ];
    return {
      home,
      dirs: candidates
        .filter((c) => existsSync(c.path))
        .map((c) => ({
          key: c.key,
          label: c.label,
          path: c.path,
          // 是否可写(快速检查)
          writable: (() => {
            try {
              accessSync(c.path, constants.W_OK);
              return true;
            } catch { return false; }
          })(),
        })),
      // 也暴露系统 tmp(适合临时项目)
      tmp: tmpdir(),
    };
  });

  app.post('/api/fs/validate-dir', async (req, reply) => {
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: '请求体必须是包含 path 的 JSON 对象' });
    }
    const validated = validateProjectDir((body as { path?: unknown }).path as string);
    if ('error' in validated) {
      return reply.code(400).send({ error: validated.error });
    }

    let writable = true;
    try {
      accessSync(validated.dir, constants.W_OK);
    } catch {
      writable = false;
    }
    return { path: validated.dir, exists: true as const, writable };
  });

  // 老板发言
  app.post('/api/projects/:id/say', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { content: string; channel?: string; attachments?: ProjectAttachmentPayload[] };
    const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
    if (!body.content && !hasAttachments) return reply.code(400).send({ error: 'content required' });
    const project = deps.orchestrator.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });

    const channel = body.channel ?? 'general';
    const content = body.content || '请查看附件';
    let inputFiles: string[] = [];
    if (body.attachments !== undefined) {
      inputFiles = await saveProjectAttachments(projectDirectoryFor(project.id, project.metadata), body.attachments);
    }
    const mentions = extractMentions(content);
    const msg = messageRepo.create({
      id: randomUUID(),
      projectId: id,
      channel,
      fromId: 'boss',
      fromName: deps.bossName,
      fromRole: 'Boss',
      content,
      type: 'message',
      mentions,
    });

    broadcast({
      type: 'message',
      projectId: id,
      channel,
      message: msg,
    });

    if (project.metadata?.mode === 'solo') {
      const soloAgentId = project.metadata.soloAgentId;
      if (typeof soloAgentId !== 'string' || !soloAgentId.trim()) {
        return reply.code(400).send({ error: 'SOLO 项目缺少 Agent 配置' });
      }
      const agent = deps.configService.agents().find(a => a.id === soloAgentId);
      if (!agent) return reply.code(400).send({ error: `Agent '${soloAgentId}' 不存在` });
      try {
          const assistantMessage = await replyInSoloProject(id, agent, inputFiles);
        broadcast({
          type: 'message',
          projectId: id,
          channel,
          message: assistantMessage,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      }
      return msg;
    }

    // Phase 2: 触发 chat router(让 @ 的 agent 自动回应)
    // 注意:这里只是创建消息,实际的 agent 自动接话在 chat router 里
    // orchestrator 初始化时已经订阅了 bus

    return msg;
  });

  // 跑完整个项目(模拟)
  app.post('/api/projects/:id/run-to-completion', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.orchestrator.getProject(id)) {
      return reply.code(404).send({ error: '项目不存在' });
    }
    const maxTicks = Number((req.body as any)?.maxTicks ?? 50);
    const project = await deps.orchestrator.runToCompletion(id, maxTicks);
    return project;
  });

  // 项目状态统计
  app.get('/api/stats', async () => {
    const projects = deps.orchestrator.listProjects();
    const agents = deps.orchestrator.listAgents();
    const statuses = deps.orchestrator.getStatusReport();
    return {
      projectCount: projects.length,
      activeProjects: projects.filter(p => p.status !== 'done' && p.status !== 'failed').length,
      agentCount: agents.length,
      busyAgents: statuses.filter(s => s.status === 'busy').length,
      totalCost: 0, // TODO: 累计 token
    };
  });

  // 频道消息
  app.get('/api/projects/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { channel?: string; limit?: string };
    if (q.channel) {
      return messageRepo.listByChannel(id, q.channel, Number(q.limit ?? 200));
    }
    return messageRepo.listByProject(id, Number(q.limit ?? 200));
  });

  app.setErrorHandler((err, req, reply) => {
    app.log.error({ err, url: req.url, method: req.method }, 'request error');
    const error = err instanceof Error ? err : new Error(String(err));
    // 球球 review C5: 生产环境不返 stack(暴露内部路径 / node_modules / SQL 片段)
    // dev 环境返 stack 方便调试
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      reply.code(500).send({ error: error.message, stack: error.stack?.split('\n').slice(0, 5) });
    } else {
      reply.code(500).send({ error: error.message || 'Internal error' });
    }
  });

  // ─── Server lifecycle ───
  const requestedPort = options.port ?? Number(process.env.PORT ?? 4000);
  const host = options.host ?? '127.0.0.1';

  await app.listen({ port: requestedPort, host });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('Server 启动后未获得有效 TCP 地址');
  }
  const port = address.port;

  // WebSocket
  app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.send(
        JSON.stringify({ type: 'connected', timestamp: Date.now() }),
      );
    });
  });

  // 监听 agent 事件,广播
  function broadcast(data: any): void {
    const json = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === 1) {
        try {
          client.send(json);
        } catch {}
      }
    }
  }

  // 通过 orchestrator 的 events 接口订阅(避免直接戳 private 字段)
  const origEvents = deps.orchestrator.getEvents?.() ?? {};
  deps.orchestrator.bindEvents({
    onLog: origEvents.onLog,
    onProjectUpdate: (p) => {
      origEvents.onProjectUpdate?.(p);
      broadcast({ type: 'project_update', project: p });
    },
    onTaskUpdate: (t) => {
      origEvents.onTaskUpdate?.(t);
      broadcast({ type: 'task_update', task: t });
    },
    onAgentEvent: (e) => {
      origEvents.onAgentEvent?.(e);
      broadcast({ type: 'agent_event', event: e });
    },
  });

  return { app, wss, port };
}

function extractMentions(content: string): string[] {
  const matches = content.matchAll(/@([\w-]+)/g);
  return Array.from(matches, (m) => m[1]!);
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}
