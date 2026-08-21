import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { AgentRuntime, type AgentEvent } from '../agent/runtime.js';
import { ProjectRepo, TaskRepo, AgentStatusRepo, MessageRepo, DeliverableRepo } from '../store/repository.js';
import { WorkflowNodeOutputRepo } from '../store/workflowNodeOutputs.js';
import { getDB } from '../store/db.js';
import { LLMRegistry } from '../llm/registry.js';
import type {
  CompanyConfig,
  Project,
  Task,
  ProjectStatus,
  AgentConfig,
  ChatMessage,
  WorkflowNodeRunStatus,
  WorkflowRuntimeState,
  WorkflowNodeRun,
  WorkflowNodeOutputInput,
} from '../types/company.js';
import {
  DEFAULT_WORKFLOW,
  STANDARD_WORKFLOW,
  generateTasksFromTemplates,
} from './templates.js';
import { validateWorkflowGraph } from '../workflows/graph.js';
import type {
  WorkflowConditionContext,
  WorkflowGraph,
  WorkflowNode,
} from '../workflows/model.js';
import {
  createWorkflowRuntime,
  resolveNextNodeAsync,
  resolveNextNode,
} from '../workflows/runtime.js';
import {
  createAgentDecisionRunner,
  type AgentDecisionRunner,
} from '../workflows/agentDecisionRunner.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Orchestrator 事件
 */
export interface OrchestratorEvents {
  onProjectUpdate?: (p: Project) => void;
  onTaskUpdate?: (t: Task) => void;
  onAgentEvent?: (e: AgentEvent) => void;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  onMessage?: (msg: import('../types/company.js').ChatMessage) => void;
}

/**
 * Orchestrator - 调度器
 *
 * Phase 2 增强:
 * - 自动生成 phase 任务(模板系统)
 * - phase 完成后自动派下一 phase
 * - QA 决定(APPROVE/REJECT)智能处理
 * - 全流程跑完自动标 done
 */
export class Orchestrator {
  private agentRuntime: AgentRuntime;
  private projectRepo = new ProjectRepo();
  private taskRepo = new TaskRepo();
  private statusRepo = new AgentStatusRepo();
  private messageRepo = new MessageRepo();
  private deliverableRepo = new DeliverableRepo();
  private nodeOutputRepo = new WorkflowNodeOutputRepo();

  private companyConfig: CompanyConfig;
  private companyRoot: string;
  private events: OrchestratorEvents;
  private agentDecisionRunner: AgentDecisionRunner;
  /** 项目级 context 缓存(prd 内容等) */
  private projectContext = new Map<string, { prd?: string; design?: string; codeSummary?: string; testReport?: string }>();

  constructor(
    private llmRegistry: LLMRegistry,
    companyConfig: CompanyConfig,
    companyRoot: string,
    events: OrchestratorEvents = {},
    agentDecisionRunner?: AgentDecisionRunner,
  ) {
    this.companyConfig = companyConfig;
    this.companyRoot = companyRoot;
    this.events = events;
    this.agentDecisionRunner = agentDecisionRunner
      ?? createAgentDecisionRunner({
        llmRegistry,
        getAgent: (id) => this.companyConfig.agents.find((agent) => agent.id === id),
      });
    this.agentRuntime = new AgentRuntime(llmRegistry, companyRoot);
    this.agentRuntime.subscribe((e) => this.events.onAgentEvent?.(e));
  }

  private validateWorkflowProviders(graph: WorkflowGraph): void {
    for (const node of graph.nodes) {
      if (node.type === 'stage') this.requireWorkflowAgent(node.agentId ?? '', `阶段节点“${node.id}”`);
      if (node.type === 'condition') {
        for (const edge of graph.edges) {
          if (edge.source !== node.id || edge.type !== 'condition') continue;
          if (edge.condition.type === 'llm_judgment') {
            this.requireWorkflowAgent(edge.condition.agentId ?? '', `条件出口“${edge.id}”`);
            }
        }
      }
      if (node.type === 'loop_end' && node.exitCondition.type === 'llm_judgment') {
        this.requireWorkflowAgent(node.exitCondition.agentId ?? '', `循环判断节点“${node.id}”`);
      }
    }
  }

  private requireWorkflowAgent(agentId: string, label: string): void {
    const agent = this.companyConfig.agents.find(item => item.id === agentId);
    if (!agent || agent.enabled === false) throw new Error(`${label}引用的 Agent “${agentId}”不存在或未启用`);
    const metadata = this.llmRegistry.list().find(item => item.id === agent.llm);
    if (!this.llmRegistry.get(agent.llm) || !metadata?.enabled) {
      throw new Error(`${label}引用的 Agent “${agentId}”的 LLM “${agent.llm}”不存在或不可用`);
    }
  }

  private applyDefaultWorkflowAgents(graph: WorkflowGraph): void {
    const defaultAgent = this.companyConfig.agents.find((agent) => agent.enabled !== false);
    if (!defaultAgent) return;
    for (const node of graph.nodes) {
      if (node.type === 'stage' && !node.agentId?.trim()) {
        node.agentId = defaultAgent.id;
      }
    }
  }

  updateConfig(cfg: CompanyConfig): void {
    this.companyConfig = cfg;
  }

  getEvents(): OrchestratorEvents {
    return this.events;
  }

  bindEvents(events: OrchestratorEvents): void {
    this.events = events;
  }

