/**
 * pi-ai Bridge — 把 @earendil-works/pi-ai 包成 Agent Company 的 LLMProvider 接口
 *
 * 设计:
 * - 外部 API 不变(LLMProvider.chat / .stream)
 * - 内部用 pi-ai 跑 30+ provider
 * - JSON Schema tools → typebox Type(用最简的 if-else 转换)
 * - pi-ai 事件流 → Agent Company ChatResponse
 */

import {
  Type,
  type Model as PiModel,
  type Context as PiContext,
  type Tool as PiTool,
  type AssistantMessage,
  type TextContent,
  type ThinkingContent,
  type ToolCall as PiToolCall,
  type ToolResultMessage,
  type Usage as PiUsage,
} from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type {
  LLMProvider,
  LLMProviderType,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ToolDefinition,
  ToolCall,
  LLMMessage,
  ContentBlock,
} from './types.js';

/**
 * 解析 provider id → pi-ai provider id
 *
 * 我们的 provider 格式:
 *   - "anthropic" (用 type 字段)
 *   - "openai"   (OpenAI 兼容,endpoint 任意)
 *   - "deepseek" (OpenAI 兼容)
 *
 * pi-ai 用 provider id + model id 查表。我们要把这些映射过去。
 */

// pi-ai 已知的 provider id 集合(从 types.d.ts 的 KnownProvider)
const PI_KNOWN_PROVIDERS = new Set([
  'amazon-bedrock', 'ant-ling', 'anthropic', 'google', 'google-vertex',
  'openai', 'azure-openai-responses', 'openai-codex', 'radius', 'nvidia',
  'deepseek', 'github-copilot', 'xai', 'groq', 'cerebras', 'openrouter',
  'vercel-ai-gateway', 'zai', 'zai-coding-cn', 'mistral',
  'minimax', 'minimax-cn', 'moonshotai', 'moonshotai-cn',
  'huggingface', 'fireworks', 'together', 'baseten',
  'opencode', 'opencode-go', 'kimi-coding',
  'cloudflare-workers-ai', 'cloudflare-ai-gateway',
  'qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual',
  'xiaomi', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp',
]);

/**
 * 我们的 provider id → pi-ai provider id 的映射
 */
/** @internal - exported for testing only */
export function resolvePiProviderId(ourProvider: string, type: LLMProviderType): string {
  // 直接命中 pi-ai known provider
  if (PI_KNOWN_PROVIDERS.has(ourProvider)) {
    return ourProvider;
  }
  // OpenAI / Anthropic 兼容的第三方 → 当作对应协议(用 endpoint 区分具体厂商)
  if (type === 'openai') {
    return 'openai';
  }
  if (type === 'anthropic') {
    return 'anthropic';
  }
  // openai(含 OpenAI 兼容的 deepseek/kimi/qwen/... 等三方)— 全部走 openai provider id
  return ourProvider;
}

/**
 * JSON Schema → typebox Type 转换器
 * 我们的工具用 JSON Schema,pi-ai 用 typebox
 * 写一个最简的转换:支持 string/number/boolean/enum/object/array
 */
/** @internal - exported for testing only */
export function jsonSchemaToTypebox(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return Type.Any();
  }

  const type = schema.type;
  const description = schema.description;
  const opts: any = description ? { description } : {};

  // 处理 oneOf / anyOf(简化:取第一个)
  if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return jsonSchemaToTypebox(schema.oneOf[0]);
  }
  if (schema.anyOf && Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return jsonSchemaToTypebox(schema.anyOf[0]);
  }

  // 枚举
  if (schema.enum && Array.isArray(schema.enum)) {
    return Type.Union(schema.enum.map((v: any) => Type.Literal(v)), opts);
  }

  switch (type) {
    case 'string':
      return Type.String(opts);
    case 'number':
    case 'integer':
      return Type.Number(opts);
    case 'boolean':
      return Type.Boolean(opts);
    case 'array':
      return Type.Array(jsonSchemaToTypebox(schema.items ?? {}), opts);
    case 'object': {
      const properties = schema.properties ?? {};
      const required = schema.required ?? [];
      const shape: any = {};
      for (const [k, v] of Object.entries(properties)) {
        shape[k] = jsonSchemaToTypebox(v);
      }
      // typebox 的 Object 需要 required 数组;但 pi-ai 可能宽容,加默认值
      return Type.Object(shape, { ...opts, additionalProperties: Type.Any() });
    }
    default:
      return Type.Any();
  }
}

