import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/api/server.js';
import { LLMRegistry } from '../../src/llm/registry.js';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { ConversationRepo } from '../../src/store/conversations.js';
import { CustomToolRepo } from '../../src/store/customTools.js';
import { getDB } from '../../src/store/db.js';
import { AgentRepo, DepartmentRepo } from '../../src/store/org.js';
import { ProviderRepo } from '../../src/store/providers.js';
import { ProjectRepo, TaskRepo } from '../../src/store/repository.js';
import { WorkflowRepo } from '../../src/store/workflows.js';
import type {
  CompanyConfig,
  WorkflowRuntimeState,
} from '../../src/types/company.js';
import { linearWorkflowToGraph } from '../../src/workflows/graph.js';
import type { WorkflowGraph } from '../../src/workflows/model.js';
import { cleanupDB, freshDB } from '../helpers/db.js';

let dbDir: string;
let dbPath: string;

function makeWorkflowGraph(stage = 'prd'): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: `stage-${stage}`,
        type: 'stage',
        stage,
        templates: [{
          phase: stage,
          department: 'product',
          assigneeHint: 'product-head',
          title: '写需求',
          promptTemplate: '写 {{title}} 的需求',
          dependsOn: [],
        }],
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: `stage-${stage}`, type: 'default' },
      { id: 'edge-end', source: `stage-${stage}`, target: 'end', type: 'default' },
    ],
  };
}

function makeShuffledLinearWorkflowGraph(): WorkflowGraph {
  const prd = makeWorkflowGraph('prd').nodes[1]!;
  const dev = makeWorkflowGraph('dev').nodes[1]!;
  return {
    version: 1,
    nodes: [
      { id: 'end', type: 'end' },
      dev,
      { id: 'start', type: 'start' },
      prd,
    ],
    edges: [
      { id: 'edge-end', source: dev.id, target: 'end', type: 'default' },
      { id: 'edge-start', source: 'start', target: prd.id, type: 'default' },
      { id: 'edge-next', source: prd.id, target: dev.id, type: 'default' },
    ],
  };
}

function makeHostileIdGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: '__proto__', type: 'start' },
      { id: 'constructor', type: 'end' },
    ],
    edges: [{
      id: '__proto__',
      source: '__proto__',
      target: 'constructor',
      type: 'default',
    }],
  };
}

function makeHostileStageGraph(): WorkflowGraph {
  const protoStage = makeWorkflowGraph('__proto__').nodes[1]!;
  const constructorStage = makeWorkflowGraph('constructor').nodes[1]!;
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      protoStage,
      constructorStage,
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: protoStage.id, type: 'default' },
      {
        id: 'edge-next',
        source: protoStage.id,
        target: constructorStage.id,
        type: 'default',
      },
      { id: 'edge-end', source: constructorStage.id, target: 'end', type: 'default' },
    ],
  };
}

function makeComplexWorkflowGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'condition', type: 'condition' },
      {
        id: 'stage-prd',
        type: 'stage',
        stage: 'prd',
        templates: [{
          phase: 'prd',
          department: 'product',
          assigneeHint: 'product-head',
          title: '写需求',
          promptTemplate: '写 {{title}} 的需求',
          dependsOn: [],
        }],
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: 'condition', type: 'default' },
      { id: 'edge-default', source: 'condition', target: 'end', type: 'default' },
      {
        id: 'edge-condition',
        source: 'condition',
        target: 'stage-prd',
        type: 'condition',
        condition: { type: 'stage_result', operator: 'success' },
      },
      { id: 'edge-end', source: 'stage-prd', target: 'end', type: 'default' },
    ],
  };
}

function makeApprovalWorkflowGraph(): WorkflowGraph {
  const approved = makeWorkflowGraph('approved').nodes[1]!;
  const rejected = makeWorkflowGraph('rejected').nodes[1]!;
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'approval', type: 'scheduler_approval', providerId: 'scheduler' },
      approved,
      rejected,
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: 'approval', type: 'default' },
      { id: 'edge-approved', source: 'approval', target: approved.id, type: 'approved' },
      { id: 'edge-rejected', source: 'approval', target: rejected.id, type: 'rejected' },
      { id: 'edge-approved-end', source: approved.id, target: 'end', type: 'default' },
      { id: 'edge-rejected-end', source: rejected.id, target: 'end', type: 'default' },
    ],
  };
}

function makeLoopWorkflowGraph(): WorkflowGraph {
  const stage = makeWorkflowGraph('retry').nodes[1]!;
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      stage,
      {
        id: 'loop',
        type: 'loop',
        targetNodeId: stage.id,
        maxIterations: 3,
        exitCondition: {
          type: 'output_contains',
          keyword: 'DONE',
          caseSensitive: true,
        },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: stage.id, type: 'default' },
      { id: 'edge-stage-loop', source: stage.id, target: 'loop', type: 'default' },
      { id: 'edge-loop-back', source: 'loop', target: stage.id, type: 'loop_back' },
      { id: 'edge-done', source: 'loop', target: 'end', type: 'default' },
    ],
  };
}

function makeDuplicateStageWorkflowGraph(): WorkflowGraph {
  const first = makeWorkflowGraph('prd').nodes[1]!;
  const second = {
    ...first,
    id: 'stage-prd-second',
    templates: first.type === 'stage'
      ? first.templates.map((template) => ({
          ...template,
          title: '复审需求',
          promptTemplate: '复审 {{title}} 的需求',
        }))
      : [],
  };
  return {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      first,
      second,
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: first.id, type: 'default' },
      { id: 'edge-next', source: first.id, target: second.id, type: 'default' },
      { id: 'edge-end', source: second.id, target: 'end', type: 'default' },
    ],
  };
}

function makeIntegrationCompany(): CompanyConfig {
  return {
    name: '接口测试公司',
    boss: '球球',
    departments: [
      { id: 'product', name: '产品', head: 'a-product-head' },
      { id: 'dev', name: '研发', head: 'a-dev-head' },
    ],
    agents: [
      {
        id: 'a-product-head',
        name: '产品负责人',
        department: 'product',
        role: 'head',
        llm: 'p1',
        systemPrompt: '',
        tools: [],
      },
      {
        id: 'a-dev-head',
        name: '研发负责人',
        department: 'dev',
        role: 'head',
        llm: 'p1',
        systemPrompt: '',
        tools: [],
      },
    ],
    llm_providers: [],
  };
}

