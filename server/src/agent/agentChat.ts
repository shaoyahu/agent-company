import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { LLMMessage, LLMProvider } from '../llm/types.js';
import type { AgentConfig } from '../types/company.js';
import { tools as builtinTools } from './tools.js';

export interface AgentChatResponse {
  success: boolean;
  text?: string;
  toolCalls?: Array<{ name: string; input: unknown; output: string }>;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  stopReason?: string;
  executor: 'llm' | 'cli';
  command?: string;
  args?: string[];
  exitCode?: number | null;
  oauthUrl?: string;
  error?: string;
}

interface CliAgentOnceResult {
  validationError?: string;
  response?: AgentChatResponse;
}

export interface AgentChatExecutionDeps {
  companyRoot: string;
  getProvider(id: string): LLMProvider | undefined;
  executeCliAgentOnce(
    agent: AgentConfig,
    prompt: string,
    phase: 'test' | 'chat',
    projectDir?: string,
  ): Promise<CliAgentOnceResult>;
}

function toPlainText(content: LLMMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((block) => block.type === 'text' ? block.text : '').join('');
}

function cliHistory(messages: LLMMessage[]): string {
  return messages
    .slice(-6)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const sender = typeof message.name === 'string' && message.name.trim()
        ? message.name
        : message.role;
      return `[${sender}] ${toPlainText(message.content)}`;
    })
    .join('\n');
}

export async function executeAgentChat(
  agent: AgentConfig,
  inputMessages: LLMMessage[],
  deps: AgentChatExecutionDeps,
  systemPrompt?: string,
): Promise<{ response?: AgentChatResponse; requestError?: string }> {
  if ((agent.executor ?? 'llm') === 'cli') {
    const lastUser = [...inputMessages].reverse().find((message) => message.role === 'user');
    if (!lastUser) return { requestError: '未找到用户消息' };
    const result = await deps.executeCliAgentOnce(
      agent,
      cliHistory(inputMessages) || toPlainText(lastUser.content),
      'chat',
    );
    if (result.validationError) return { requestError: result.validationError };
    return { response: result.response };
  }

  const provider = deps.getProvider(agent.llm);
  if (!provider) {
    return {
      requestError: `Agent '${agent.id}' 引用了不可用的 LLM '${agent.llm}'`,
    };
  }

  const start = Date.now();
  try {
    const toolDefs = builtinTools.listForNames(agent.tools);
    const ctx: any = {
      cwd: resolve(deps.companyRoot, 'projects'),
      companyRoot: deps.companyRoot,
      agentId: agent.id,
      taskId: `chat-${randomUUID()}`,
    };
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt ?? agent.systemPrompt },
      ...inputMessages,
    ];
    let totalIn = 0;
    let totalOut = 0;
    const toolCallsTrace: Array<{ name: string; input: unknown; output: string }> = [];

    for (let i = 0; i < 5; i++) {
      const response = await provider.chat({
        messages,
        tools: toolDefs,
        maxTokens: 2000,
        temperature: 0.7,
      });
      totalIn += response.usage.inputTokens;
      totalOut += response.usage.outputTokens;
      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });
      for (const toolCall of response.toolCalls) {
        toolCallsTrace.push({
          name: toolCall.name,
          input: toolCall.input,
          output: '',
        });
      }
      if (response.toolCalls.length === 0 || response.stopReason === 'end_turn') {
        return {
          response: {
            success: true,
            text: response.text,
            toolCalls: toolCallsTrace,
            usage: { inputTokens: totalIn, outputTokens: totalOut },
            durationMs: Date.now() - start,
            stopReason: response.stopReason,
            executor: 'llm',
          },
        };
      }

      for (const toolCall of response.toolCalls) {
        const handler = builtinTools.get(toolCall.name);
        let output = '';
        if (!handler) {
          output = `未知工具: ${toolCall.name}`;
        } else {
          try {
            const result = await handler(toolCall.input, ctx);
            output = (result.output ?? '').toString();
          } catch (error) {
            output = `工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        const trace = toolCallsTrace.find(
          (item) => item.name === toolCall.name && item.output === '',
        );
        if (trace) trace.output = output;
        messages.push({ role: 'tool', toolCallId: toolCall.id, content: output });
      }
    }

    const last = [...messages].reverse().find((message) => message.role === 'assistant');
    return {
      response: {
        success: true,
        text: last ? toPlainText(last.content) : '',
        toolCalls: toolCallsTrace,
        usage: { inputTokens: totalIn, outputTokens: totalOut },
        durationMs: Date.now() - start,
        stopReason: 'max_iterations',
        executor: 'llm',
      },
    };
  } catch (error) {
    return {
      response: {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
        executor: 'llm',
      },
    };
  }
}
