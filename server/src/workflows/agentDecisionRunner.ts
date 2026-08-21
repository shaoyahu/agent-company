import type { LLMRegistry } from '../llm/registry.js';
import type { AgentConfig, ProjectStatus, WorkflowNodeControlResult } from '../types/company.js';
import { parseConditionDecision, parseLoopDecision } from './agentDecision.js';

export interface AgentDecisionInput {
  agentId: string;
  mode: 'condition' | 'loop';
  prompt: string;
  receivedInputs: Array<{ sourceName: string; outputText: string; outputFileRefs: string[] }>;
  project: { id: string; title: string; status: ProjectStatus; phase: string };
  iteration: number;
}

export interface AgentDecisionResult {
  outputText: string;
  controlResult: WorkflowNodeControlResult;
}

export interface AgentDecisionRunner {
  decide(input: AgentDecisionInput): Promise<AgentDecisionResult>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertInput(input: AgentDecisionInput): void {
  if (!input.agentId.trim()) throw new Error('Agent 判断输入无效：agentId 必须是非空字符串');
  if (input.mode !== 'condition' && input.mode !== 'loop') throw new Error('Agent 判断输入无效：mode 无效');
  if (!input.prompt.trim()) throw new Error('Agent 判断输入无效：prompt 必须是非空字符串');
  if (!Number.isSafeInteger(input.iteration) || input.iteration < 0) {
    throw new Error('Agent 判断输入无效：iteration 必须是非负安全整数');
  }
}

export function createAgentDecisionRunner(deps: {
  llmRegistry: LLMRegistry;
  getAgent(id: string): AgentConfig | undefined;
}): AgentDecisionRunner {
  return {
    async decide(input) {
      assertInput(input);
      const agent = deps.getAgent(input.agentId);
      if (!agent || agent.enabled === false) {
        throw new Error(`判断 Agent “${input.agentId}”不存在或未启用`);
      }
      const provider = deps.llmRegistry.get(agent.llm);
      const metadata = deps.llmRegistry.list().find(item => item.id === agent.llm);
      if (!provider || !metadata?.enabled) {
        throw new Error(`判断 Agent “${agent.id}”引用的 LLM “${agent.llm}”不存在或不可用`);
      }
      const marker = input.mode === 'condition' ? '[[匹配: 是]] 或 [[匹配: 否]]' : '[[循环: 继续]] 或 [[循环: 结束]]';
      const received = input.receivedInputs.map(item => [
        `【${item.sourceName}】`,
        item.outputText,
        item.outputFileRefs.length ? `文件：${item.outputFileRefs.join('\n')}` : '',
      ].filter(Boolean).join('\n')).join('\n\n');
      let response;
      try {
        response = await provider.chat({
          messages: [
            {
              role: 'system',
              content: `你是 Agent 判断器。先输出简明中文判断正文，最后一行必须且只能输出控制标记：${marker}。不要输出 Markdown 围栏或其他控制标记。`,
            },
            {
              role: 'user',
              content: [
                `项目：${input.project.title}`,
                `当前阶段：${input.project.phase}`,
                `循环轮次：${input.iteration}`,
                received ? `接收信息：\n${received}` : '接收信息：无',
                `判断提示词：\n${input.prompt}`,
              ].join('\n\n'),
            },
          ],
          tools: [],
          maxTokens: 2000,
          temperature: 0,
        });
      } catch (error) {
        throw new Error(`Agent 判断失败：调用 Agent “${agent.id}”的 LLM 失败：${message(error)}`);
      }
      if (!response?.text?.trim()) {
        throw new Error(`Agent 判断失败：Agent “${agent.id}”未返回文本`);
      }
      try {
        return input.mode === 'condition'
          ? parseConditionDecision(response.text)
          : parseLoopDecision(response.text);
      } catch (error) {
        throw new Error(`Agent 判断失败：${message(error)}`);
      }
    },
  };
}