function fakeProvider(id: string, responses: string[] = ['任务完成']) {
  let calls = 0;
  const nextText = () => responses[Math.min(calls++, responses.length - 1)] ?? '任务完成';
  return {
    id,
    type: 'openai' as const,
    get calls() {
      return calls;
    },
    async chat() {
      return {
        text: nextText(),
        toolCalls: [],
        stopReason: 'end_turn' as const,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    async *stream() {
      yield {
        type: 'done' as const,
        response: {
          text: nextText(),
          toolCalls: [],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    },
  };
}

async function makeIntegrationServer(
  schedulerResponses?: string[],
) {
  const companyRoot = mkdtempSync(join(tmpdir(), 'workflow-api-integration-'));
  const registry = new LLMRegistry();
  const workerProvider = fakeProvider('p1');
  (registry as any).providers.set('p1', workerProvider);
  (registry as any).metadata.set('p1', {
    source: 'test',
    enabled: true,
    model: 'worker-model',
    type: 'openai',
  });
  const schedulerProvider = schedulerResponses
    ? fakeProvider('scheduler', schedulerResponses)
    : undefined;
  if (schedulerProvider) {
    (registry as any).providers.set('scheduler', schedulerProvider);
    (registry as any).metadata.set('scheduler', {
      source: 'test',
      enabled: true,
      model: 'scheduler-model',
      type: 'openai',
    });
  }
  const company = makeIntegrationCompany();
  const orchestrator = new Orchestrator(registry, company, companyRoot);
  const server = await createServer({
    orchestrator,
    llmRegistry: registry,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => company.agents,
      departments: () => company.departments,
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  return {
    companyRoot,
    orchestrator,
    schedulerProvider,
    server,
  };
}

before(() => {
  ({ dir: dbDir, path: dbPath } = freshDB());
});

after(() => {
  cleanupDB(dbDir, dbPath);
});

test('POST /api/projects 将已验证创建契约传入 Orchestrator 并直接返回初始 metadata', async () => {
  const externalDir = mkdtempSync(join(tmpdir(), 'server-project-contract-'));
  const validatedDir = realpathSync(externalDir);
  let receivedOptions: Record<string, unknown> | undefined;
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      receivedOptions = options;
      return {
        id: 'project-contract',
        title: options.title,
        description: options.description,
        boss: options.boss,
        status: 'prd',
        phase: 'prd',
        createdAt: 1,
        updatedAt: 1,
        metadata: {
          workflow: ['prd', 'design', 'dev', 'qa', 'delivery'],
            workflowId: (options.workflow as any)?.id,
            workflowName: (options.workflow as any)?.name,
          projectDir: options.projectDir,
          thinking: options.thinking,
          autoApprove: options.autoApprove,
        },
      };
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };

  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: externalDir,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '创建契约',
        projectDir: externalDir,
        thinking: false,
        autoApprove: 'never',
        initialMessage: '请先看一下这个仓库',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedOptions, {
      title: '创建契约',
      description: undefined,
      boss: '球球',
        mode: 'creative',
        workflow: receivedOptions?.workflow,
      projectOwnerAgentId: undefined,
      projectDir: validatedDir,
      thinking: false,
      autoApprove: 'never',
      initialMessage: '请先看一下这个仓库',
      initialTasks: undefined,
      });
      assert.equal((receivedOptions?.workflow as any)?.id, 'standard');
    assert.deepEqual(response.json().metadata, {
      workflow: ['prd', 'design', 'dev', 'qa', 'delivery'],
        workflowId: 'standard',
        workflowName: '标准公司开发流程',
      projectDir: validatedDir,
      thinking: false,
      autoApprove: 'never',
    });
  } finally {
    await server.app.close();
    rmSync(externalDir, { recursive: true, force: true });
  }
});

test('POST /api/projects 传递 SOLO 模式到 Orchestrator', async () => {
  let receivedOptions: Record<string, unknown> | undefined;
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      receivedOptions = options;
      return {
        id: 'solo-project',
        title: options.title,
        description: options.description,
        boss: options.boss,
        status: 'dev',
        phase: 'dev',
        createdAt: 1,
        updatedAt: 1,
        metadata: {
          mode: 'solo',
          soloAgentId: options.projectOwnerAgentId,
        },
      };
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [{ id: 'a-frontend', name: '前端小李', department: 'dev', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] }],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: 'SOLO 项目',
        mode: 'solo',
        agentId: 'a-frontend',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(receivedOptions?.mode, 'solo');
    assert.equal(receivedOptions?.projectOwnerAgentId, 'a-frontend');
  } finally {
    await server.app.close();
  }
});

test('DELETE /api/agents/:id 同步清理会话成员和未完成投递', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'server-agent-delete-sync-'));
  const agentId = 'delete-sync-agent';
  const peerId = 'delete-sync-peer';
  new DepartmentRepo().upsert({
    id: 'delete-sync-dept',
    name: '删除同步部门',
    head: '',
  });
  new AgentRepo().upsert({
    id: agentId,
    name: '待删除 Agent',
    department: 'delete-sync-dept',
    role: 'worker',
    llm: 'llm-main',
    systemPrompt: '',
    tools: [],
  });
  new AgentRepo().upsert({
    id: peerId,
    name: '保留 Agent',
    department: 'delete-sync-dept',
    role: 'worker',
    llm: 'llm-main',
    systemPrompt: '',
    tools: [],
  });
  const conversationRepo = new ConversationRepo();
  const configuredAgents = [
    {
      id: agentId,
      name: '待删除 Agent',
      department: 'delete-sync-dept',
      role: 'worker',
      llm: 'llm-main',
      systemPrompt: '',
      tools: [],
    },
    {
      id: peerId,
      name: '保留 Agent',
      department: 'delete-sync-dept',
      role: 'worker',
      llm: 'llm-main',
      systemPrompt: '',
      tools: [],
    },
  ];
  const conversation = conversationRepo.create({
    id: 'delete-sync-conversation',
    kind: 'group',
    title: '删除同步群聊',
    agentIds: [agentId, peerId],
    schedulerMode: 'llm',
    schedulerLlm: 'llm-main',
  });
  conversationRepo.appendMessage({
    id: 'delete-sync-message',
    conversationId: conversation.id,
    senderId: 'boss',
    senderType: 'human',
    content: '需要处理',
    mentions: [],
  });

  const server = await createServer({
    orchestrator: {
      updateConfig() {},
      getEvents() { return {}; },
      bindEvents() {},
    } as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => configuredAgents,
      departments: () => [],
      merged: () => ({ agents: configuredAgents, departments: [], providers: [] }),
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'DELETE',
      url: `/api/agents/${agentId}`,
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { ok: true });
    assert.deepEqual(
      conversationRepo.listMembers(conversation.id).map((member) => member.memberId),
      ['boss', peerId],
    );
    const delivery = getDB().prepare(
      `SELECT status, error FROM conversation_deliveries
       WHERE conversation_id = ? AND agent_id = ?`,
    ).get(conversation.id, agentId) as { status: string; error: string };
    assert.deepEqual(delivery, { status: 'failed', error: 'Agent 已删除' });
  } finally {
    await server.app.close();
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('POST /api/projects 把 initialMessage 写为首条老板消息', async () => {
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      return {
        id: 'project-with-initial-message',
        title: options.title,
        description: options.description,
        boss: options.boss,
        status: 'prd',
        phase: 'prd',
        createdAt: 1,
        updatedAt: 1,
        metadata: { mode: 'creative' },
      };
    },
    getProject(id: string) {
      return id === 'project-with-initial-message'
        ? {
            id,
            title: '新的创造项目',
            description: undefined,
            boss: '球球',
            status: 'prd',
            phase: 'prd',
            createdAt: 1,
            updatedAt: 1,
            metadata: { mode: 'creative' },
          }
        : null;
    },
    listTasks() {
      return [];
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '新的创造项目',
        mode: 'creative',
        workflowId: 'standard',
        initialMessage: '先梳理这个仓库的技术栈',
      },
    });

    assert.equal(response.statusCode, 200);
    const detail = await server.app.inject({
      method: 'GET',
      url: '/api/projects/project-with-initial-message',
    });
    const messages = detail.json().messages as Array<{ fromId: string; content: string; type: string }>;
    assert.equal(messages.some(m => m.fromId === 'boss' && m.content === '先梳理这个仓库的技术栈'), true);
  } finally {
    await server.app.close();
  }
});

test('POST /api/projects SOLO 模式把 initialMessage 立即发送给 Agent', async () => {
  const project = {
    id: 'solo-created-with-initial-message',
    title: '新的 SOLO 对话',
    description: undefined,
    boss: '球球',
    status: 'dev',
    phase: 'dev',
    createdAt: 1,
    updatedAt: 1,
    metadata: {
      mode: 'solo',
      soloAgentId: 'a-frontend',
    },
  };
  let providerCalled = false;
  const orchestrator = {
    async createProject() {
      return project;
    },
    getProject(id: string) {
      return id === project.id ? project : null;
    },
    listTasks() {
      return [];
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: {
      list: () => [],
      get: (id: string) => id === 'p1'
        ? {
            async chat(req: any) {
              providerCalled = true;
              assert.equal(req.messages.some((m: any) => m.role === 'user' && m.content === '先阅读项目并告诉我怎么改'), true);
              return {
                text: '我已经开始阅读项目',
                toolCalls: [],
                stopReason: 'end_turn',
                usage: { inputTokens: 3, outputTokens: 4 },
              };
            },
          }
        : undefined,
    } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [{
        id: 'a-frontend',
        name: '前端小李',
        department: 'dev',
        role: 'worker',
        llm: 'p1',
        systemPrompt: '你是 SOLO 开发 agent',
        tools: [],
      }],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '新的 SOLO 对话',
        mode: 'solo',
        agentId: 'a-frontend',
        initialMessage: '先阅读项目并告诉我怎么改',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(providerCalled, true);
    const detail = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });
    const messages = detail.json().messages as Array<{ fromId: string; content: string; type: string }>;
    assert.equal(messages.some(m => m.fromId === 'boss' && m.content === '先阅读项目并告诉我怎么改'), true);
    assert.equal(messages.some(m => m.fromId === 'a-frontend' && m.content === '我已经开始阅读项目'), true);
  } finally {
    await server.app.close();
  }
});

test('POST /api/projects 创造模式不传递 agentId 作为项目 owner', async () => {
  let receivedOptions: Record<string, unknown> | undefined;
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      receivedOptions = options;
      return {
        id: 'creative-project',
        title: options.title,
        description: options.description,
        boss: options.boss,
        status: 'prd',
        phase: 'prd',
        createdAt: 1,
        updatedAt: 1,
        metadata: {
          mode: 'creative',
          workflowId: options.workflowId,
        },
      };
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [{ id: 'a-frontend', name: '前端小李', department: 'dev', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] }],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '创造模式项目',
        mode: 'creative',
        agentId: 'a-frontend',
        workflowId: 'standard',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(receivedOptions?.mode, 'creative');
    assert.equal(receivedOptions?.projectOwnerAgentId, undefined);
    assert.equal((receivedOptions?.workflow as any)?.id, 'standard');
  } finally {
    await server.app.close();
  }
});

