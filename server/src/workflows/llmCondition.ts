import type { LLMRegistry } from '../llm/registry.js';
import type { ProjectStatus } from '../types/company.js';

const FORMAT_ERROR_PREFIX = 'LLM 判断结果格式不正确：严格 JSON ';
const MAX_REASON_LENGTH = 1000;
const PROJECT_STATUSES = new Set<ProjectStatus>([
  'idea',
  'prd',
  'design',
  'dev',
  'qa',
  'delivery',
  'done',
  'failed',
]);

export interface LlmConditionResult {
  matched: boolean;
  reason: string;
}

export interface LlmConditionInput {
  providerId: string;
  prompt: string;
  project: {
    id: string;
    title: string;
    description?: string;
    boss: string;
    status: ProjectStatus;
    phase: string;
  };
  stageResult?: 'success' | 'failure';
  output?: string;
  projectStatus: ProjectStatus;
  iteration: number;
}

export interface LlmConditionRunner {
  matches(input: LlmConditionInput): Promise<LlmConditionResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputError(detail: string): Error {
  return new Error(`LLM 判断输入无效：${detail}`);
}

function formatError(detail: string): Error {
  return new Error(`${FORMAT_ERROR_PREFIX}${detail}`);
}

function assertInput(input: unknown): asserts input is LlmConditionInput {
  if (!isRecord(input)) {
    throw inputError('必须是对象');
  }
  if (typeof input.providerId !== 'string' || !input.providerId.trim()) {
    throw inputError('providerId 必须是非空字符串');
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw inputError('prompt 必须是非空字符串');
  }
  if (!isRecord(input.project)) {
    throw inputError('project 必须是对象');
  }
  for (const key of ['id', 'title', 'boss', 'phase'] as const) {
    if (typeof input.project[key] !== 'string' || !input.project[key].trim()) {
      throw inputError(`project.${key} 必须是非空字符串`);
    }
  }
  if (
    typeof input.project.status !== 'string'
    || !PROJECT_STATUSES.has(input.project.status as ProjectStatus)
  ) {
    throw inputError('project.status 无效');
  }
  if (
    typeof input.projectStatus !== 'string'
    || !PROJECT_STATUSES.has(input.projectStatus as ProjectStatus)
  ) {
    throw inputError('projectStatus 无效');
  }
  if (
    input.stageResult !== undefined
    && input.stageResult !== 'success'
    && input.stageResult !== 'failure'
  ) {
    throw inputError('stageResult 无效');
  }
  if (input.output !== undefined && typeof input.output !== 'string') {
    throw inputError('output 必须是字符串');
  }
  if (
    typeof input.iteration !== 'number'
    || !Number.isSafeInteger(input.iteration)
    || input.iteration < 0
  ) {
    throw inputError('iteration 必须是非负安全整数');
  }
}

export function parseLlmConditionResult(text: string): LlmConditionResult {
  if (typeof text !== 'string' || !text.trim()) {
    throw formatError('必须提供非空对象文本');
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
    || !Object.prototype.hasOwnProperty.call(record, 'matched')
    || !Object.prototype.hasOwnProperty.call(record, 'reason')
  ) {
    throw formatError('只能包含 matched 和 reason 两个自有字段');
  }
  if (typeof record.matched !== 'boolean') {
    throw formatError('matched 必须是布尔值');
  }
  if (typeof record.reason !== 'string' || !record.reason.trim()) {
    throw formatError('reason 必须是非空字符串');
  }
  if ([...record.reason].length > MAX_REASON_LENGTH) {
    throw formatError(`reason 不能超过 ${MAX_REASON_LENGTH} 个字符`);
  }
  return {
    matched: record.matched,
    reason: record.reason.trim(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildUserPrompt(input: LlmConditionInput): string {
  return [
    '# 项目信息',
    JSON.stringify(input.project),
    '# 条件上下文',
    JSON.stringify({
      stageResult: input.stageResult,
      output: input.output,
      projectStatus: input.projectStatus,
      iteration: input.iteration,
    }),
    '# 用户判断提示词',
    input.prompt,
  ].join('\n');
}

export function createLlmConditionRunner(
  deps: { llmRegistry: LLMRegistry },
): LlmConditionRunner {
  return {
    async matches(input) {
      assertInput(input);
      const provider = deps.llmRegistry.get(input.providerId);
      const metadata = deps.llmRegistry
        .list()
        .find((item) => item.id === input.providerId);
      if (!provider || !metadata || metadata.enabled !== true) {
        throw new Error(`LLM 判断 Provider “${input.providerId}”不存在或不可用`);
      }

      let response;
      try {
        response = await provider.chat({
          messages: [
            {
              role: 'system',
              content: [
                '你是工作流条件判断器，必须根据项目和条件上下文严格判断。',
                '只能输出 JSON，不得输出 Markdown 围栏、解释、前后缀或内部推理。',
                '输出 schema：{"matched":boolean,"reason":"非空中文判断理由"}',
              ].join('\n'),
            },
            { role: 'user', content: buildUserPrompt(input) },
          ],
          tools: [],
          maxTokens: 1000,
          temperature: 0,
        });
      } catch (error) {
        throw new Error(
          `LLM 判断失败：调用 LLM Provider “${input.providerId}”失败：${errorMessage(error)}`,
        );
      }

      const text = (
        typeof response === 'object'
        && response !== null
        && !Array.isArray(response)
        && Object.prototype.hasOwnProperty.call(response, 'text')
        && typeof response.text === 'string'
        && response.text.trim()
      ) ? response.text : null;
      if (!text) {
        throw new Error(`LLM 判断失败：LLM Provider “${input.providerId}”未返回文本`);
      }
      try {
        return parseLlmConditionResult(text);
      } catch (error) {
        throw new Error(`LLM 判断失败：${errorMessage(error)}`);
      }
    },
  };
}
