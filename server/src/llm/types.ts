/**
 * LLM 抽象层 - 核心类型定义
 *
 * 设计目标:
 * 1. 统一所有 LLM 协议的接口(Anthropic / OpenAI 兼容)
 * 2. 支持任意 OpenAI 兼容的 endpoint(DeepSeek/Moonshot/通义千问/OpenRouter 都可以)
 * 3. 流式输出 + tool use
 */

export type LLMProviderType = 'anthropic' | 'openai';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  /** tool call id (only for role=tool) */
  toolCallId?: string;
  /** tool calls made by assistant */
  toolCalls?: ToolCall[];
  /** agent/channel metadata */
  name?: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for input */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ChatRequest {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  /** 模型 override,默认用 provider 默认 */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** 停止条件 */
  stopSequences?: string[];
  /** 元信息(写到日志) */
  metadata?: {
    agentId?: string;
    taskId?: string;
  };
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  /** 停止原因 */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
  /** 使用统计 */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** 原始 model 返回,用于调试 */
  raw?: unknown;
}

/**
 * 流式 chunk(在 agent runtime 里用)
 */
export interface StreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done' | 'error';
  text?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  response?: ChatResponse;
}

export interface LLMProvider {
  /** provider id,对应 company.yaml 里的 llm_providers[].id */
  readonly id: string;
  readonly type: LLMProviderType;
  /** 单次 chat(非流式) */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** 流式 chat */
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
}