test('WorkflowRepo 对 nodes 乱序的线性 graph 按边拓扑投影并完整回读', () => {
  const repo = new WorkflowRepo();
  const graph = makeShuffledLinearWorkflowGraph();
  try {
    const saved = repo.upsert({
      id: 'repo-graph-flow',
      name: 'Repo 图流程',
      description: '完整回读',
      graph,
    } as any);

    assert.deepEqual(saved.graph, graph);
    assert.equal((saved as any).legacyCompatible, true);
    assert.deepEqual(saved.stages, ['prd', 'dev']);
    assert.deepEqual(Object.keys(saved.templates), ['prd', 'dev']);
    assert.deepEqual(repo.get('repo-graph-flow')?.graph, graph);
  } finally {
    getDB().prepare(`DELETE FROM workflows WHERE id = ?`).run('repo-graph-flow');
  }
});

test('WorkflowRepo 对 hostile stage 名生成无损旧投影并持久化自有模板键', () => {
  const repo = new WorkflowRepo();
  const graph = makeHostileStageGraph();
  const id = 'repo-hostile-stage-flow';

  try {
    const saved = repo.upsert({
      id,
      name: '特殊阶段名流程',
      graph,
    } as any);
    const row = getDB().prepare(
      `SELECT stages, templates FROM workflows WHERE id = ?`,
    ).get(id) as { stages: string; templates: string };
    const persistedTemplates = JSON.parse(row.templates);
    const reloaded = repo.get(id);

    assert.equal(saved.legacyCompatible, true);
    assert.deepEqual(saved.stages, ['__proto__', 'constructor']);
    for (const stage of saved.stages) {
      assert.equal(Object.prototype.hasOwnProperty.call(saved.templates, stage), true, stage);
      assert.equal(Object.prototype.hasOwnProperty.call(persistedTemplates, stage), true, stage);
      assert.equal(
        Object.prototype.hasOwnProperty.call(reloaded?.templates, stage),
        true,
        stage,
      );
      assert.deepEqual(saved.templates[stage], persistedTemplates[stage], stage);
      assert.deepEqual(reloaded?.templates[stage], persistedTemplates[stage], stage);
    }
  } finally {
    getDB().prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
  }
});

test('WorkflowRepo 仅将 graph 为 NULL、空字符串或空白字符串的旧行转换为流程图', () => {
  const stages = ['prd'];
  const templates = {
    prd: [{
      phase: 'prd',
      department: 'product',
      assigneeHint: 'product-head',
      title: '写需求',
      promptTemplate: '写需求',
      dependsOn: [],
    }],
  };
  const cases = [
    { id: 'legacy-null-graph', graph: null },
    { id: 'legacy-empty-graph', graph: '' },
    { id: 'legacy-blank-graph', graph: '   ' },
  ];
  const insert = getDB().prepare(
    `INSERT INTO workflows (
      id, name, description, stages, templates, graph, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, ?, 1, 2)`,
  );
  for (const item of cases) {
    insert.run(
      item.id,
      '旧 Repo 流程',
      JSON.stringify(stages),
      JSON.stringify(templates),
      item.graph,
    );
  }

  try {
    for (const item of cases) {
      const workflow = new WorkflowRepo().get(item.id);
      assert.deepEqual(workflow?.graph, linearWorkflowToGraph(stages, templates), item.id);
      assert.equal((workflow as any)?.legacyCompatible, true, item.id);
    }
  } finally {
    getDB().prepare(
      `DELETE FROM workflows WHERE id IN (?, ?, ?)`,
    ).run(...cases.map((item) => item.id));
  }
});

test('WorkflowRepo 对非 NULL 且非字符串的 graph 明确报损坏', () => {
  const cases = [
    { id: 'blob-graph-flow', graph: Buffer.from('{"version":1}') },
  ];
  const insert = getDB().prepare(
    `INSERT INTO workflows (
      id, name, description, stages, templates, graph, created_at, updated_at
    ) VALUES (?, ?, NULL, '[]', '{}', ?, 1, 2)`,
  );
  for (const item of cases) {
    insert.run(item.id, '损坏 graph 流程', item.graph);
  }

  try {
    for (const item of cases) {
      assert.throws(
        () => new WorkflowRepo().get(item.id),
        new RegExp(`流程“${item.id}”的 graph 字段损坏：必须是 JSON 字符串`),
        item.id,
      );
    }
  } finally {
    getDB().prepare(
      `DELETE FROM workflows WHERE id = ?`,
    ).run(...cases.map((item) => item.id));
  }
});