/**
 * 把我们的 ToolDefinition[] 转换成 pi-ai 的 Tool[]
 */
/** @internal - exported for testing only */
export function convertTools(tools: ToolDefinition[]): PiTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: jsonSchemaToTypebox(t.inputSchema) as any,
  }));
}

/**
 * Agent Company 的 message → pi-ai 的 message
 *
 * pi-ai 的消息格式:
 *   - UserMessage: { role: 'user', content: TextContent[] | string, timestamp }
 *   - AssistantMessage: { role: 'assistant', content: [...], ... }
 *   - ToolResultMessage: { role: 'toolResult', toolCallId, toolName, content, isError, timestamp }
 */
/** @internal - exported for testing only */
export function convertMessages(messages: LLMMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      // system prompt 单独放 context.systemPrompt
      continue;
    }
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : blocksToText(m.content);
      out.push({ role: 'user', content: text, timestamp: Date.now() });
    } else if (m.role === 'assistant') {
      const blocks: any[] = [];
      if (typeof m.content === 'string' && m.content) {
        blocks.push({ type: 'text', text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === 'text') blocks.push({ type: 'text', text: b.text });
          else if ((b as any).type === 'thinking') blocks.push({ type: 'thinking', thinking: (b as any).text ?? (b as any).thinking });
          else if (b.type === 'tool_use') {
            blocks.push({ type: 'toolCall', id: b.id, name: b.name, arguments: b.input });
          }
        }
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'toolCall', id: tc.id, name: tc.name, arguments: tc.input });
        }
      }
      out.push({ role: 'assistant', content: blocks, timestamp: Date.now() });
    } else if (m.role === 'tool') {
      const text = typeof m.content === 'string' ? m.content : blocksToText(m.content);
      out.push({
        role: 'toolResult',
        toolCallId: m.toolCallId ?? '',
        toolName: 'tool', // 我们在 toolCall 已经记录了 name
        content: [{ type: 'text', text }],
        isError: m.name === 'tool_error',
        timestamp: Date.now(),
      } as ToolResultMessage);
    }
  }
  return out;
}

/** @internal - exported for testing only */
export function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `[tool_use: ${b.name}]`;
      if (b.type === 'tool_result') return `[tool_result: ${b.content}]`;
      return '';
    })
    .join('\n');
}

/**
 * pi-ai 的 AssistantMessage → 我们的 ChatResponse
 */
/** @internal - exported for testing only */
export function convertAssistantMessage(msg: AssistantMessage): ChatResponse {
  let text = '';
  const toolCalls: ToolCall[] = [];

  for (const block of msg.content ?? []) {
    if (block.type === 'text') {
      text += (block as TextContent).text;
    } else if (block.type === 'toolCall') {
      const tc = block as PiToolCall;
      toolCalls.push({
        id: tc.id,
        name: tc.name,
        input: tc.arguments ?? {},
      });
    }
  }

  const stopReason = mapStopReason(msg.stopReason);

  return {
    text,
    toolCalls,
    stopReason,
    usage: {
      inputTokens: msg.usage?.input ?? 0,
      outputTokens: msg.usage?.output ?? 0,
    },
    raw: msg,
  };
}

/** @internal - exported for testing only */
export function mapStopReason(r: string | undefined): ChatResponse['stopReason'] {
  switch (r) {
    case 'stop':
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
    case 'tool_calls':
      return 'tool_use';
    case 'length':
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
    case 'content_filter':
      return 'stop_sequence';
    case 'error':
    case 'aborted':
      return 'error';
    default:
      return 'end_turn';
  }
}

