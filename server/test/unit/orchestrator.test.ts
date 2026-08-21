import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { closeDB } from '../../src/store/db.js';
import { freshDB, cleanupDB } from '../helpers/db.js';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { LLMRegistry } from '../../src/llm/registry.js';
import { TaskRepo } from '../../src/store/repository.js';
import { WorkflowNodeOutputRepo } from '../../src/store/workflowNodeOutputs.js';
import type {
  CompanyConfig,
  WorkflowDefinition,
} from '../../src/types/company.js';
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from '../../src/llm/types.js';
import type { WorkflowGraph } from '../../src/workflows/model.js';

let dbDir: string;
let dbPath: string;
let companyRoot: string;

before(() => {
  ({ dir: dbDir, path: dbPath } = freshDB());
  companyRoot = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
});

after(() => {
  rmSync(companyRoot, { recursive: true, force: true });
  cleanupDB(dbDir, dbPath);
});

beforeEach(() => {
  const db = new Database(dbPath);
  for (const table of [
    'workflow_node_outputs',
    'messages',
    'agent_status',
    'deliverables',
    'tasks',
    'projects',
    'custom_tools',
    'llm_providers',
    'departments',
    'agents',
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.close();
});

function makeCompany(): CompanyConfig {
  return {
    name: '测试公司',
    boss: '球球',
    description: '',
    departments: [{ id: 'dev', name: '研发', head: 'a-dev' }],
    agents: [
      {
        id: 'a-dev',
        name: '开发 Agent',
        department: 'dev',
        role: 'worker',
        llm: 'p1',
        systemPrompt: '',
        tools: [],
      },
      {
        id: 'a-judge',
        name: '判断 Agent',
        department: 'dev',
        role: 'worker',
        llm: 'p1',
        systemPrompt: '',
        tools: [],
      },
    ],
    llm_providers: [
      { id: 'p1', type: 'openai', apiKey: 'sk-test', model: 'test-model' } as any,
    ],
  };
}

class ScriptedProvider implements LLMProvider {
  readonly id = 'p1';
  readonly type = 'openai' as const;
  readonly requests: ChatRequest[] = [];

  constructor(private readonly responses: string[]) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const text = this.responses.shift();
    if (!text) throw new Error('测试 Agent 判断缺少响应');
    return {
      text,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async *stream(): AsyncIterable<never> {
    return;
  }
}

function makeOrchestrator(responses: string[] = []): {
  orchestrator: Orchestrator;
  provider: ScriptedProvider;
} {
  const registry = new LLMRegistry();
  const provider = new ScriptedProvider(responses);
  (registry as any).providers.set('p1', provider);
  (registry as any).metadata.set('p1', {
    source: 'test',
    enabled: true,
    model: 'test-model',
    type: 'openai',
  });
  return {
    orchestrator: new Orchestrator(registry, makeCompany(), companyRoot),
    provider,
  };
}

function workflow(id: string, name: string, graph: WorkflowGraph): WorkflowDefinition {
  return {
    id,
    name,
    description: '',
    stages: [],
    templates: {},
    graph,
    legacyCompatible: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function stage(
  id: string,
  name: string,
  agentId = 'a-dev',
  inputNodeIds: string[] = [],
) {
  return {
    id,
    type: 'stage' as const,
    stage: id,
    name,
    description: `${name}说明`,
    agentId,
    inputNodeIds,
    prompt: `${name}提示词`,
  };
}

function makeSingleStageWorkflow(agentId = 'a-dev'): WorkflowDefinition {
  return workflow('single-stage', '单 Agent 阶段', {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      stage('build', '构建功能', agentId),
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start-build', source: 'start', target: 'build', type: 'default' },
      { id: 'build-end', source: 'build', target: 'end', type: 'default' },
    ],
  });
}

function makeConditionalWorkflow(): WorkflowDefinition {
  return workflow('conditional', '条件 Agent 判断', {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      stage('prepare', '准备输入'),
      {
        id: 'condition',
        type: 'condition',
        name: '是否继续',
        description: '由判断 Agent 选择出口',
        inputNodeIds: ['prepare'],
      },
      stage('matched', '命中后执行', 'a-dev', ['prepare']),
      { id: 'fallback', type: 'end' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start-prepare', source: 'start', target: 'prepare', type: 'default' },
      { id: 'prepare-condition', source: 'prepare', target: 'condition', type: 'default' },
      {
        id: 'condition-matched',
        source: 'condition',
        target: 'matched',
        type: 'condition',
        condition: {
          type: 'llm_judgment',
          agentId: 'a-judge',
          prompt: '输入满足继续条件时选择命中出口',
          inputNodeIds: ['prepare'],
        },
      },
      { id: 'condition-fallback', source: 'condition', target: 'fallback', type: 'default' },
      { id: 'matched-end', source: 'matched', target: 'end', type: 'default' },
    ],
  });
}

function makeLoopWorkflow(): WorkflowDefinition {
  return workflow('paired-loop', '配对循环', {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'review-start', type: 'loop_start', loopId: 'review', maxIterations: 3 },
      stage('review-stage', '循环评审'),
      {
        id: 'review-end',
        type: 'loop_end',
        loopId: 'review',
        startNodeId: 'review-start',
        name: '循环是否结束',
        description: '由判断 Agent 决定继续或结束',
        inputNodeIds: ['review-stage'],
        exitCondition: {
          type: 'llm_judgment',
          agentId: 'a-judge',
          prompt: '评审完成时决定循环继续或结束',
          inputNodeIds: ['review-stage'],
        },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start-loop', source: 'start', target: 'review-start', type: 'default' },
      { id: 'loop-stage', source: 'review-start', target: 'review-stage', type: 'default' },
      { id: 'stage-loop-end', source: 'review-stage', target: 'review-end', type: 'default' },
      { id: 'loop-back', source: 'review-end', target: 'review-start', type: 'loop_back' },
      { id: 'loop-exit', source: 'review-end', target: 'end', type: 'default' },
    ],
  });
}

function holdNewTasks(orchestrator: Orchestrator): void {
  orchestrator.executeTask = async (task) => {
    new TaskRepo().updateStatus(task.id, 'running');
  };
}

async function completeCurrentTask(
  orchestrator: Orchestrator,
  projectId: string,
  outputSummary: string,
) {
  const task = new TaskRepo()
    .listByProject(projectId)
    .find((item) => item.status === 'pending' || item.status === 'running');
  assert.ok(task, '缺少当前阶段任务');
  new TaskRepo().recordResult(task.id, {
    outputFiles: [],
    outputSummary,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  });
  return orchestrator.tick(projectId);
}

async function createLoopProject(
  orchestrator: Orchestrator,
  title: string,
) {
  const project = await orchestrator.createProject({
    title,
    boss: '球球',
    workflow: makeLoopWorkflow(),
  });
  await orchestrator.tick(project.id);
  return project;
}

test('createProject:单 Agent 阶段仅创建一条内部任务', async () => {
  const { orchestrator } = makeOrchestrator();
  const project = await orchestrator.createProject({
    title: '单阶段项目',
    boss: '球球',
    workflow: makeSingleStageWorkflow(),
  });

  const tasks = new TaskRepo().listByProject(project.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.workflowNodeId, 'build');
  assert.equal(tasks[0]?.assignee, 'a-dev');
  assert.match(tasks[0]?.prompt ?? '', /构建功能提示词/);
});

test('tick:条件 Agent 判断命中条件出口并写入控制结果', async () => {
  const { orchestrator, provider } = makeOrchestrator([
    '输入符合继续条件\n[[匹配: 是]]',
  ]);
  holdNewTasks(orchestrator);
  const project = await orchestrator.createProject({
    title: '条件命中项目',
    boss: '球球',
    workflow: makeConditionalWorkflow(),
  });

  const advanced = await completeCurrentTask(orchestrator, project.id, '准备完成');
  const outputs = new WorkflowNodeOutputRepo().listByProject(project.id);
  const conditionOutput = outputs.find((item) => item.workflowNodeId === 'condition');

  assert.equal(advanced.phase, 'matched');
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(conditionOutput?.controlResult, { type: 'condition', matched: true });
  assert.deepEqual(
    conditionOutput?.inputSnapshot.map((input) => input.outputText),
    ['【准备输入】\n准备完成'],
  );
});

test('tick:条件 Agent 判断未命中时走默认出口', async () => {
  const { orchestrator, provider } = makeOrchestrator([
    '输入不满足继续条件\n[[匹配: 否]]',
  ]);
  holdNewTasks(orchestrator);
  const project = await orchestrator.createProject({
    title: '条件默认项目',
    boss: '球球',
    workflow: makeConditionalWorkflow(),
  });

  const completed = await completeCurrentTask(orchestrator, project.id, '准备失败');

  assert.equal(completed.status, 'done');
  assert.equal(completed.phase, 'prepare');
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(
    new TaskRepo().listByProject(project.id).map((task) => task.workflowNodeId),
    ['prepare'],
  );
});

test('tick:配对循环判断继续时创建下一轮任务并写入控制结果', async () => {
  const { orchestrator } = makeOrchestrator([
    '继续完善评审结果\n[[循环: 继续]]',
  ]);
  holdNewTasks(orchestrator);
  const project = await createLoopProject(orchestrator, '循环继续项目');

  const advanced = await completeCurrentTask(orchestrator, project.id, '第一轮结果');
  const tasks = new TaskRepo().listByProject(project.id);
  const loopOutput = new WorkflowNodeOutputRepo()
    .listByProject(project.id)
    .find((item) => item.workflowNodeId === 'review-end' && item.iteration === 0);

  assert.equal(advanced.status, 'idea');
  assert.deepEqual(tasks.map((task) => task.workflowIteration), [0, 1]);
  assert.equal(tasks[1]?.workflowNodeId, 'review-stage');
  assert.deepEqual(loopOutput?.controlResult, { type: 'loop', action: 'continue' });
});

test('tick:配对循环判断结束时走默认出口', async () => {
  const { orchestrator } = makeOrchestrator([
    '评审已完成\n[[循环: 结束]]',
  ]);
  holdNewTasks(orchestrator);
  const project = await createLoopProject(orchestrator, '循环结束项目');

  const completed = await completeCurrentTask(orchestrator, project.id, '第一轮已完成');
  const loopOutput = new WorkflowNodeOutputRepo()
    .listByProject(project.id)
    .find((item) => item.workflowNodeId === 'review-end');

  assert.equal(completed.status, 'done');
  assert.deepEqual(
    new TaskRepo().listByProject(project.id).map((task) => task.workflowIteration),
    [0],
  );
  assert.deepEqual(loopOutput?.controlResult, { type: 'loop', action: 'end' });
});

test('tick:配对循环达到上限时结束且不创建额外任务', async () => {
  const { orchestrator } = makeOrchestrator([
    '继续\n[[循环: 继续]]',
    '继续\n[[循环: 继续]]',
    '继续\n[[循环: 继续]]',
    '仍请求继续\n[[循环: 继续]]',
  ]);
  holdNewTasks(orchestrator);
  const project = await createLoopProject(orchestrator, '循环上限项目');

  await completeCurrentTask(orchestrator, project.id, '第零轮');
  await completeCurrentTask(orchestrator, project.id, '第一轮');
  await completeCurrentTask(orchestrator, project.id, '第二轮');
  const completed = await completeCurrentTask(orchestrator, project.id, '第三轮');

  assert.equal(completed.status, 'done');
  assert.deepEqual(
    new TaskRepo().listByProject(project.id).map((task) => task.workflowIteration),
    [0, 1, 2, 3],
  );
});

test('tick:循环判断仅接收当前轮次输入', async () => {
  const { orchestrator } = makeOrchestrator([
    '第一轮需要继续\n[[循环: 继续]]',
    '第二轮可以结束\n[[循环: 结束]]',
  ]);
  holdNewTasks(orchestrator);
  const project = await createLoopProject(orchestrator, '循环输入隔离项目');

  await completeCurrentTask(orchestrator, project.id, '第一轮独有输出');
  await completeCurrentTask(orchestrator, project.id, '第二轮独有输出');

  const loopOutputs = new WorkflowNodeOutputRepo()
    .listByProject(project.id)
    .filter((item) => item.workflowNodeId === 'review-end')
    .sort((left, right) => left.iteration - right.iteration);
  assert.deepEqual(
    loopOutputs.map((item) => item.inputSnapshot[0]?.outputText),
    ['【循环评审】\n第一轮独有输出', '【循环评审】\n第二轮独有输出'],
  );
});

test('createProject:不可用 Agent 返回中文错误', async () => {
  const { orchestrator } = makeOrchestrator();

  await assert.rejects(
    orchestrator.createProject({
      title: '不可用 Agent 项目',
      boss: '球球',
      workflow: makeSingleStageWorkflow('missing-agent'),
    }),
    /阶段节点“build”引用的 Agent “missing-agent”不存在或未启用/,
  );
});