test('WorkflowRepo 对损坏 graph JSON 明确报错且不 fallback', () => {
  getDB().prepare(
    `INSERT INTO workflows (
      id, name, description, stages, templates, graph, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'broken-graph-flow',
    '损坏流程',
    null,
    '["prd"]',
    '{}',
    '{bad json',
    1,
    2,
  );

  try {
    assert.throws(
      () => new WorkflowRepo().get('broken-graph-flow'),
      /流程图 JSON 解析失败/,
    );
  } finally {
    getDB().prepare(`DELETE FROM workflows WHERE id = ?`).run('broken-graph-flow');
  }
});

test('WorkflowRepo 对损坏的旧 stages/templates JSON 分别明确报错', () => {
  const cases = [
    {
      id: 'broken-legacy-stages',
      stages: '{bad json',
      templates: '{}',
      error: /流程“broken-legacy-stages”的旧 stages JSON 解析失败/,
    },
    {
      id: 'broken-legacy-templates',
      stages: '[]',
      templates: '{bad json',
      error: /流程“broken-legacy-templates”的旧 templates JSON 解析失败/,
    },
    {
      id: 'invalid-legacy-stages-shape',
      stages: 'null',
      templates: '{}',
      error: /流程“invalid-legacy-stages-shape”的旧 stages 数据损坏：必须是数组/,
    },
    {
      id: 'invalid-legacy-templates-shape',
      stages: '[]',
      templates: '[]',
      error: /流程“invalid-legacy-templates-shape”的旧 templates 数据损坏：必须是对象/,
    },
  ];
  const insert = getDB().prepare(
    `INSERT INTO workflows (
      id, name, description, stages, templates, graph, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, NULL, 1, 2)`,
  );
  for (const item of cases) {
    insert.run(item.id, '损坏旧流程', item.stages, item.templates);
  }

  try {
    for (const item of cases) {
      assert.throws(
        () => new WorkflowRepo().get(item.id),
        item.error,
        item.id,
      );
    }
  } finally {
    getDB().prepare(
      `DELETE FROM workflows WHERE id IN (?, ?, ?, ?)`,
    ).run(...cases.map((item) => item.id));
  }
});

test('WorkflowRepo 完整回读复杂 graph 且不制造旧字段等价投影', () => {
  const cases = [
    { id: 'condition-graph-flow', graph: makeComplexWorkflowGraph() },
    { id: 'approval-graph-flow', graph: makeApprovalWorkflowGraph() },
    { id: 'loop-graph-flow', graph: makeLoopWorkflowGraph() },
    { id: 'duplicate-stage-graph-flow', graph: makeDuplicateStageWorkflowGraph() },
  ];
  const repo = new WorkflowRepo();

  try {
    for (const item of cases) {
      const saved = repo.upsert({
        id: item.id,
        name: '复杂图流程',
        graph: item.graph,
      } as any);
      const row = getDB().prepare(
        `SELECT stages, templates FROM workflows WHERE id = ?`,
      ).get(item.id) as { stages: string; templates: string };

      assert.deepEqual(saved.graph, item.graph, item.id);
      assert.deepEqual(repo.get(item.id)?.graph, item.graph, item.id);
      assert.equal((saved as any).legacyCompatible, false, item.id);
      assert.deepEqual(JSON.parse(row.stages), [], item.id);
      assert.deepEqual(JSON.parse(row.templates), {}, item.id);
    }
  } finally {
    getDB().prepare(
      `DELETE FROM workflows WHERE id IN (?, ?, ?, ?)`,
    ).run(...cases.map((item) => item.id));
  }
});

test('WorkflowRepo 拒绝无效 graph 并透出中文原因', () => {
  const graph = { ...makeWorkflowGraph(), version: 2 };
  assert.throws(
    () => new WorkflowRepo().upsert({
      id: 'invalid-repo-flow',
      name: '无效 Repo 流程',
      graph,
    } as any),
    /流程图版本必须为 1/,
  );
  assert.equal(new WorkflowRepo().get('invalid-repo-flow'), null);
});

test('GET /api/workflows 返回带 graph 的默认公司开发流程', async () => {
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'GET',
      url: '/api/workflows',
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(Array.isArray(body.workflows), true);
    const workflow = body.workflows.find((item: any) => item.id === 'standard');
    assert.equal(workflow?.builtIn, true);
    assert.equal(workflow?.graph?.version, 1);
  } finally {
    await server.app.close();
  }
});

test('POST /api/workflows 保存 graph 且 GET 完整回读', async () => {
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  const graph = makeWorkflowGraph();
  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        id: 'landing-flow',
        name: '落地页流程',
        description: '只跑 PRD 和前端',
        graph,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().workflow.id, 'landing-flow');
    assert.deepEqual(response.json().workflow.graph, graph);

    const list = await server.app.inject({ method: 'GET', url: '/api/workflows' });
    const saved = list.json().workflows.find((item: any) => item.id === 'landing-flow');
    assert.deepEqual(saved?.graph, graph);
  } finally {
    getDB().prepare(`DELETE FROM workflows WHERE id = ?`).run('landing-flow');
    await server.app.close();
  }
});

test('POST 与 GET /api/workflows 对 hostile stage 名返回无损旧投影', async () => {
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  const id = 'api-hostile-stage-flow';
  const graph = makeHostileStageGraph();

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        id,
        name: 'API 特殊阶段名流程',
        graph,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    const posted = response.json().workflow;
    assert.equal(posted.legacyCompatible, true);
    assert.deepEqual(posted.stages, ['__proto__', 'constructor']);

    const list = await server.app.inject({ method: 'GET', url: '/api/workflows' });
    const listed = list.json().workflows.find((item: any) => item.id === id);
    for (const workflow of [posted, listed]) {
      for (const stage of ['__proto__', 'constructor']) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(workflow.templates, stage),
          true,
          stage,
        );
        assert.deepEqual(
          workflow.templates[stage],
          graph.nodes.find((node) => node.type === 'stage' && node.stage === stage)?.templates,
          stage,
        );
      }
    }
  } finally {
    getDB().prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
    await server.app.close();
  }
});

test('POST /api/workflows 拒绝缺失、null、错误版本和断路 graph', async () => {
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  const cases = [
    {
      name: '缺失 graph',
      payload: { id: 'missing-graph', name: '缺失图' },
      error: /流程图必须是对象/,
    },
    {
      name: 'graph 为 null',
      payload: { id: 'null-graph', name: '空图', graph: null },
      error: /流程图必须是对象/,
    },
    {
      name: 'graph 为空字符串',
      payload: { id: 'empty-graph', name: '空字符串图', graph: '' },
      error: /流程图必须是对象/,
    },
    {
      name: 'graph 为空白字符串',
      payload: { id: 'blank-graph', name: '空白字符串图', graph: '   ' },
      error: /流程图必须是对象/,
    },
    {
      name: '错误版本',
      payload: { id: 'wrong-version', name: '错误版本', graph: { ...makeWorkflowGraph(), version: 2 } },
      error: /流程图版本必须为 1/,
    },
    {
      name: '存在断路节点',
      payload: {
        id: 'disconnected-graph',
        name: '断路图',
        graph: {
          ...makeWorkflowGraph(),
          nodes: [
            ...makeWorkflowGraph().nodes,
            { id: 'orphan', type: 'end' },
          ],
        },
      },
      error: /start 无法到达节点/,
    },
  ];

  try {
    for (const item of cases) {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/workflows',
        payload: item.payload,
      });
      assert.equal(response.statusCode, 400, item.name);
      assert.match(response.json().error, item.error, item.name);
    }
  } finally {
    await server.app.close();
  }
});

test('POST /api/workflows 安全处理 __proto__ 和 constructor 节点 ID', async () => {
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  const graph = makeHostileIdGraph();

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        id: 'hostile-id-flow',
        name: '特殊 ID 流程',
        graph,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().workflow.graph, graph);
  } finally {
    getDB().prepare(`DELETE FROM workflows WHERE id = ?`).run('hostile-id-flow');
    await server.app.close();
  }
});

test('POST /api/projects 将条件 graph 交给已接通的图运行时', async () => {
  let createCalls = 0;
  let receivedWorkflow: any;
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      createCalls += 1;
      receivedWorkflow = options.workflow;
      return {
        id: 'project-condition',
        title: options.title,
        boss: options.boss,
        status: 'prd',
        phase: 'prd',
        metadata: {
          workflowId: receivedWorkflow.id,
          workflowName: receivedWorkflow.name,
          workflowSnapshot: structuredClone(receivedWorkflow.graph),
          workflowRuntime: {
            currentNodeId: 'stage-prd',
            nodeRuns: [],
            loopCounts: {},
            schedulerDecisions: [],
          },
        },
        createdAt: 1,
        updatedAt: 1,
      };
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  new WorkflowRepo().upsert({
    id: 'runtime-unsupported-flow',
    name: '旧运行时不支持流程',
    graph: makeComplexWorkflowGraph(),
  } as any);

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '复杂流程项目',
        mode: 'creative',
        workflowId: 'runtime-unsupported-flow',
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(createCalls, 1);
    assert.equal(receivedWorkflow.id, 'runtime-unsupported-flow');
    assert.equal(receivedWorkflow.legacyCompatible, false);
    assert.deepEqual(
      response.json().metadata.workflowSnapshot,
      makeComplexWorkflowGraph(),
    );
  } finally {
    getDB().prepare(`DELETE FROM workflows WHERE id = ?`).run('runtime-unsupported-flow');
    await server.app.close();
  }
});

test('POST /api/projects 对审批流程缺失 Provider 返回中文 400', async () => {
  let createCalls = 0;
  const orchestrator = {
    async createProject() {
      createCalls += 1;
      throw new Error('缺失 Provider 时不应创建项目');
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  new WorkflowRepo().upsert({
    id: 'approval-missing-provider-flow',
    name: '缺少 Provider 的审批流程',
    graph: makeApprovalWorkflowGraph(),
  } as any);

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '审批项目',
        mode: 'creative',
        workflowId: 'approval-missing-provider-flow',
      },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(
      response.json().error,
      /调度器 LLM “scheduler”不存在或不可用/,
    );
    assert.equal(createCalls, 0);
  } finally {
    getDB()
      .prepare('DELETE FROM workflows WHERE id = ?')
      .run('approval-missing-provider-flow');
    await server.app.close();
  }
});

test('POST /api/projects 对 LLM 条件和循环退出条件缺失 Provider 返回首个中文 400', async () => {
  let createCalls = 0;
  const orchestrator = {
    async createProject() {
      createCalls += 1;
      throw new Error('缺失 Provider 时不应创建项目');
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  const graph = makeLoopWorkflowGraph();
  const loop = graph.nodes.find((node) => node.type === 'loop');
  assert.equal(loop?.type, 'loop');
  if (loop?.type !== 'loop') assert.fail('测试流程缺少 loop 节点');
  loop.exitCondition = {
    type: 'llm_judgment',
    providerId: 'missing-loop',
    prompt: '判断是否退出',
  };
  const conditionNode = {
    id: 'condition',
    type: 'condition' as const,
  };
  graph.nodes.splice(1, 0, conditionNode);
  const startEdge = graph.edges.find((edge) => edge.source === 'start');
  assert.ok(startEdge);
  startEdge.target = conditionNode.id;
  graph.edges.push(
    {
      id: 'condition-stage',
      source: conditionNode.id,
      target: 'stage-retry',
      type: 'condition',
      condition: {
        type: 'llm_judgment',
        providerId: 'missing-condition',
        prompt: '判断是否继续',
      },
    },
    {
      id: 'condition-end',
      source: conditionNode.id,
      target: 'end',
      type: 'default',
    },
  );
  new WorkflowRepo().upsert({
    id: 'llm-provider-missing-flow',
    name: '缺失 LLM Provider 流程',
    graph,
  } as any);

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: 'LLM 条件 Provider 项目',
        mode: 'creative',
        workflowId: 'llm-provider-missing-flow',
      },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(
      response.json().error,
      /LLM 判断 Provider “missing-condition”不存在或不可用/,
    );
    assert.equal(createCalls, 0);
  } finally {
    getDB().prepare(
      'DELETE FROM workflows WHERE id = ?',
    ).run('llm-provider-missing-flow');
    await server.app.close();
  }
});

test('PUT 禁用审批 Provider 后 registry 清理且创建审批项目返回中文 400', async () => {
  let createCalls = 0;
  const orchestrator = {
    async createProject() {
      createCalls += 1;
      throw new Error('禁用审批 Provider 后不应创建项目');
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
    updateConfig() {},
  };
  const registry = new LLMRegistry();
  (registry as any).providers.set('scheduler', {
    id: 'scheduler',
    type: 'openai',
  });
  (registry as any).metadata.set('scheduler', {
    source: 'db',
    enabled: true,
    model: 'approval-model',
    type: 'openai',
  });
  const providerRepo = new ProviderRepo();
  providerRepo.upsert({
    id: 'scheduler',
    type: 'openai',
    apiKey: 'sk-test',
    model: 'approval-model',
    enabled: true,
  });
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: registry,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  new WorkflowRepo().upsert({
    id: 'approval-disabled-provider-flow',
    name: '禁用 Provider 的审批流程',
    graph: makeApprovalWorkflowGraph(),
  } as any);

  try {
    const disabled = await server.app.inject({
      method: 'PUT',
      url: '/api/providers/scheduler',
      payload: { enabled: false },
    });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal(disabled.json().enabled, false);
    assert.equal(registry.get('scheduler'), undefined);
    assert.equal(registry.list().some((provider) => provider.id === 'scheduler'), false);
    assert.equal((registry as any).metadata.has('scheduler'), false);

    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '禁用 Provider 审批项目',
        mode: 'creative',
        workflowId: 'approval-disabled-provider-flow',
      },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(
      response.json().error,
      /调度器 LLM “scheduler”不存在或不可用/,
    );
    assert.equal(createCalls, 0);
  } finally {
    getDB()
      .prepare('DELETE FROM workflows WHERE id = ?')
      .run('approval-disabled-provider-flow');
    providerRepo.delete('scheduler');
    await server.app.close();
  }
});

test('POST /api/projects 对合法审批 Provider 放行并传入 Orchestrator', async () => {
  let createCalls = 0;
  let receivedWorkflow: any;
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      createCalls += 1;
      receivedWorkflow = options.workflow;
      return {
        id: 'approval-project',
        title: options.title,
        boss: options.boss,
        status: 'idea',
        phase: 'approval',
        metadata: {
          workflowId: receivedWorkflow.id,
          workflowName: receivedWorkflow.name,
        },
        createdAt: 1,
        updatedAt: 1,
      };
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const schedulerProvider = { id: 'scheduler', type: 'openai' };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: {
      list: () => [{
        id: 'scheduler',
        type: 'openai',
        model: 'approval-model',
        source: 'test',
        enabled: true,
      }],
      get: (id: string) => id === 'scheduler' ? schedulerProvider : undefined,
    } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  new WorkflowRepo().upsert({
    id: 'approval-supported-flow',
    name: '可用审批流程',
    graph: makeApprovalWorkflowGraph(),
  } as any);

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '合法审批项目',
        mode: 'creative',
        workflowId: 'approval-supported-flow',
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(createCalls, 1);
    assert.equal(receivedWorkflow.id, 'approval-supported-flow');
  } finally {
    getDB()
      .prepare('DELETE FROM workflows WHERE id = ?')
      .run('approval-supported-flow');
    await server.app.close();
  }
});

test('POST /api/projects 放开合法循环和重复 stage，损坏 loop 仍返回 400', async () => {
  let createCalls = 0;
  const receivedWorkflowIds: string[] = [];
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      createCalls += 1;
      receivedWorkflowIds.push((options.workflow as { id: string }).id);
      return {
        id: `created-${createCalls}`,
        title: options.title,
        boss: options.boss,
        status: 'idea',
        phase: 'idea',
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      };
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });
  const cases = [
    {
      id: 'loop-project-flow',
      name: '循环流程',
      graph: makeLoopWorkflowGraph(),
    },
    {
      id: 'duplicate-stage-project-flow',
      name: '重复阶段流程',
      graph: makeDuplicateStageWorkflowGraph(),
    },
  ];
  const invalidId = 'invalid-loop-project-flow';

  try {
    for (const item of cases) {
      new WorkflowRepo().upsert({
        id: item.id,
        name: item.name,
        graph: item.graph,
      } as any);
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          title: `${item.name}项目`,
          mode: 'creative',
          workflowId: item.id,
        },
      });
      assert.equal(response.statusCode, 200, item.name);
    }
    assert.equal(createCalls, 2);
    assert.deepEqual(receivedWorkflowIds, cases.map((item) => item.id));

    const invalidGraph = structuredClone(makeLoopWorkflowGraph());
    const invalidLoop = invalidGraph.nodes.find((node) => node.type === 'loop');
    assert.equal(invalidLoop?.type, 'loop');
    if (invalidLoop?.type === 'loop') invalidLoop.maxIterations = 0;
    new WorkflowRepo().upsert({
      id: invalidId,
      name: '损坏循环流程',
      graph: makeLoopWorkflowGraph(),
    } as any);
    getDB().prepare('UPDATE workflows SET graph = ? WHERE id = ?').run(
      JSON.stringify(invalidGraph),
      invalidId,
    );
    const invalidResponse = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '损坏循环项目',
        mode: 'creative',
        workflowId: invalidId,
      },
    });
    assert.equal(invalidResponse.statusCode, 400, invalidResponse.body);
    assert.match(invalidResponse.json().error, /maxIterations.*1-100/);
    assert.equal(createCalls, 2);
  } finally {
    for (const item of cases) {
      getDB().prepare('DELETE FROM workflows WHERE id = ?').run(item.id);
    }
    getDB().prepare('DELETE FROM workflows WHERE id = ?').run(invalidId);
    await server.app.close();
  }
});

test('真实 HTTP/Repo/Orchestrator 保存条件 graph，并为项目保留独立 snapshot/runtime', async () => {
  const context = await makeIntegrationServer();
  const workflowId = 'integration-condition-flow';
  const graph = makeComplexWorkflowGraph();
  let projectId: string | undefined;

  try {
    const saved = await context.server.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        id: workflowId,
        name: '接口条件流程',
        graph,
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);

    const created = await context.server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '接口条件项目',
        mode: 'creative',
        workflowId,
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    projectId = created.json().id;
    const createdMetadata = created.json().metadata;
    assert.deepEqual(createdMetadata.workflowSnapshot, graph);
    assert.equal(createdMetadata.workflowRuntime.currentNodeId, 'condition');
    assert.deepEqual(createdMetadata.workflowRuntime.loopCounts, {});
    assert.deepEqual(createdMetadata.workflowRuntime.schedulerDecisions, []);

    const changedGraph = structuredClone(graph);
    const conditionNode = changedGraph.nodes.find((node) => node.id === 'condition');
    assert.ok(conditionNode);
    conditionNode.name = '保存后修改的条件节点';
    const updated = await context.server.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        id: workflowId,
        name: '接口条件流程',
        graph: changedGraph,
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);

    const detail = await context.server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.deepEqual(detail.json().project.metadata.workflowSnapshot, graph);
    assert.notDeepEqual(
      detail.json().project.metadata.workflowSnapshot,
      updated.json().workflow.graph,
    );
  } finally {
    if (projectId) context.orchestrator.deleteProject(projectId);
    getDB().prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
    await context.server.app.close();
    rmSync(context.companyRoot, { recursive: true, force: true });
  }
});

test('真实 HTTP/Repo/Orchestrator 按 approved/rejected 推进审批 graph', async () => {
  for (const decision of ['approved', 'rejected'] as const) {
    const context = await makeIntegrationServer([
      JSON.stringify({ decision, reason: `${decision} 接口理由` }),
    ]);
    const workflowId = `integration-approval-${decision}`;
    let projectId: string | undefined;

    try {
      const saved = await context.server.app.inject({
        method: 'POST',
        url: '/api/workflows',
        payload: {
          id: workflowId,
          name: `${decision} 审批接口流程`,
          graph: makeApprovalWorkflowGraph(),
        },
      });
      assert.equal(saved.statusCode, 200, saved.body);

      const created = await context.server.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          title: `${decision} 审批接口项目`,
          mode: 'creative',
          workflowId,
        },
      });
      assert.equal(created.statusCode, 200, created.body);
      projectId = created.json().id;

      const ticked = await context.server.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/tick`,
      });
      assert.equal(ticked.statusCode, 200, ticked.body);
      assert.equal(ticked.json().status, 'done');

      const detail = await context.server.app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}`,
      });
      assert.equal(detail.statusCode, 200, detail.body);
      const runtime = detail.json().project.metadata.workflowRuntime as WorkflowRuntimeState;
      const approvalRun = runtime.nodeRuns.find((run) => run.nodeId === 'approval');
      assert.equal(runtime.schedulerDecisions[0]?.decision, decision);
      assert.equal(runtime.schedulerDecisions[0]?.runId, approvalRun?.runId);
      assert.equal(
        runtime.nodeRuns.some((run) => run.nodeId === `stage-${decision}`),
        true,
      );
      assert.deepEqual(
        detail.json().tasks.map((task: any) => task.phase),
        [decision],
      );
      assert.equal(context.schedulerProvider?.calls, 1);
    } finally {
      if (projectId) context.orchestrator.deleteProject(projectId);
      getDB().prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
      await context.server.app.close();
      rmSync(context.companyRoot, { recursive: true, force: true });
    }
  }
});

test('真实 HTTP/Repo/Orchestrator 循环返回后保留 iteration 0/1 的不同任务', async () => {
  const context = await makeIntegrationServer();
  const workflowId = 'integration-loop-flow';
  let projectId: string | undefined;
  const taskRepo = new TaskRepo();
  context.orchestrator.executeTask = async (task) => {
    taskRepo.updateStatus(task.id, 'running');
  };

  try {
    const saved = await context.server.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        id: workflowId,
        name: '接口循环流程',
        graph: makeLoopWorkflowGraph(),
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const created = await context.server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '接口循环项目',
        mode: 'creative',
        workflowId,
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    projectId = created.json().id;

    const first = taskRepo.listByProject(projectId)[0];
    assert.ok(first);
    assert.equal(first.workflowIteration, 0);
    taskRepo.recordResult(first.id, {
      outputFiles: [],
      outputSummary: '继续循环',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    });

    const ticked = await context.server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tick`,
    });
    assert.equal(ticked.statusCode, 200, ticked.body);
    const detail = await context.server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
    });
    const tasks = detail.json().tasks;
    assert.deepEqual(
      tasks.map((task: any) => task.workflowIteration),
      [0, 1],
    );
    assert.notEqual(tasks[0]?.id, tasks[1]?.id);
    assert.equal(tasks[0]?.workflowNodeId, 'stage-retry');
    assert.equal(tasks[1]?.workflowNodeId, 'stage-retry');
  } finally {
    if (projectId) context.orchestrator.deleteProject(projectId);
    getDB().prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
    await context.server.app.close();
    rmSync(context.companyRoot, { recursive: true, force: true });
  }
});