/**
 * 创建 fetch wrapper — 把 SDK 内部拼出的 "baseURL + 标准 path" 完整替换成
 * 用户配置的 endpoint(完整 URL,含 path)。
 *
 * 工作原理:
 *   1. 底层 OpenAI/Anthropic SDK 在每次请求时,用 `buildURL(path)` 拼出完整 URL
 *      (例如 "https://api.openai.com/v1/chat/completions?stream=true")
 *   2. SDK 调用我们提供的 `customFetch(input, init)` 发起请求
 *   3. 我们保留 SDK 拼出的 query string,把 base + path 段完全替换成 endpoint
 *   4. 流式响应(body stream)原样转发
 *
 * 为什么这样 work:
 *   - endpoint 字段现在存的就是完整 URL(含 path),不再分 base + path
 *   - 协议 (openai/anthropic) 决定请求体格式 + headers — pi-ai 处理
 *   - URL 路径由用户掌控 — fetch wrapper 替换
 *   - SDK 的 query params (`?stream=true` / `?api-version=v1`) 通过"保留 query"传递
 *
 * 设计参考:
 *   - pi-ai 官方 Cloudflare provider 用 `tenantStreams` 模式做类似事情
 *   - 但 `tenantStreams` 在 SDK 拼 URL 之前替换 baseURL,会被 SDK 再 append
 *     标准 path,出现重复。所以本实现改成在 fetch 层替换最终 URL
 *   - OpenAI Node SDK + Anthropic SDK 都接受 `fetch` 构造参数
 *   - pi-ai 内部把 `options.fetch` 透传给底层 SDK
 */
/** @internal - exported for testing only */
export function createEndpointRewriteFetch(endpoint: string): typeof globalThis.fetch {
  // endpoint 是完整 URL,例如 "https://api.example.com/v1/chat/completions"
  // 我们用 origin (scheme + host + port) 作为 base,把 path 拼回去
  const u: URL = (() => {
    try {
      return new URL(endpoint);
    } catch {
      // fallback: 把 endpoint 当字符串处理(虽然不合法,但不抛错)
      return new URL('https://invalid.local/');
    }
  })();
  const origin = u.origin;
  const pathWithQuery = (u.pathname || '/') + (u.search || '');
  return async (input, init) => {
    const originalUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    // 只重写 endpoint 同源的请求,其它(SDK 内部探活之类)原样转发
    let parsed: URL | null = null;
    try { parsed = new URL(originalUrl); } catch {}
    if (parsed && (parsed.origin === origin || originalUrl.startsWith(origin + '/'))) {
      // 保留 SDK 自己加的 query param 段(比如 ?stream=true / ?api-version=v1)
      // 但 endpoint 已经包含 path,所以我们:
      //   - 用 endpoint 的 path + endpoint 的 query 段
      //   - 加上 SDK 自己 append 的额外 query(如果有,合理合并)
      const sdkQuery = parsed.search;
      let finalQuery = '';
      if (sdkQuery) {
        // SDK 自己的 query 跟 endpoint 的 query 合并(endpoint 的优先,作为默认值)
        const endpointParams = u.searchParams;
        const sdkParams = new URLSearchParams(sdkQuery);
        const merged = new URLSearchParams();
        // endpoint 参数作默认
        endpointParams.forEach((v, k) => merged.set(k, v));
        // SDK 参数覆盖(SDK 自己的优先于 endpoint 默认)
        sdkParams.forEach((v, k) => merged.set(k, v));
        finalQuery = '?' + merged.toString();
      } else {
        finalQuery = u.search || '';
      }
      const finalUrl = origin + pathWithQuery.split('?')[0] + finalQuery;
      return globalThis.fetch(finalUrl, init);
    }
    return globalThis.fetch(originalUrl, init);
  };
}

/**
 * 全局 Models 集合(从 builtinModels() 取)
 */
const GLOBAL_MODELS = builtinModels();

/**
 * 用 pi-ai 创建 LLMProvider
 */