  /**
   * 创建项目
   * Phase 2 增强:预生成所有 phase 的任务(pending),让 tick 自己推进
   */
  async createProject(opts: {
    title: string;
    description?: string;
    boss: string;
    mode?: 'creative' | 'solo';
    /**
     * 球球 review 2026-08-16:ChatInputBox 让球球选 agent 作为项目 owner
     * 所有 phase 的 task assignee 都覆盖成该 agent(它用的 LLM 从 agent.llm 拿)
     */
    projectOwnerAgentId?: string;
    projectDir?: string;
    thinking?: boolean;
    autoApprove?: 'always' | 'never' | 'prompt';
    initialMessage?: string;
    initialInputFiles?: string[];
    initialTasks?: Array<{ phase: string; dept: string; title: string; prompt: string; assignee: string }>;
    workflow?: import('../types/company.js').WorkflowDefinition;
  }): Promise<Project> {
    if (opts.mode === 'solo' && !opts.projectOwnerAgentId) {
      throw new Error('SOLO 模式必须选择 Agent');
    }
    const isSolo = opts.mode === 'solo';
    if (!isSolo && opts.initialTasks !== undefined) {
      throw new Error(
        '新图项目不支持 initialTasks，请使用流程 snapshot 中的 stage 模板',
      );
    }
    const id = `proj-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const workflow = opts.workflow ?? DEFAULT_WORKFLOW;
    let workflowSnapshot: WorkflowGraph | undefined;
    let workflowRuntime: WorkflowRuntimeState | undefined;
    let initialWorkflowNode: WorkflowNode | undefined;
    if (!isSolo) {
      workflowSnapshot = structuredClone(workflow.graph);
      this.applyDefaultWorkflowAgents(workflowSnapshot);
      validateWorkflowGraph(workflowSnapshot);
        this.validateWorkflowProviders(workflowSnapshot);
      workflowRuntime = createWorkflowRuntime(workflowSnapshot);
      const startNode = workflowSnapshot.nodes.find(
        (node) => node.id === workflowRuntime!.currentNodeId,
      );
      if (!startNode) {
        throw new Error(`流程图节点“${workflowRuntime.currentNodeId}”不存在`);
      }
      this.enterWorkflowNode(workflowRuntime, startNode);
      const transition = resolveNextNode(workflowSnapshot, startNode.id, {});
      this.finishWorkflowNode(workflowRuntime, 'completed');
      if (transition) {
        initialWorkflowNode = transition.targetNode;
        this.enterWorkflowNode(workflowRuntime, initialWorkflowNode);
          if (initialWorkflowNode.type === 'stage') {
            this.prepareWorkflowStageTaskIds(
              id,
              workflowRuntime,
              initialWorkflowNode,
            );
          }
        if (initialWorkflowNode.type === 'end') {
          this.finishWorkflowNode(workflowRuntime, 'completed');
        }
      }
    }
    const initialMessage = typeof opts.initialMessage === 'string'
      ? opts.initialMessage.trim()
      : '';
    const initialPhase = isSolo
      ? 'dev'
      : initialWorkflowNode?.type === 'stage'
        ? initialWorkflowNode.stage
        : initialWorkflowNode?.id ?? 'idea';
    const initialStatus = isSolo
      ? 'dev'
      : initialWorkflowNode?.type === 'end'
        ? 'done'
        : 'idea';
    const project = this.projectRepo.create({
      id,
      title: opts.title,
      description: opts.description,
      boss: opts.boss,
      status: initialStatus,
      phase: initialPhase,
      metadata: {
        ...(!isSolo ? {
          workflowId: workflow.id,
          workflowName: workflow.name,
          workflowSnapshot,
          workflowRuntime,
        } : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(isSolo && opts.projectOwnerAgentId ? { soloAgentId: opts.projectOwnerAgentId } : {}),
        ...(opts.projectOwnerAgentId ? { projectOwnerAgentId: opts.projectOwnerAgentId } : {}),
        ...(opts.projectDir ? { projectDir: opts.projectDir } : {}),
        ...(typeof opts.thinking === 'boolean' ? { thinking: opts.thinking } : {}),
        ...(opts.autoApprove ? { autoApprove: opts.autoApprove } : {}),
      },
    });

    if (!isSolo && workflowRuntime && workflowSnapshot) {
      const startRun = workflowRuntime.nodeRuns.find((run) => run.nodeId === 'start');
      if (!startRun) throw new Error('开始节点缺少运行记录');
      this.nodeOutputRepo.createRunning({
        projectId: id,
        workflowNodeId: 'start',
        workflowNodeType: 'start',
        runId: startRun.runId,
        iteration: 0,
        inputSnapshot: [],
        createdAt: startRun.startedAt,
      });
      this.nodeOutputRepo.complete(id, startRun.runId, {
        outputText: initialMessage,
        outputTaskIds: [],
        outputFileRefs: opts.initialInputFiles ?? [],
      });
    }

    // 建项目目录
    const projectDir = this.projectDirectory(id);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    mkdirSync(join(projectDir, 'design'), { recursive: true });
    mkdirSync(join(projectDir, 'server'), { recursive: true });
    mkdirSync(join(projectDir, 'docs'), { recursive: true });

    this.log('info', `📁 项目 ${id} 创建: ${opts.title}`);

    if (isSolo) {
      this.messageRepo.create({
        id: randomUUID(),
        projectId: id,
        channel: 'general',
        fromId: 'system',
        fromName: '调度员',
        fromRole: 'HR/Meta',
        content: `🎉 SOLO 模式项目已创建: **${opts.title}**\n当前只由 Agent **${opts.projectOwnerAgentId}** 连续对话开发,不会生成完整任务链路。`,
        type: 'system',
        mentions: [],
      });
      const latest = this.projectRepo.get(id)!;
      this.events.onProjectUpdate?.(latest);
      return latest;
    }

    const initialInputFiles = opts.initialInputFiles ?? [];
    const initialTasks = initialWorkflowNode?.type === 'stage'
      ? this.createWorkflowStageTasks(
          project,
          initialWorkflowNode,
            workflowRuntime!,
          initialMessage,
          initialInputFiles,
        )
      : [];

    // 系统消息
    const stageNames = workflowSnapshot!.nodes
      .filter((node): node is Extract<WorkflowNode, { type: 'stage' }> => (
        node.type === 'stage'
      ))
      .map((node) => node.stage);
    this.messageRepo.create({
      id: randomUUID(),
      projectId: id,
      channel: 'general',
      fromId: 'system',
      fromName: '调度员',
      fromRole: 'HR/Meta',
      content: `🎉 项目已创建: **${opts.title}**\n工作流: ${stageNames.join(' → ')}\n已自动生成 ${initialTasks.length} 个任务,准备进入 **${initialPhase} 阶段**。`,
      type: 'system',
      mentions: [],
    });

    this.events.onProjectUpdate?.(this.projectRepo.get(id)!);
    return project;
  }

  private createWorkflowStageTasks(
    project: Project,
    node: Extract<WorkflowNode, { type: 'stage' }>,
    runtime: WorkflowRuntimeState,
    initialMessage = '',
    initialInputFiles: string[] = [],
    loopTaskContext = '',
  ): Task[] {
    // 球球 review 2026-08-16:如果项目指定了 owner agent,所有 phase 的 task 都覆盖 assignee
    // (owner 用自己的 llm 推动整个项目,其他 agent 的部门职责由 orchestrator 后续调度)
    const expectedIds = this.prepareWorkflowStageTaskIds(
      project.id,
      runtime,
      node,
    );
    const currentRun = this.currentWorkflowNodeRun(runtime);
    const iteration = currentRun.iteration ?? runtime.currentIteration;
    if (!Number.isSafeInteger(iteration) || iteration < 0) {
      throw new Error(`节点“${node.id}”的工作流轮次无效`);
    }
    const inputSnapshot = this.resolveStageInputs(project.id, node, iteration);
    this.nodeOutputRepo.createRunning({
      projectId: project.id,
      workflowNodeId: node.id,
      workflowNodeType: 'stage',
      runId: currentRun.runId,
      iteration,
      inputSnapshot,
      createdAt: currentRun.startedAt,
    });
    const contextPrompt = this.buildStageContextPrompt(inputSnapshot, node.prompt ?? '');
    return expectedIds.map((taskId, index) => {
      if (!taskId) {
        throw new Error(
          `节点“${node.id}”的第 ${index + 1} 个任务缺少稳定 ID`,
        );
      }
      const existing = this.taskRepo.get(taskId);
      if (existing) {
        if (
          existing.projectId !== project.id
          || existing.workflowNodeId !== node.id
          || existing.workflowIteration !== iteration
        ) {
          throw new Error(`任务“${taskId}”的工作流归属冲突`);
        }
        return existing;
      }
        const promptParts = [contextPrompt];
        const stagePrompt = node.prompt?.trim();
        if (stagePrompt) promptParts.push(stagePrompt);
        if (index === 0 && initialMessage) {
          promptParts.push(`老板的初始对话:\n${initialMessage}`);
        }
        if (loopTaskContext) {
          promptParts.push(loopTaskContext);
        }
        return this.taskRepo.create({
        id: taskId,
        projectId: project.id,
        phase: node.stage,
        workflowNodeId: node.id,
        workflowIteration: iteration,
        department: this.companyConfig.agents.find(agent => agent.id === node.agentId)?.department ?? '',
        assignee: node.agentId ?? '',
        title: node.name?.trim() || node.stage,
          prompt: promptParts.join('\n\n'),
        status: 'pending',
        inputFiles: [...initialInputFiles],
        outputFiles: [],
        dependsOn: [],
        attempts: 0,
        maxAttempts: 3,
        cost: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      });
    });
  }

  private resolveStageInputs(
    projectId: string,
    node: Extract<WorkflowNode, { type: 'stage' }>,
    iteration: number,
  ): WorkflowNodeOutputInput[] {
    return this.resolveNodeInputs(projectId, node.inputNodeIds ?? [], iteration);
  }

  private resolveNodeInputs(
    projectId: string,
    inputNodeIds: string[],
    iteration: number,
  ): WorkflowNodeOutputInput[] {
    return inputNodeIds.map((sourceNodeId) => {
      const output = this.nodeOutputRepo.findLatestCompleted(
        projectId,
        sourceNodeId,
        iteration,
      );
      if (!output) {
        throw new Error(
          iteration > 0
            ? `节点“${sourceNodeId}”在当前第 ${iteration} 轮没有可用的成功输出`
            : `节点“${sourceNodeId}”没有可用的成功输出`,
        );
      }
      return {
        sourceNodeId,
        sourceRunId: output.runId,
        sourceName: this.workflowNodeLabel(projectId, sourceNodeId),
        outputText: output.outputText,
        outputFileRefs: [...output.outputFileRefs],
      };
    });
  }

  private workflowNodeLabel(
    projectId: string,
    nodeId: string,
  ): string {
    if (nodeId === 'start') return '开始';
    const project = this.projectRepo.get(projectId);
    const node = project ? this.workflowState(project)?.graph.nodes.find(
      (candidate) => candidate.id === nodeId,
    ) : null;
    if (!node) return nodeId;
    if (node.type === 'stage') return node.name?.trim() || node.stage;
    return node.id;
  }

  private buildStageContextPrompt(
    inputs: WorkflowNodeOutputInput[],
    nodePrompt: string,
  ): string {
    const received = inputs.length === 0 ? '' : [
      '已接收的节点信息：',
      ...inputs.map((input) => [
        `【${input.sourceName}】`,
        input.outputText || '（无文本输出）',
        input.outputFileRefs.length > 0
          ? `关联产出：\n${input.outputFileRefs.join('\n')}`
          : '',
      ].filter(Boolean).join('\n')),
    ].join('\n\n');
    return [received, nodePrompt.trim()].filter(Boolean).join('\n\n');
  }

  private aggregateStageOutput(tasks: Task[]): {
    outputText: string;
    outputTaskIds: string[];
    outputFileRefs: string[];
  } {
    return {
      outputText: tasks.map((task) => (
        `【${task.title}】\n${task.outputSummary || '（无文本输出）'}`
      )).join('\n\n'),
      outputTaskIds: tasks.map((task) => task.id),
      outputFileRefs: [...new Set(tasks.flatMap((task) => task.outputFiles))],
    };
  }

  private createPassiveNodeOutput(
    projectId: string,
    runtime: WorkflowRuntimeState,
    node: WorkflowNode,
  ): void {
    if (node.type === 'start' || node.type === 'stage') return;
    const run = this.currentWorkflowNodeRun(runtime);
    const inputNodeIds = node.type === 'condition' || node.type === 'loop_end'
      ? node.inputNodeIds ?? []
      : [];
    this.nodeOutputRepo.createRunning({
      projectId,
      workflowNodeId: node.id,
      workflowNodeType: node.type,
      runId: run.runId,
      iteration: run.iteration ?? runtime.currentIteration,
      inputSnapshot: this.resolveNodeInputs(
        projectId,
        inputNodeIds,
        run.iteration ?? runtime.currentIteration,
      ),
      createdAt: run.startedAt,
    });
  }

  private completePassiveNodeOutput(
    projectId: string,
    runtime: WorkflowRuntimeState,
    node: WorkflowNode,
    outputText: string,
    controlResult?: import('../types/company.js').WorkflowNodeControlResult,
  ): void {
    if (node.type === 'start' || node.type === 'stage') return;
    const run = this.currentWorkflowNodeRun(runtime);
    if (!this.nodeOutputRepo.getByRun(projectId, run.runId)) {
      this.createPassiveNodeOutput(projectId, runtime, node);
    }
    this.nodeOutputRepo.complete(projectId, run.runId, {
      outputText,
      outputTaskIds: [],
      outputFileRefs: [],
      controlResult,
    });
  }

  private workflowState(
    project: Project,
  ): { graph: WorkflowGraph; runtime: WorkflowRuntimeState } | null {
    const snapshot = project.metadata?.workflowSnapshot;
    if (snapshot === undefined) return null;
    validateWorkflowGraph(snapshot as WorkflowGraph);

    const runtime = project.metadata?.workflowRuntime;
    if (
      typeof runtime !== 'object'
      || runtime === null
      || Array.isArray(runtime)
      || typeof (runtime as WorkflowRuntimeState).currentNodeId !== 'string'
      || !Array.isArray((runtime as WorkflowRuntimeState).nodeRuns)
      || typeof (runtime as WorkflowRuntimeState).loopCounts !== 'object'
      || (runtime as WorkflowRuntimeState).loopCounts === null
      || !Array.isArray((runtime as WorkflowRuntimeState).schedulerDecisions)
    ) {
      throw new Error(`项目“${project.id}”的工作流运行状态无效`);
    }
    const typedRuntime = runtime as WorkflowRuntimeState;
    if (typedRuntime.currentIteration === undefined) {
      typedRuntime.currentIteration = 0;
    }
    if (
      !Number.isSafeInteger(typedRuntime.currentIteration)
      || typedRuntime.currentIteration < 0
      || Object.values(typedRuntime.loopCounts).some(
        (count) => !Number.isSafeInteger(count) || count < 0,
      )
      || (
        typedRuntime.loopContext !== undefined
        && (
          typeof typedRuntime.loopContext !== 'object'
          || typedRuntime.loopContext === null
          || Array.isArray(typedRuntime.loopContext)
        )
      )
    ) {
      throw new Error(`项目“${project.id}”的工作流轮次状态无效`);
    }
    return {
      graph: snapshot as WorkflowGraph,
      runtime: typedRuntime,
    };
  }

  private enterWorkflowNode(
    runtime: WorkflowRuntimeState,
    node: WorkflowNode,
  ): void {
    const runId = randomUUID();
    runtime.currentNodeId = node.id;
    runtime.currentRunId = runId;
    runtime.nodeRuns.push({
      runId,
      nodeId: node.id,
      nodeType: node.type,
      iteration: runtime.currentIteration,
      status: 'running',
      startedAt: Date.now(),
    });
  }

  private currentWorkflowNodeRun(
    runtime: WorkflowRuntimeState,
  ): WorkflowNodeRun {
    const runId = runtime.currentRunId;
    if (!runId) {
      throw new Error(`节点“${runtime.currentNodeId}”缺少当前运行记录`);
    }
    let currentRun = runtime.nodeRuns[runtime.nodeRuns.length - 1];
    if (!currentRun || currentRun.runId !== runId) {
      currentRun = runtime.nodeRuns.find((run) => run.runId === runId);
    }
    if (!currentRun) {
      throw new Error(`节点“${runtime.currentNodeId}”的运行记录不存在`);
    }
    return currentRun;
  }

  private prepareWorkflowStageTaskIds(
    projectId: string,
    runtime: WorkflowRuntimeState,
    node: Extract<WorkflowNode, { type: 'stage' }>,
  ): string[] {
    const currentRun = this.currentWorkflowNodeRun(runtime);
    if (currentRun.nodeId !== node.id || currentRun.nodeType !== 'stage') {
      throw new Error(`节点“${node.id}”与当前运行记录不一致`);
    }
    const nodeRuns = runtime.nodeRuns.filter((run) => run.nodeId === node.id);
    const runIndex = nodeRuns.findIndex((run) => run.runId === currentRun.runId);
    if (runIndex < 0) {
      throw new Error(`节点“${node.id}”的运行序号不存在`);
    }
    const iteration = currentRun.iteration ?? runtime.currentIteration;
    if (!Number.isSafeInteger(iteration) || iteration < 0) {
      throw new Error(`节点“${node.id}”的工作流轮次无效`);
    }
    if (currentRun.iteration === undefined) {
      currentRun.iteration = iteration;
    } else if (currentRun.iteration !== runtime.currentIteration) {
      throw new Error(`节点“${node.id}”的运行轮次与当前上下文不一致`);
    }
      const expectedIds = [0].map((templateIndex) => {
      const digest = createHash('sha256')
        .update(JSON.stringify([
          projectId,
          node.id,
          iteration,
          runIndex,
          templateIndex,
        ]))
        .digest('hex')
        .slice(0, 24);
      return `task-${digest}`;
    });
    if (currentRun.outputRefs === undefined) {
      currentRun.outputRefs = [...expectedIds];
    } else if (
      currentRun.outputRefs.length !== expectedIds.length
      || currentRun.outputRefs.some((id, index) => id !== expectedIds[index])
    ) {
      throw new Error(`节点“${node.id}”的期望任务引用无效`);
    }
    return expectedIds;
  }

  private finishWorkflowNode(
    runtime: WorkflowRuntimeState,
    status: WorkflowNodeRunStatus,
    outputRefs?: string[],
    error?: string,
  ): void {
    const currentRun = this.currentWorkflowNodeRun(runtime);
    currentRun.status = status;
    currentRun.completedAt = Date.now();
    if (outputRefs) currentRun.outputRefs = [...outputRefs];
    if (error) currentRun.error = error;
    delete runtime.currentRunId;
  }

  private persistWorkflowRuntime(
    projectId: string,
    runtime: WorkflowRuntimeState,
  ): void {
    const project = this.projectRepo.get(projectId);
    if (!project) throw new Error(`项目“${projectId}”不存在`);
    const metadata = {
      ...project.metadata,
      workflowRuntime: structuredClone(runtime),
    };
    getDB()
      .prepare('UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(metadata), Date.now(), projectId);
  }

  private persistWorkflowProjectState(
    projectId: string,
    runtime: WorkflowRuntimeState,
    status: ProjectStatus,
    phase: string,
  ): void {
    const project = this.projectRepo.get(projectId);
    if (!project) throw new Error(`项目“${projectId}”不存在`);
    const metadata = {
      ...project.metadata,
      workflowRuntime: structuredClone(runtime),
    };
    getDB()
      .prepare(
        `UPDATE projects
         SET metadata = ?, status = ?, phase = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(metadata),
        status,
        phase,
        Date.now(),
        projectId,
      );
  }

  private completeProject(
    projectId: string,
    phase: string,
    runtime?: WorkflowRuntimeState,
  ): Project {
    if (runtime) {
      this.persistWorkflowProjectState(projectId, runtime, 'done', phase);
    } else {
      this.projectRepo.updateStatus(projectId, 'done', phase);
    }
    this.messageRepo.create({
      id: randomUUID(),
      projectId,
      channel: 'general',
      fromId: 'system',
      fromName: '调度员',
      content: `🎉 项目完成!所有产物已归档到 ${this.projectDirectory(projectId)}`,
      type: 'system',
      mentions: [],
    });
    this.log('info', `✅ 项目 ${projectId} 完成`);
    const completed = this.projectRepo.get(projectId)!;
    this.events.onProjectUpdate?.(completed);
    return completed;
  }

  private async resolveWorkflowTransition(
    project: Project,
    graph: WorkflowGraph,
    runtime: WorkflowRuntimeState,
    node: WorkflowNode,
    context: WorkflowConditionContext,
  ) {
    return resolveNextNodeAsync(
      graph,
      node.id,
      context,
      runtime,
      {
        matches: async (condition) => {
          const result = await this.agentDecisionRunner.decide({
          agentId: condition.agentId ?? '',
          mode: node.type === 'loop_end' ? 'loop' : 'condition',
          prompt: condition.prompt,
          receivedInputs: this.resolveNodeInputs(
            project.id,
            condition.inputNodeIds ?? [],
            runtime.currentIteration,
          ),
          project: {
            id: project.id,
            title: project.title,
            status: project.status,
            phase: project.phase,
          },
          iteration: runtime.currentIteration,
          });
          const control = result.controlResult;
          const matched = control.type === 'condition'
            ? control.matched
            : control.action === 'end';
          return { matched, reason: result.outputText, controlResult: control };
        },
      },
    );
  }

  private serialLoopTaskContext(
    project: Project,
    _node: Extract<WorkflowNode, { type: 'loop_start' }>,
    context: WorkflowConditionContext,
    iteration: number,
  ): string {
    return [
      '# 串行循环任务上下文',
      `项目：${project.title}`,
      `项目描述：${project.description ?? ''}`,
      `第 ${iteration} 轮`,
      `上一轮输出：${context.output ?? ''}`,
      `项目上下文：${JSON.stringify(this.projectContext.get(project.id) ?? {})}`,
    ].join('\n');
  }

  private async advanceWorkflow(
    project: Project,
    graph: WorkflowGraph,
    runtime: WorkflowRuntimeState,
    context: WorkflowConditionContext,
    status: WorkflowNodeRunStatus = 'completed',
    outputRefs: string[] = [],
  ): Promise<Project> {
    let currentNode: WorkflowNode | undefined = graph.nodes.find(
      (node) => node.id === runtime.currentNodeId,
    );
    if (!currentNode) {
      throw new Error(`流程图节点“${runtime.currentNodeId}”不存在`);
    }
    if (currentNode.type === 'end') {
      if (runtime.currentRunId) {
        this.createPassiveNodeOutput(project.id, runtime, currentNode);
        this.completePassiveNodeOutput(project.id, runtime, currentNode, '流程结束');
        this.finishWorkflowNode(runtime, 'completed');
      }
      return this.completeProject(project.id, project.phase, runtime);
    }

    let currentStatus = status;
    let currentOutputRefs = outputRefs;
    let nextLoopTaskContext = '';
    while (true) {
      let transition: ReturnType<typeof resolveNextNode>;
        try {
          transition = await this.resolveWorkflowTransition(
            project,
            graph,
            runtime,
            currentNode,
            context,
          );
        } catch (error) {
          if (
            currentNode.type !== 'condition'
            && currentNode.type !== 'loop_end'
          ) {
            throw error;
          }
          const failureReason = errorMessage(error);
          const failedRun = this.currentWorkflowNodeRun(runtime);
          failedRun.reason = failureReason;
          this.finishWorkflowNode(runtime, 'failed', [], failureReason);
          runtime.error = failureReason;
          this.persistWorkflowProjectState(
            project.id,
            runtime,
            'failed',
            project.phase,
          );
          this.log(
            'error',
            `项目 ${project.id} 工作流节点失败：${failureReason}`,
          );
          const failedProject = this.projectRepo.get(project.id);
          if (!failedProject) {
            throw new Error(`项目“${project.id}”不存在`);
          }
          this.events.onProjectUpdate?.(failedProject);
          return failedProject;
        }
      const loopNode = currentNode;
      if (
        loopNode
        && loopNode.type === 'loop_end'
        && transition
      ) {
        if (
          transition.loopCounts === undefined
          || transition.iteration === undefined
        ) {
          throw new Error(`循环节点“${loopNode.id}”缺少轮次转移结果`);
        }
        runtime.loopCounts = { ...transition.loopCounts };
        runtime.currentIteration = transition.iteration;
        if (transition.edge.type === 'loop_back') {
          const loopStart = graph.nodes.find(
            (node): node is Extract<WorkflowNode, { type: 'loop_start' }> => (
              node.id === loopNode.startNodeId && node.type === 'loop_start'
            ),
          );
          if (!loopStart) {
            throw new Error(`循环判断节点“${loopNode.id}”找不到循环开始节点`);
          }
          nextLoopTaskContext = this.serialLoopTaskContext(
            project,
            loopStart,
            context,
            transition.iteration,
          );
        }
        delete runtime.loopContext;
      }
        const transitionReason = transition?.reason;
        if (transitionReason) {
        this.currentWorkflowNodeRun(runtime).reason = transitionReason;
      }
        this.completePassiveNodeOutput(
          project.id,
          runtime,
          currentNode,
          [
            `节点类型：${currentNode.type}`,
            transition ? `命中边：${transition.edge.id}` : '流程结束',
            transitionReason ? `原因：${transitionReason}` : '',
          ].filter(Boolean).join('\n'),
            transition?.controlResult,
        );
        this.finishWorkflowNode(
          runtime,
          currentStatus,
          currentOutputRefs,
        );
      if (!transition) {
        return this.completeProject(project.id, project.phase, runtime);
      }

      currentNode = transition.targetNode;
      this.enterWorkflowNode(runtime, currentNode);
      this.createPassiveNodeOutput(project.id, runtime, currentNode);
      if (currentNode.type === 'condition') {
        currentStatus = 'completed';
        currentOutputRefs = [];
        continue;
      }
      if (currentNode.type === 'loop_start') {
        currentStatus = 'completed';
        currentOutputRefs = [];
        continue;
      }
      if (currentNode.type === 'loop_end') {
        currentStatus = 'completed';
        currentOutputRefs = [];
        runtime.loopContext = structuredClone(context);
        this.persistWorkflowRuntime(project.id, runtime);
        continue;
      }
      if (currentNode.type === 'end') {
        this.completePassiveNodeOutput(project.id, runtime, currentNode, '流程结束');
        this.finishWorkflowNode(runtime, 'completed');
        return this.completeProject(project.id, project.phase, runtime);
      }
      if (currentNode.type === 'stage') {
        this.prepareWorkflowStageTaskIds(
          project.id,
          runtime,
          currentNode,
        );
        this.persistWorkflowProjectState(
          project.id,
          runtime,
          'idea',
          currentNode.stage,
        );
        this.createWorkflowStageTasks(
          project,
          currentNode,
          runtime,
          '',
          [],
          nextLoopTaskContext,
        );
        this.messageRepo.create({
          id: randomUUID(),
          projectId: project.id,
          channel: 'general',
          fromId: 'system',
          fromName: '调度员',
          content: `➡️  进入 phase: **${currentNode.stage}**`,
          type: 'system',
          mentions: [],
        });
        this.log('info', `项目 ${project.id} → phase ${currentNode.stage}`);
        return this.tick(project.id);
      }

      this.persistWorkflowRuntime(project.id, runtime);
    }
  }

  /**
   * 推进项目 - 找下一个可执行的任务,跑它
   */
  async tick(projectId: string): Promise<Project> {
    let project = this.projectRepo.get(projectId);
    if (!project) throw new Error('Project not found');
    if (project.metadata?.mode === 'solo') {
      throw new Error('SOLO 模式不支持任务推进');
    }
    if (project.status === 'done' || project.status === 'failed') return project;

    const workflowState = this.workflowState(project);
    let currentPhase = project.phase;
    let currentStageTasks: Task[] | null = null;
    if (workflowState) {
      const currentNode = workflowState.graph.nodes.find(
        (node) => node.id === workflowState.runtime.currentNodeId,
      );
      if (!currentNode) {
        throw new Error(
          `流程图节点“${workflowState.runtime.currentNodeId}”不存在`,
        );
      }
      if (currentNode.type !== 'stage') {
        const context = currentNode.type === 'loop_end'
          ? {
              ...(workflowState.runtime.loopContext ?? {}),
            }
          : {};
        return this.advanceWorkflow(
          project,
          workflowState.graph,
          workflowState.runtime,
          context,
        );
      }
      currentPhase = currentNode.stage;
        if (!workflowState.runtime.currentRunId) {
          const terminalRun = [...workflowState.runtime.nodeRuns]
            .reverse()
            .find((run) => run.nodeId === currentNode.id);
          if (terminalRun?.status === 'failed') {
            this.persistWorkflowProjectState(
              project.id,
              workflowState.runtime,
              'failed',
              currentPhase,
            );
            this.log('warn', `项目 ${projectId} 在 phase ${currentPhase} 失败`);
            const recovered = this.projectRepo.get(project.id);
            if (!recovered) throw new Error(`项目“${project.id}”不存在`);
            this.events.onProjectUpdate?.(recovered);
            return recovered;
        }
        }
      if (project.status !== 'idea' || project.phase !== currentPhase) {
        this.projectRepo.updateStatus(project.id, 'idea', currentPhase);
        const recovered = this.projectRepo.get(project.id);
        if (!recovered) throw new Error(`项目“${project.id}”不存在`);
        project = recovered;
      }
      const currentRun = this.currentWorkflowNodeRun(workflowState.runtime);
      const hadExpectedIds = currentRun.outputRefs !== undefined;
        this.prepareWorkflowStageTaskIds(
          project.id,
          workflowState.runtime,
        currentNode,
      );
      if (!hadExpectedIds) {
        this.persistWorkflowRuntime(project.id, workflowState.runtime);
      }
        currentStageTasks = this.createWorkflowStageTasks(
          project,
          currentNode,
          workflowState.runtime,
        );
    }

    // 找当前 phase 的 pending 任务(还没跑的)
    const allTasks = this.taskRepo.listByProject(projectId);
    const phaseTasks = currentStageTasks
      ?? allTasks.filter((task) => task.phase === currentPhase);

    // 1. 检查当前 phase 是否有 pending 任务
    const pendingTasks = phaseTasks.filter((task) => task.status === 'pending');
    if (pendingTasks.length > 0) {
      const task = pendingTasks[0]!;
      await this.executeTask(task);
      return this.afterTask(projectId, task);
    }

    // 2. 看是否有正在运行(等它完成)
    const running = phaseTasks.filter((task) => task.status === 'running');
    if (running.length > 0) return project;

    // 3. 当前 phase 全完成
    const allDone = phaseTasks.every((t) => t.status === 'done');
    const anyFailed = phaseTasks.some((t) => t.status === 'failed');

    if (anyFailed && !allDone) {
      if (workflowState) {
        const currentNode = workflowState.graph.nodes.find(
          (node) => node.id === workflowState.runtime.currentNodeId,
        );
        if (!currentNode) {
          throw new Error(
            `流程图节点“${workflowState.runtime.currentNodeId}”不存在`,
            );
          }
        const currentRun = this.currentWorkflowNodeRun(workflowState.runtime);
        this.nodeOutputRepo.fail(
          projectId,
          currentRun.runId,
          phaseTasks
            .map((task) => task.error)
            .filter((error): error is string => typeof error === 'string')
            .join('\n') || '阶段任务执行失败',
        );
        const transition = resolveNextNode(
          workflowState.graph,
          currentNode.id,
          {},
        );
        if (
          transition?.targetNode.type === 'condition'
          || transition?.targetNode.type === 'loop_start'
          || transition?.targetNode.type === 'loop_end'
        ) {
          return this.advanceWorkflow(
            project,
            workflowState.graph,
            workflowState.runtime,
            {
              output: phaseTasks
                .map((task) => task.outputSummary ?? task.error ?? '')
                .join('\n'),
            },
            'failed',
            phaseTasks.map((task) => task.id),
          );
        }
        this.finishWorkflowNode(
          workflowState.runtime,
          'failed',
          phaseTasks.map((task) => task.id),
          phaseTasks
            .map((task) => task.error)
            .filter((error): error is string => typeof error === 'string')
            .join('\n'),
        );
          this.persistWorkflowProjectState(
            projectId,
            workflowState.runtime,
            'failed',
            currentPhase,
          );
      }
      this.log('warn', `项目 ${projectId} 在 phase ${currentPhase} 失败`);
        if (!workflowState) {
          this.projectRepo.updateStatus(
            projectId,
            'failed' as ProjectStatus,
            currentPhase,
          );
        }
      this.events.onProjectUpdate?.(this.projectRepo.get(projectId)!);
      return this.projectRepo.get(projectId)!;
    }

    if (allDone) {
      if (workflowState) {
        const currentRun = this.currentWorkflowNodeRun(workflowState.runtime);
        this.nodeOutputRepo.complete(
          projectId,
          currentRun.runId,
          this.aggregateStageOutput(phaseTasks),
        );
        return this.advanceWorkflow(
          project,
          workflowState.graph,
          workflowState.runtime,
          {
            output: phaseTasks
              .map((task) => task.outputSummary ?? '')
              .join('\n'),
          },
          'completed',
          phaseTasks.map((task) => task.id),
        );
      }
      // 4. 推进到下一 phase
      const nextPhase = this.nextPhase(project, currentPhase);
      if (!nextPhase) {
        return this.completeProject(projectId, currentPhase);
      }

      // 推进 phase
      this.projectRepo.updateStatus(projectId, nextPhase as ProjectStatus, nextPhase);
      this.messageRepo.create({
        id: randomUUID(),
        projectId,
        channel: 'general',
        fromId: 'system',
        fromName: '调度员',
        content: `➡️  进入 phase: **${nextPhase}**`,
        type: 'system',
        mentions: [],
      });
      this.log('info', `项目 ${projectId} → phase ${nextPhase}`);

      // 立即启动下一 phase
      return this.tick(projectId);
    }

    return project;
  }

  /**
   * 任务完成后:处理 QA 打回 / 收集 context
   */
  private async afterTask(projectId: string, task: Task): Promise<Project> {
    const updated = this.taskRepo.get(task.id);
    if (!updated) return this.projectRepo.get(projectId)!;

    // 收集 context(供下一 phase 用)
    if (task.phase === 'prd' && updated.status === 'done') {
      const prdContent = this.readProjectFile(projectId, 'prd.md');
      this.projectContext.set(projectId, { ...(this.projectContext.get(projectId) ?? {}), prd: prdContent });
    }
    if (task.phase === 'design' && updated.status === 'done') {
      const designContent = this.readProjectFile(projectId, 'design/proposal.md');
      this.projectContext.set(projectId, { ...(this.projectContext.get(projectId) ?? {}), design: designContent });
    }
    if (task.phase === 'dev' && updated.status === 'done') {
      // 收集 dev 阶段所有 done 任务的 summary
      const ctx = this.projectContext.get(projectId) ?? {};
      const devTasks = this.taskRepo.listByProject(projectId).filter(t => t.phase === 'dev' && t.status === 'done');
      const summaries = devTasks.map(t => `${t.department}: ${t.outputSummary ?? ''}`).join(' | ');
      this.projectContext.set(projectId, { ...ctx, codeSummary: summaries });
    }

    // QA 决定处理
    const project = this.projectRepo.get(projectId);
    if (
      project?.metadata?.workflowSnapshot === undefined
      && task.phase === 'qa'
      && updated.status === 'done'
    ) {
      const decision = this.parseQADecision(projectId);
      this.log('info', `QA 决定: ${decision.status} - ${decision.reason}`);

      if (decision.status === 'REJECT') {
        // 打回:找到 dev 阶段对应 agent,创建新任务修复
        const devTasks = this.taskRepo.listByProject(projectId).filter(t => t.phase === 'dev');
        const lastDevTask = devTasks[0];
        if (lastDevTask) {
          // 创建修复任务
          this.taskRepo.create({
            id: `task-${randomUUID().slice(0, 8)}`,
            projectId,
            phase: 'dev',
            workflowIteration: 0,
            department: lastDevTask.department,
            assignee: lastDevTask.assignee,
            title: `🔧 修复 QA 问题`,
            prompt: `QA 拒绝了上一次的交付,需要修复:\n\n${decision.reason}\n\n请修复后重新提交。完成后用 [SUMMARY] 写一行修复了什么。`,
            status: 'pending',
            inputFiles: [],
            outputFiles: [],
            dependsOn: [],
            attempts: 0,
            maxAttempts: 3,
            cost: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
          });
          this.taskRepo.updateStatus(task.id, 'blocked');
          // 把当前 phase 切回 dev
          this.projectRepo.updateStatus(projectId, 'dev' as ProjectStatus, 'dev');
          this.messageRepo.create({
            id: randomUUID(),
            projectId,
            channel: 'general',
            fromId: 'system',
            fromName: '调度员',
            content: `🔴 QA 打回,回到 **dev 阶段** 修复:\n${decision.reason}`,
            type: 'system',
            mentions: ['dev'],
          });
          // 立即启动修复
          return this.tick(projectId);
        }
      } else {
        this.projectContext.set(projectId, { ...(this.projectContext.get(projectId) ?? {}), testReport: decision.report });
      }
    }

    this.events.onTaskUpdate?.(updated);
    this.events.onProjectUpdate?.(this.projectRepo.get(projectId)!);

    // 递归 tick:看 phase 状态
    return this.tick(projectId);
  }

  private readProjectFile(projectId: string, filename: string): string {
    const path = join(this.projectDirectory(projectId), filename);
    if (!existsSync(path)) return '';
    try {
      return readFileSync(path, 'utf-8').slice(0, 10000);
    } catch {
      return '';
    }
  }

  /**
   * 解析 QA 决定
   */
  private parseQADecision(projectId: string): { status: 'APPROVE' | 'REJECT'; reason: string; report: string } {
    const reportPath = join(this.projectDirectory(projectId), 'test-report.md');
    let content = '';
    if (existsSync(reportPath)) {
      try {
        content = readFileSync(reportPath, 'utf-8');
      } catch {}
    }
    if (!content) {
      // 从 task outputFiles 中找
      const qaTask = this.taskRepo.listByProject(projectId).find(t => t.phase === 'qa' && t.status === 'done');
      if (qaTask?.outputSummary) content = qaTask.outputSummary;
    }

    const isReject = /\bREJECT\b/i.test(content) || /❌/.test(content);
    const status = isReject ? 'REJECT' : 'APPROVE';
    const reasonMatch = content.match(/\*\*理由\*\*[::]\s*(.+?)(?:\n|$)/);
    const reason = reasonMatch?.[1]?.trim() ?? (isReject ? '测试不通过' : '所有测试通过');
    return { status, reason, report: content };
  }

  /** 跑一个任务 */
  async executeTask(task: Task): Promise<void> {
    const agent = this.companyConfig.agents.find((a) => a.id === task.assignee);
    if (!agent) {
      this.log('error', `Agent not found: ${task.assignee}`);
      this.taskRepo.updateStatus(task.id, 'failed');
      return;
    }
    const projectDir = this.projectDirectory(task.projectId);
    this.log('info', `▶️  执行任务 ${task.id} by ${agent.id}: ${task.title}`);
    // 球球 review 2026-08-16:thinking / autoApprove 从 project metadata 读,透传到 AgentRuntime
    const project = this.projectRepo.get(task.projectId);
    const opts = {
      thinking: project?.metadata?.thinking !== false,  // 默认 true
      autoApprove: (project?.metadata?.autoApprove as 'always' | 'never' | 'prompt' | undefined) ?? 'always',
    };
    const result = await this.agentRuntime.runTask(task, agent, projectDir, `project:${task.projectId}`, opts);
    this.events.onTaskUpdate?.(this.taskRepo.get(task.id)!);
    this.log(
      result.success ? 'info' : 'error',
      result.success
        ? `✅ 任务 ${task.id} 完成 (${result.inputTokens}+${result.outputTokens} tokens)`
        : `❌ 任务 ${task.id} 失败: ${result.error}`,
    );
  }

  private projectDirectory(projectId: string): string {
    const configured = this.projectRepo.get(projectId)?.metadata?.projectDir;
    if (
      typeof configured === 'string'
      && configured.trim() !== ''
      && isAbsolute(configured)
    ) {
      return configured;
    }
    return join(this.companyRoot, 'projects', projectId);
  }

  // ─── 业务查询 ───

  listAgents(): AgentConfig[] {
    return this.companyConfig.agents;
  }

  getCompanyConfig(): CompanyConfig {
    return this.companyConfig;
  }

  getProject(id: string): Project | null {
    return this.projectRepo.get(id);
  }

  listProjects(): Project[] {
    return this.projectRepo.list();
  }

  deleteProject(id: string): boolean {
    return this.projectRepo.delete(id);
  }

  listTasks(projectId: string): Task[] {
    return this.taskRepo.listByProject(projectId);
  }

  listMessages(projectId: string): ChatMessage[] {
    return this.messageRepo.listByProject(projectId);
  }

  getStatusReport(): Array<{
    agentId: string;
    status: 'idle' | 'busy' | 'offline';
    currentTaskId?: string;
    lastActiveAt: number;
  }> {
    return this.statusRepo.getAll();
  }

  /** 跑完当前所有 phase(批量,模拟老板跑完整项目) */
  async runToCompletion(projectId: string, maxTicks: number = 50): Promise<Project> {
    let project = this.projectRepo.get(projectId);
    let ticks = 0;
    while (project && project.status !== 'done' && project.status !== 'failed' && ticks < maxTicks) {
      project = await this.tick(projectId);
      ticks++;
    }
    return this.projectRepo.get(projectId)!;
  }

  private nextPhase(project: Project, current: string): string | null {
    const workflow = Array.isArray(project.metadata?.workflow)
      ? project.metadata.workflow.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : STANDARD_WORKFLOW;
    const idx = workflow.indexOf(current);
    if (idx === -1 || idx === workflow.length - 1) return null;
    return workflow[idx + 1] ?? null;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.events.onLog?.(level, msg);
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️ ' : '  ';
    console.log(`[orchestrator] ${prefix} ${msg}`);
  }
}