test('真实 HTTP/Repo/Orchestrator 在 loop 达到上限后返回 failed 和中文 runtime error', async () => {
  const context = await makeIntegrationServer();
  const workflowId = 'integration-loop-limit-flow';
  const graph = makeLoopWorkflowGraph();
  const loopNode = graph.nodes.find((node) => node.type === 'loop');
  assert.equal(loopNode?.type, 'loop');
  if (loopNode?.type !== 'loop') assert.fail('测试流程缺少 loop');
  loopNode.maxIterations = 1;
  let projectId: string | undefined;
  const taskRepo = new TaskRepo();
  context.orchestrator.executeTask = async (task) => {
    taskRepo.updateStatus(task.id, 'running');
  };

  try {
    const saved = await context.server.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        id: workflowId,
        name: '接口循环上限流程',
        graph,
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const created = await context.server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '接口循环上限项目',
        mode: 'creative',
        workflowId,
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    projectId = created.json().id;

    const first = taskRepo.listByProject(projectId)[0]!;
    taskRepo.recordResult(first.id, {
      outputFiles: [],
      outputSummary: '继续',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    });
    await context.server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tick`,
    });
    const second = taskRepo
      .listByProject(projectId)
      .find((task) => task.workflowIteration === 1);
    assert.ok(second);
    taskRepo.recordResult(second.id, {
      outputFiles: [],
      outputSummary: '仍未完成',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    });

    const failed = await context.server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tick`,
    });
    assert.equal(failed.statusCode, 200, failed.body);
    assert.equal(failed.json().status, 'failed');
    assert.match(
      failed.json().metadata.workflowRuntime.error,
      /最大循环次数/,
    );
  } finally {
    if (projectId) context.orchestrator.deleteProject(projectId);
    getDB().prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
    await context.server.app.close();
    rmSync(context.companyRoot, { recursive: true, force: true });
  }
});

