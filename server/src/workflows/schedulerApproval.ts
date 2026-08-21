import type { LLMRegistry } from '../llm/registry.js';
import type {
  ProjectStatus,
  WorkflowNodeRun,
} from '../types/company.js';
import type { WorkflowGraph } from './model.js';

const FORMAT_ERROR_PREFIX = '审批结果格式不正确：';
const MAX_REASON_LENGTH = 1000;

export interface SchedulerApprovalResult {
  decision: 'approved' | 'rejected';
  reason: string;
}

export interface SchedulerApprovalInput {
  providerId: string;
  schedulerNodeId: string;
  nodeRunId: string;
  prompt?: string;
  project: {
    id: string;
    title: string;
    description?: string;
    boss: string;
    status: ProjectStatus;
    phase: string;
  };
  workflowSnapshot: WorkflowGraph;
  completedNodeRuns: WorkflowNodeRun[];
  taskOutputs: Array<{
    id: string;
    phase: string;
    title: string;
    status: string;
    outputSummary?: string;
    outputFiles: string[];
    error?: string;
  }>;
}

export interface SchedulerApprovalRunner {
  decide(input: SchedulerApprovalInput): Promise<SchedulerApprovalResult>;
}

function formatError(detail: string): Error {
  return new Error(`${FORMAT_ERROR_PREFIX}${detail}`);
}

export function parseSchedulerApproval(text: string): SchedulerApprovalResult {
  if (typeof text !== 'string' || !text.trim()) {
    throw formatError('必须提供非空 JSON 文本');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw formatError('必须是完整对象文本');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw formatError('必须是 JSON 对象');
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2
    || !Object.prototype.hasOwnProperty.call(record, 'decision')
    || !Object.prototype.hasOwnProperty.call(record, 'reason')
  ) {
    throw formatError('只能包含 decision 和 reason 两个自有字段');
  }

  const decision = record.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    throw formatError('decision 只能是 approved 或 rejected');
  }
  const reason = record.reason;
  if (typeof reason !== 'string' || !reason.trim()) {
    throw formatError('reason 必须是非空字符串');
  }
  if ([...reason].length > MAX_REASON_LENGTH) {
    throw formatError(`审批理由不能超过 ${MAX_REASON_LENGTH} 个字符`);
  }
  return { decision, reason: reason.trim() };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildUserPrompt(input: SchedulerApprovalInput): string {
  const workflowSnapshot = {
    ...input.workflowSnapshot,
    nodes: input.workflowSnapshot.nodes.map((node) => {
      if (
        node.id !== input.schedulerNodeId
        || node.type !== 'scheduler_approval'
      ) {
        return node;
      }
      const { prompt: _prompt, ...nodeWithoutPrompt } = node;
      return nodeWithoutPrompt;
    }),
  };
  const sections = [
    '# 项目信息',
    JSON.stringify(input.project),
    '# 工作流快照',
    JSON.stringify(workflowSnapshot),
    '# 已完成节点运行',
    JSON.stringify(input.completedNodeRuns),
    '# 相关任务输出',
    JSON.stringify(input.taskOutputs),
  ];
  const extraPrompt = input.prompt?.trim();
  if (extraPrompt) {
    sections.push(
      '# 补充审批标准',
      extraPrompt,
    );
  }
  return sections.join('\n');
}

export function createSchedulerApprovalRunner(
  deps: { llmRegistry: LLMRegistry },
): SchedulerApprovalRunner {
  return {
    async decide(input) {
      const provider = deps.llmRegistry.get(input.providerId);
      const providerMetadata = deps.llmRegistry
        .list()
        .find((item) => item.id === input.providerId);
      if (!provider || !providerMetadata || providerMetadata.enabled !== true) {
        throw new Error(
          `调度器 LLM “${input.providerId}”不存在或不可用`,
        );
      }

      let response;
      try {
        response = await provider.chat({
          messages: [
            {
              role: 'system',
              content: [
                '你是工作流调度器审批节点，必须根据项目和前序输出作出严格审批。',
                '只能输出 JSON，不得输出 Markdown 围栏、解释、前后缀或内部推理。',
                '输出 schema：{"decision":"approved|rejected","reason":"非空中文审批理由"}',
              ].join('\n'),
            },
            {
              role: 'user',
              content: buildUserPrompt(input),
            },
          ],
          tools: [],
          maxTokens: 1000,
          temperature: 0,
          metadata: {
            taskId: input.nodeRunId,
          },
        });
      } catch (error) {
        throw new Error(
          `调度器审批失败：调用调度器 LLM “${input.providerId}”失败：${errorMessage(error)}`,
        );
      }

      const chatResponse = (
        typeof response === 'object'
        && response !== null
        && !Array.isArray(response)
      ) ? response : null;
      if (
        !chatResponse
        || !Object.prototype.hasOwnProperty.call(chatResponse, 'text')
        || typeof chatResponse.text !== 'string'
        || !chatResponse.text.trim()
      ) {
        throw new Error(
          `调度器审批失败：调度器 LLM “${input.providerId}”未返回文本`,
        );
      }
      try {
        return parseSchedulerApproval(chatResponse.text);
      } catch (error) {
        throw new Error(`调度器审批失败：${errorMessage(error)}`);
      }
    },
  };
}