export function createPiProvider(opts: {
  id: string;
  type: LLMProviderType;
  model: string;
  /**
   * 完整 API URL(含 path),例如:
   *   - "https://api.openai.com/v1/chat/completions" (openai 标准)
   *   - "https://api.example.com/api/paas/v4/chat/completions" (三方自定义 path)
   *   - "https://api.anthropic.com/v1/messages" (anthropic 标准)
   *
   * pi-ai 内部会拿这个当 baseURL + 自动 append 标准 path,但我们的 fetch wrapper
   * 会完全替换,所以 path 也由用户掌控。
   */
  endpoint?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}): LLMProvider {
  // 球球要求"完全不要 mock" — 之前这里有 `if (opts.type === 'mock') throw`,但 LLMProviderType
  // 类型已经收紧到 'anthropic' | 'openai',TS 报错。删掉 dead code,前置校验(registry/server)
  // 已经在入口拒掉所有非 anthropic/openai 的 provider。

  const providerId = resolvePiProviderId(opts.id, opts.type);
  // 用户指定的协议风格(强制覆盖 pi-ai 内置 model 的 api 字段)
  const forcedApi = opts.type === 'anthropic' ? 'anthropic-messages' : 'openai-completions';

  // 找 model
  let piModel: PiModel<any> | null = null;
  try {
    piModel = GLOBAL_MODELS.getModel(providerId, opts.model) as PiModel<any> | null;
  } catch (e) {
    // 找不到 — 用 default
  }
  if (!piModel) {
    // pi-ai 的 getModel 找不到时,看 model id 里是否有 provider 前缀
    if (opts.model.includes('/')) {
      const parts = opts.model.split('/');
      const p = parts[0]!;
      const m = parts.slice(1).join('/');
      try {
        const found = GLOBAL_MODELS.getModel(p, m) as PiModel<any> | null;
        if (found) {
          piModel = found;
          opts = { ...opts, id: p, model: m };
        }
      } catch {}
    }
  }

  // 仍然没找到:fallback(按用户指定的 type 决定 api)
  if (!piModel) {
    piModel = {
      id: opts.model,
      name: opts.model,
      api: forcedApi,
      provider: providerId,
      baseUrl: opts.endpoint,
      contextWindow: 128000,
      maxTokens: opts.maxTokens ?? 8192,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as unknown as PiModel<any>;
  } else {
    // 找到了但用户明确选了不同协议 — 覆盖 model.api
    // (例如用户选智谱,pi-ai 知道智谱但只支持 openai 协议;用户想用 anthropic 协议 → 覆盖)
    (piModel as any).api = forcedApi;
    // 用户传的 endpoint 优先于 pi-ai 内置 baseUrl
    // (三方厂商 endpoint 不在 pi-ai catalog 里,但即便命中了内置 model,endpoint 也是用户 Web 配置优先)
    if (opts.endpoint) {
      (piModel as any).baseUrl = opts.endpoint;
    }
  }

  // 端点 URL 改写 — 通过 fetch wrapper 在请求发出前把 SDK 拼出的完整 URL
  // 替换成用户配置的 endpoint(完整 URL,含 path)。
  //
  // 设计依据:
  //   - OpenAI SDK `buildURL(path)`: 相对 path → baseURL + path
  //   - Anthropic SDK 同上
  //   - pi-ai `createClient` 接 `options.fetch`,把这个 fetch 透传给底层 SDK
  //   - 底层 SDK 在每次发请求时调我们提供的 fetch
  //
  // endpoint 字段现在存的是完整 URL(用户自己填 / 平台预设拼出来的),
  // 我们拦截 fetch 完全替换。SDK 自动加的 query params(?stream=true 等)保留。
  //
  // 参考:Cloudflare 官方 pi-ai provider 用 `tenantStreams` 模式做类似事情。
  const endpointRewriteFetch = opts.endpoint
    ? createEndpointRewriteFetch(opts.endpoint)
    : undefined;

  return {
    id: opts.id,
    type: opts.type,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const { system, messages } = extractSystem(request.messages);
      const context: PiContext = {
        systemPrompt: system,
        messages: convertMessages(messages),
        tools: request.tools ? convertTools(request.tools) : undefined,
      };
      try {
        const stream = GLOBAL_MODELS.stream(piModel as PiModel<any>, context, {
          maxTokens: request.maxTokens ?? opts.maxTokens ?? 8192,
          temperature: request.temperature ?? opts.temperature,
          // 必须显式传 apiKey:pi-ai 不会自动从 env 或 opts 拿,opts.apiKey 才是真实来源
          // env 解析由 pi-ai 内部处理,只要传 apiKey 它就能完成认证
          apiKey: opts.apiKey,
          // endpoint 启用时,fetch wrapper 在请求发出前改写 URL,
          // 完全绕开 SDK 内部 baseURL + 标准 path 的拼 URL 逻辑
          ...(endpointRewriteFetch ? { fetch: endpointRewriteFetch } : {}),
        });
        // 收集最后一个 done 事件
        let lastMessage: AssistantMessage | null = null;
        for await (const event of stream) {
          if (event.type === 'done') {
            lastMessage = event.message;
            break;
          }
          if (event.type === 'error') {
            const err = (event as any).error;
            return {
              text: '',
              toolCalls: [],
              stopReason: 'error',
              usage: { inputTokens: 0, outputTokens: 0 },
              raw: err,
            };
          }
        }
        if (!lastMessage) {
          return {
            text: '',
            toolCalls: [],
            stopReason: 'error',
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        return convertAssistantMessage(lastMessage);
      } catch (e: any) {
        return {
          text: '',
          toolCalls: [],
          stopReason: 'error',
          usage: { inputTokens: 0, outputTokens: 0 },
          raw: e,
        };
      }
    },
    async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
      const { system, messages } = extractSystem(request.messages);
      const context: PiContext = {
        systemPrompt: system,
        messages: convertMessages(messages),
        tools: request.tools ? convertTools(request.tools) : undefined,
      };
      try {
        const s = GLOBAL_MODELS.stream(piModel as PiModel<any>, context, {
          maxTokens: request.maxTokens ?? opts.maxTokens ?? 8192,
          temperature: request.temperature ?? opts.temperature,
          apiKey: opts.apiKey,
          ...(endpointRewriteFetch ? { fetch: endpointRewriteFetch } : {}),
        });
        for await (const event of s) {
          if (event.type === 'text_delta') {
            yield { type: 'text', text: (event as any).delta };
          } else if (event.type === 'toolcall_start') {
            const partial = (event as any).partial;
            const idx = (event as any).contentIndex;
            const tc = partial?.content?.[idx];
            if (tc && tc.type === 'toolCall') {
              yield {
                type: 'tool_call_start',
                toolCall: { id: tc.id, name: tc.name, input: {} },
              };
            }
          } else if (event.type === 'toolcall_end') {
            const partial = (event as any).partial;
            const idx = (event as any).contentIndex;
            const tc = partial?.content?.[idx];
            if (tc && tc.type === 'toolCall') {
              yield {
                type: 'tool_call_end',
                toolCall: { id: tc.id, name: tc.name, input: tc.arguments },
              };
            }
          } else if (event.type === 'done') {
            yield {
              type: 'done',
              response: convertAssistantMessage(event.message),
            };
          } else if (event.type === 'error') {
            yield { type: 'error', error: (event as any).error?.message ?? 'unknown' };
          }
        }
      } catch (e: any) {
        yield { type: 'error', error: e.message ?? String(e) };
      }
    },
  };
}

/**
 * 从 LLMMessage 数组里抽出 system 消息(返回剩余 messages)
 * - pi-ai 的 Context.systemPrompt 单独字段
 * - assistant/user/tool 留在 messages
 */
/** @internal - exported for testing only */
export function extractSystem(messages: LLMMessage[]): { system: string; messages: LLMMessage[] } {
  const sys: string[] = [];
  const rest: LLMMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      sys.push(typeof m.content === 'string' ? m.content : '');
    } else {
      rest.push(m);
    }
  }
  return { system: sys.join('\n\n'), messages: rest };
}