test('旧 stages/templates 经 GET 转换后可通过真实 Orchestrator 创建项目', async () => {
  const context = await makeIntegrationServer();
  const workflowId = 'integration-legacy-flow';
  let projectId: string | undefined;
  const stages = ['prd'];
  const templates = {
    prd: [{
      phase: 'prd',
      department: 'product',
      assigneeHint: 'product-head',
      title: '旧流程需求',
      promptTemplate: '编写 {{title}}',
      dependsOn: [],
    }],
  };
  getDB().prepare(
    `INSERT INTO workflows (
      id, name, description, stages, templates, graph, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, NULL, 1, 2)`,
  ).run(
    workflowId,
    '旧接口流程',
    JSON.stringify(stages),
    JSON.stringify(templates),
  );

  try {
    const listed = await context.server.app.inject({
      method: 'GET',
      url: '/api/workflows',
    });
    assert.equal(listed.statusCode, 200, listed.body);
    const workflow = listed
      .json()
      .workflows
      .find((item: any) => item.id === workflowId);
    assert.deepEqual(workflow.graph, linearWorkflowToGraph(stages, templates));
    assert.equal(workflow.legacyCompatible, true);

    const created = await context.server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '旧接口流程项目',
        mode: 'creative',
        workflowId,
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    projectId = created.json().id;
    assert.deepEqual(
      created.json().metadata.workflowSnapshot,
      linearWorkflowToGraph(stages, templates),
    );
    assert.equal(new TaskRepo().listByProject(projectId).length, 1);
  } finally {
    if (projectId) context.orchestrator.deleteProject(projectId);
    getDB().prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
    await context.server.app.close();
    rmSync(context.companyRoot, { recursive: true, force: true });
  }
});

test('项目接口对 hostile 或不存在 ID 返回中文 404 而不是 500', async () => {
  const context = await makeIntegrationServer();
  try {
    for (const id of ['__proto__', 'constructor', 'missing/project']) {
      for (const request of [
        { method: 'GET', suffix: '' },
        { method: 'POST', suffix: '/tick' },
        { method: 'POST', suffix: '/say', payload: { content: '继续' } },
        {
          method: 'POST',
          suffix: '/run-to-completion',
          payload: { maxTicks: 1 },
        },
      ]) {
        const response = await context.server.app.inject({
          method: request.method,
          url: `/api/projects/${encodeURIComponent(id)}${request.suffix}`,
          payload: request.payload,
        });
        assert.equal(
          response.statusCode,
          404,
          `${request.method} ${id}${request.suffix}`,
        );
        assert.deepEqual(
          response.json(),
          { error: '项目不存在' },
          `${request.method} ${id}${request.suffix}`,
        );
      }
    }
  } finally {
    await context.server.app.close();
    rmSync(context.companyRoot, { recursive: true, force: true });
  }
});

test('POST /api/projects 明确拒绝 initialTasks 替换新图模板', async () => {
  let createCalls = 0;
  const orchestrator = {
    async createProject() {
      createCalls += 1;
      throw new Error('initialTasks 不应进入 Orchestrator');
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '替换模板项目',
        mode: 'creative',
        initialTasks: [{
          phase: 'prd',
          dept: 'product',
          title: '外部任务',
          prompt: '跳过 snapshot',
          assignee: 'a-product-head',
        }],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: '新图项目不支持 initialTasks，请使用流程 snapshot 中的 stage 模板',
    });
    assert.equal(createCalls, 0);
  } finally {
    await server.app.close();
  }
});

test('POST /api/projects 拒绝没有 agent 的 SOLO 模式', async () => {
  let createCalls = 0;
  const orchestrator = {
    async createProject() {
      createCalls += 1;
      throw new Error('非法 SOLO 请求不应进入 createProject');
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: 'SOLO 项目',
        mode: 'solo',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'SOLO 模式必须选择 Agent' });
    assert.equal(createCalls, 0);
  } finally {
    await server.app.close();
  }
});

test('POST /api/projects 拒绝非法 autoApprove 且不调用 createProject', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'server-project-invalid-'));
  let createCalls = 0;
  const orchestrator = {
    async createProject() {
      createCalls += 1;
      throw new Error('非法请求不应进入 createProject');
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '非法授权模式',
        autoApprove: 'maybe',
      },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'autoApprove 仅支持 always、never 或 prompt',
    });
    assert.equal(createCalls, 0);
  } finally {
    await server.app.close();
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('POST /api/projects 保存附件并把 inputFiles 传给 Orchestrator', async () => {
  const externalDir = mkdtempSync(join(tmpdir(), 'server-project-attachments-'));
  const validatedDir = realpathSync(externalDir);
  let receivedOptions: Record<string, unknown> | undefined;
  const orchestrator = {
    async createProject(options: Record<string, unknown>) {
      receivedOptions = options;
      return {
        id: 'project-with-attachments',
        title: options.title,
        description: options.description,
        boss: options.boss,
        status: 'prd',
        phase: 'prd',
        createdAt: 1,
        updatedAt: 1,
        metadata: {
          workflow: ['prd', 'design', 'dev', 'qa', 'delivery'],
          projectDir: options.projectDir,
        },
      };
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };

  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: externalDir,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: '带附件项目',
        projectDir: externalDir,
        attachments: [
          {
            name: '需求.txt',
            size: Buffer.byteLength('附件内容'),
            contentBase64: Buffer.from('附件内容').toString('base64'),
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      readFileSync(join(validatedDir, '.agent-company', 'attachments', '需求.txt'), 'utf8'),
      '附件内容',
    );
    assert.deepEqual(receivedOptions?.initialInputFiles, [
      '.agent-company/attachments/需求.txt',
    ]);
  } finally {
    await server.app.close();
    rmSync(externalDir, { recursive: true, force: true });
  }
});

  test('POST /api/projects 创建 SOLO 项目时把初始附件路径传给首轮 Agent', async () => {
    const externalDir = mkdtempSync(join(tmpdir(), 'server-solo-initial-attachments-'));
    const validatedDir = realpathSync(externalDir);
    let project: any;
    let userContent = '';
    const orchestrator = {
      async createProject(options: Record<string, unknown>) {
        project = {
          id: 'solo-initial-attachments-project',
          title: options.title,
          description: options.description,
          boss: options.boss,
          status: 'dev',
          phase: 'dev',
          createdAt: 1,
          updatedAt: 1,
          metadata: {
            mode: 'solo',
            soloAgentId: options.projectOwnerAgentId,
            projectDir: options.projectDir,
          },
        };
        return project;
      },
      getProject(id: string) {
        return project && id === project.id ? project : null;
      },
      getEvents() {
        return {};
      },
      bindEvents() {},
    };
    const server = await createServer({
      orchestrator: orchestrator as any,
      llmRegistry: {
        list: () => [],
        get: (id: string) => id === 'p1'
          ? {
              async chat(req: any) {
                const lastUser = [...req.messages].reverse().find((m: any) => m.role === 'user');
                userContent = lastUser?.content ?? '';
                return {
                  text: '已看到初始图片',
                  toolCalls: [],
                  stopReason: 'end_turn',
                  usage: { inputTokens: 3, outputTokens: 4 },
                };
              },
            }
          : undefined,
      } as any,
      companyRoot: externalDir,
      bossName: '球球',
      providerRepo: {} as any,
      configService: {
        agents: () => [{
          id: 'a-vision',
          name: '视觉 Agent',
          department: 'dev',
          role: 'worker',
          llm: 'p1',
          systemPrompt: '你能处理图片',
          tools: [],
        }],
        departments: () => [],
      } as any,
    }, { host: '127.0.0.1', port: 0 });

    try {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          title: 'SOLO 初始图片',
          projectDir: externalDir,
          mode: 'solo',
          agentId: 'a-vision',
          initialMessage: '请先看这张图',
          attachments: [
            {
              name: '初始截图.png',
              size: Buffer.byteLength('initial-png'),
              contentBase64: Buffer.from('initial-png').toString('base64'),
            },
          ],
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(
        readFileSync(join(validatedDir, '.agent-company', 'attachments', '初始截图.png'), 'utf8'),
        'initial-png',
      );
      assert.match(userContent, /请先看这张图/);
      assert.match(userContent, /# 输入文件/);
      assert.match(userContent, /\.agent-company\/attachments\/初始截图\.png/);
    } finally {
      await server.app.close();
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

test('DELETE /api/projects/:id 删除项目记录成功返回 ok', async () => {
  let deletedId: string | undefined;
  const orchestrator = {
    deleteProject(id: string) {
      deletedId = id;
      return true;
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'DELETE',
      url: '/api/projects/project-1',
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
    assert.equal(deletedId, 'project-1');
  } finally {
    await server.app.close();
  }
});

test('DELETE /api/projects/:id 删除不存在项目返回 404', async () => {
  const orchestrator = {
    deleteProject() {
      return false;
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'DELETE',
      url: '/api/projects/missing-project',
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: '项目不存在' });
  } finally {
    await server.app.close();
  }
});

test('POST /api/projects/:id/say 在 SOLO 项目中直接调用所选 agent 并写入回复消息', async () => {
  const project = {
    id: 'solo-say-project',
    title: 'SOLO 对话',
    description: '',
    boss: '球球',
    status: 'dev',
    phase: 'dev',
    createdAt: 1,
    updatedAt: 1,
    metadata: {
      mode: 'solo',
      soloAgentId: 'a-frontend',
    },
  };
  let providerCalled = false;
  const orchestrator = {
    getProject(id: string) {
      return id === project.id ? project : null;
    },
    listTasks() {
      return [];
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: {
      list: () => [],
      get: (id: string) => id === 'p1'
        ? {
            async chat(req: any) {
              providerCalled = true;
              assert.equal(req.messages.some((m: any) => m.role === 'system'), true);
              assert.equal(req.messages.some((m: any) => m.role === 'user' && m.content === '继续开发'), true);
              return {
                text: '已按 SOLO 模式继续开发',
                toolCalls: [],
                stopReason: 'end_turn',
                usage: { inputTokens: 3, outputTokens: 4 },
              };
            },
          }
        : undefined,
    } as any,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [{
        id: 'a-frontend',
        name: '前端小李',
        department: 'dev',
        role: 'worker',
        llm: 'p1',
        systemPrompt: '你是 SOLO 开发 agent',
        tools: [],
      }],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/say`,
      payload: {
        content: '继续开发',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(providerCalled, true);
    assert.equal(response.json().content, '继续开发');

    const detail = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });
    assert.equal(detail.statusCode, 200);
    const messages = detail.json().messages as Array<{ fromId: string; content: string; type: string }>;
    assert.equal(messages.some(m => m.fromId === 'boss' && m.content === '继续开发'), true);
    assert.equal(messages.some(m => m.fromId === 'a-frontend' && m.content === '已按 SOLO 模式继续开发'), true);
  } finally {
    await server.app.close();
  }
});

test('POST /api/projects/:id/say 保存图片附件并把路径传给 SOLO Agent', async () => {
  const externalDir = mkdtempSync(join(tmpdir(), 'server-say-attachments-'));
  const validatedDir = realpathSync(externalDir);
  const project = {
    id: 'solo-say-attachments-project',
    title: 'SOLO 图片对话',
    description: '',
    boss: '球球',
    status: 'dev',
    phase: 'dev',
    createdAt: 1,
    updatedAt: 1,
    metadata: {
      mode: 'solo',
      soloAgentId: 'a-vision-cli',
      projectDir: externalDir,
    },
  };
  let userContent = '';
  const orchestrator = {
    getProject(id: string) {
      return id === project.id ? project : null;
    },
    listTasks() {
      return [];
    },
    getEvents() {
      return {};
    },
    bindEvents() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: {
      list: () => [],
      get: (id: string) => id === 'p1'
        ? {
            async chat(req: any) {
              const lastUser = [...req.messages].reverse().find((m: any) => m.role === 'user');
              userContent = lastUser?.content ?? '';
              return {
                text: '已看到图片',
                toolCalls: [],
                stopReason: 'end_turn',
                usage: { inputTokens: 3, outputTokens: 4 },
              };
            },
          }
        : undefined,
    } as any,
    companyRoot: externalDir,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [{
        id: 'a-vision-cli',
        name: '视觉 CLI',
        department: 'dev',
        role: 'worker',
        llm: 'p1',
        systemPrompt: '你能处理图片',
        tools: [],
      }],
      departments: () => [],
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/say`,
      payload: {
        content: '看看这张图',
        attachments: [
          {
            name: '截图.png',
            size: Buffer.byteLength('png-bytes'),
            contentBase64: Buffer.from('png-bytes').toString('base64'),
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      readFileSync(join(validatedDir, '.agent-company', 'attachments', '截图.png'), 'utf8'),
      'png-bytes',
    );
    assert.match(userContent, /看看这张图/);
    assert.match(userContent, /# 输入文件/);
    assert.match(userContent, /\.agent-company\/attachments\/截图\.png/);
  } finally {
    await server.app.close();
    rmSync(externalDir, { recursive: true, force: true });
  }
});

  test('POST /api/projects/:id/say 运行 SOLO CLI Agent 时使用项目目录作为 cwd', async () => {
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'server-solo-cli-cwd-project-')));
    const companyRoot = mkdtempSync(join(tmpdir(), 'server-solo-cli-cwd-company-'));
    const project = {
      id: 'solo-cli-cwd-project',
      title: 'SOLO CLI cwd',
      description: '',
      boss: '球球',
      status: 'dev',
      phase: 'dev',
      createdAt: 1,
      updatedAt: 1,
      metadata: {
        mode: 'solo',
        soloAgentId: 'a-cli-cwd',
        projectDir,
      },
    };
    const now = Date.now();
    new CustomToolRepo().upsert({
      id: 'pwd-cli',
      name: 'pwd-cli',
      type: 'cli',
      description: 'pwd cli',
      config: {
        command: '/bin/sh',
        argsTemplate: '-c pwd',
        modelsCommand: '-c "printf test-model"',
        modelsParser: { type: 'lines' },
        timeoutMs: 10_000,
      },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const orchestrator = {
      getProject(id: string) {
        return id === project.id ? project : null;
      },
      listTasks() {
        return [];
      },
      getEvents() {
        return {};
      },
      bindEvents() {},
    };
    const server = await createServer({
      orchestrator: orchestrator as any,
      llmRegistry: { list: () => [], get: () => undefined } as any,
      companyRoot,
      bossName: '球球',
      providerRepo: {} as any,
      configService: {
        agents: () => [{
          id: 'a-cli-cwd',
          name: 'CLI cwd Agent',
          department: 'dev',
          role: 'worker',
          llm: '',
          systemPrompt: '',
          tools: [],
          executor: 'cli',
          cliTool: 'pwd-cli',
          cliModel: 'test-model',
        }],
        departments: () => [],
      } as any,
    }, { host: '127.0.0.1', port: 0 });

    try {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/say`,
        payload: {
          content: '检查工作目录',
        },
      });

      assert.equal(response.statusCode, 200, response.body);
      const detail = await server.app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}`,
      });
      assert.equal(detail.statusCode, 200);
      const messages = detail.json().messages as Array<{ fromId: string; content: string }>;
      const reply = messages.find(m => m.fromId === 'a-cli-cwd');
      assert.equal(reply?.content.trim(), projectDir);
    } finally {
      await server.app.close();
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(companyRoot, { recursive: true, force: true });
    }
  });

  test('POST /api/projects/:id/say 压缩 CLI 失败输出但保留退出码和尾部原因', async () => {
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'server-solo-cli-error-project-')));
    const companyRoot = mkdtempSync(join(tmpdir(), 'server-solo-cli-error-company-'));
    const project = {
      id: 'solo-cli-error-project',
      title: 'SOLO CLI error',
      description: '',
      boss: '球球',
      status: 'dev',
      phase: 'dev',
      createdAt: 1,
      updatedAt: 1,
      metadata: {
        mode: 'solo',
        soloAgentId: 'a-cli-error',
        projectDir,
      },
    };
    const now = Date.now();
    new CustomToolRepo().upsert({
      id: 'noisy-error-cli',
      name: 'noisy-error-cli',
      type: 'cli',
      description: 'noisy error cli',
      config: {
        command: '/bin/sh',
        argsTemplate: '-c "i=0; while [ $i -lt 100 ]; do echo noisy-line-$i 1>&2; i=$((i+1)); done; echo actual-cause 1>&2; exit 7"',
        modelsCommand: '-c "printf test-model"',
        modelsParser: { type: 'lines' },
        timeoutMs: 10_000,
      },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const server = await createServer({
      orchestrator: {
        getProject(id: string) {
          return id === project.id ? project : null;
        },
        listTasks() {
          return [];
        },
        getEvents() {
          return {};
        },
        bindEvents() {},
      } as any,
      llmRegistry: { list: () => [], get: () => undefined } as any,
      companyRoot,
      bossName: '球球',
      providerRepo: {} as any,
      configService: {
        agents: () => [{
          id: 'a-cli-error',
          name: 'CLI error Agent',
          department: 'dev',
          role: 'worker',
          llm: '',
          systemPrompt: '',
          tools: [],
          executor: 'cli',
          cliTool: 'noisy-error-cli',
          cliModel: 'test-model',
        }],
        departments: () => [],
      } as any,
    }, { host: '127.0.0.1', port: 0 });

    try {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/say`,
        payload: {
          content: '触发 CLI 失败',
        },
      });

      assert.equal(response.statusCode, 400);
      const error = response.json().error as string;
      assert.ok(error.length <= 800, `前端错误过长: ${error.length}`);
      assert.match(error, /exit 7/);
      assert.match(error, /actual-cause/);
      assert.doesNotMatch(error, /noisy-line-0/);
      assert.match(error, /完整输出已记录到 Server 日志/);
    } finally {
      await server.app.close();
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(companyRoot, { recursive: true, force: true });
    }
  });

test('createServer 未显式传 host 时只监听 loopback', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'server-default-host-'));
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
    updateConfig() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
    } as any,
  }, { port: 0 });

  try {
    const address = server.app.server.address();
    assert.ok(address && typeof address !== 'string');
    assert.equal(address.address, '127.0.0.1');
  } finally {
    await server.app.close();
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('POST /api/departments 允许只用名称和英文名称创建部门', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'server-department-create-'));
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
    updateConfig() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
      merged: () => ({ name: 'Agent Company', boss: '球球', departments: [], agents: [], llmProviders: [] }),
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/departments',
      payload: {
        name: '开发部',
        englishName: 'dev',
        description: '负责软件开发。',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      id: 'dev',
      name: '开发部',
      description: '负责软件开发。',
      head: '',
    });
  } finally {
    await server.app.close();
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('POST /api/departments 隐藏字段缺省时保留旧 head 和 teams', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'server-department-update-'));
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
    updateConfig() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [],
      merged: () => ({ name: 'Agent Company', boss: '球球', departments: [], agents: [], llmProviders: [] }),
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const create = await server.app.inject({
      method: 'POST',
      url: '/api/departments',
      payload: {
        id: 'dev',
        name: '旧开发部',
        head: 'dev-head',
        teams: ['copy'],
      },
    });
    assert.equal(create.statusCode, 200);

    const update = await server.app.inject({
      method: 'POST',
      url: '/api/departments',
      payload: {
        id: 'dev',
        name: '开发部',
        description: '负责软件开发。',
      },
    });
    assert.equal(update.statusCode, 200);
    assert.deepEqual(update.json(), {
      id: 'dev',
      name: '开发部',
      description: '负责软件开发。',
      head: 'dev-head',
      teams: ['copy'],
    });
  } finally {
    await server.app.close();
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('POST /api/agents 允许用显示名和英文名称创建且不需要 team', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'server-agent-create-'));
  const orchestrator = {
    getEvents() {
      return {};
    },
    bindEvents() {},
    updateConfig() {},
  };
  const server = await createServer({
    orchestrator: orchestrator as any,
    llmRegistry: {
      list: () => [{ id: 'openai', model: 'gpt-4o' }],
      get: (id: string) => id === 'openai' ? {} : undefined,
    } as any,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [],
      departments: () => [{ id: 'dev', name: '开发部', head: '' }],
      merged: () => ({ name: 'Agent Company', boss: '球球', departments: [], agents: [], llmProviders: [] }),
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: '前端工程师',
        englishName: 'frontend-dev',
        department: 'dev',
        role: 'worker',
        llm: 'openai',
        systemPrompt: '负责前端。',
        tools: ['read'],
        skills: [],
        executor: 'llm',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      id: 'frontend-dev',
      name: '前端工程师',
      department: 'dev',
      role: 'worker',
      llm: 'openai',
      systemPrompt: '负责前端。',
      tools: ['read'],
      skills: [],
      executor: 'llm',
      enabled: true,
    });
  } finally {
    await server.app.close();
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('旧 POST /api/agents/:id/chat 兼容多轮 CLI 历史且不创建项目工作目录', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'server-cli-chat-cwd-'));
  const now = Date.now();
  new CustomToolRepo().upsert({
    id: 'chat-cwd-cli',
    name: 'chat-cwd-cli',
    type: 'cli',
    description: 'chat cwd cli',
    config: {
      command: '/bin/echo',
      argsTemplate: '{prompt:q}',
      modelsCommand: 'model-a',
      modelsParser: { type: 'lines' },
      timeoutMs: 10_000,
    },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  const agent = {
    id: 'cli-chat-agent',
    name: 'CLI 对话 Agent',
    department: 'dev',
    role: 'worker',
    llm: '',
    systemPrompt: '',
    tools: [],
    executor: 'cli',
    cliTool: 'chat-cwd-cli',
    cliModel: 'model-a',
  };
  const server = await createServer({
    orchestrator: { getEvents: () => ({}), bindEvents: () => {}, updateConfig() {} } as any,
    llmRegistry: { list: () => [], get: () => undefined } as any,
    companyRoot,
    bossName: '球球',
    providerRepo: {} as any,
    configService: {
      agents: () => [agent],
      departments: () => [{ id: 'dev', name: '开发部', head: '' }],
      merged: () => ({ name: 'Agent Company', boss: '球球', departments: [], agents: [agent], llmProviders: [] }),
    } as any,
  }, { host: '127.0.0.1', port: 0 });

  try {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/agents/cli-chat-agent/chat',
      payload: {
        messages: [
          { role: 'user', content: '上一条问题' },
          { role: 'assistant', content: '上一条回答' },
          { role: 'user', content: '当前问题' },
        ],
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true, JSON.stringify(body));
    assert.equal(body.executor, 'cli');
    assert.equal(body.text.trim(), [
      '[user] 上一条问题',
      '[assistant] 上一条回答',
      '[user] 当前问题',
    ].join('\n'));
    assert.equal(existsSync(join(companyRoot, 'projects')), false, '组织架构对话不应创建项目目录');
  } finally {
    await server.app.close();
    rmSync(companyRoot, { recursive: true, force: true });
  }
});
