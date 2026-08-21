/**
 * llm/pi-bridge.ts 单测
 *
 * 内部函数都已 export for testing。
 * 不测 createPiProvider.chat()(真实 LLM 调用,需要 apiKey)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePiProviderId,
  jsonSchemaToTypebox,
  convertTools,
  convertMessages,
  blocksToText,
  convertAssistantMessage,
  mapStopReason,
  createEndpointRewriteFetch,
  extractSystem,
  createPiProvider,
} from '../../src/llm/pi-bridge.js';
import type { LLMMessage, ToolDefinition, ContentBlock } from '../../src/llm/types.js';

// =================== resolvePiProviderId ===================

test('resolvePiProviderId:已知 provider 直接透传', () => {
  assert.equal(resolvePiProviderId('anthropic', 'anthropic'), 'anthropic');
  assert.equal(resolvePiProviderId('openai', 'openai'), 'openai');
  assert.equal(resolvePiProviderId('deepseek', 'openai'), 'deepseek');
  assert.equal(resolvePiProviderId('google', 'openai'), 'google');
});

test('resolvePiProviderId:未知 + type=openai → openai', () => {
  assert.equal(resolvePiProviderId('my-custom', 'openai'), 'openai');
});

test('resolvePiProviderId:未知 + type=anthropic → anthropic', () => {
  assert.equal(resolvePiProviderId('my-custom', 'anthropic'), 'anthropic');
});

// =================== jsonSchemaToTypebox ===================

test('jsonSchemaToTypebox:string → Type.String', () => {
  const t = jsonSchemaToTypebox({ type: 'string', description: 'name' });
  // typebox 返的对象,有 description
  assert.ok(t);
});

test('jsonSchemaToTypebox:number/integer → Type.Number', () => {
  jsonSchemaToTypebox({ type: 'number' });
  jsonSchemaToTypebox({ type: 'integer' });
  // 不应抛错
});

test('jsonSchemaToTypebox:boolean → Type.Boolean', () => {
  jsonSchemaToTypebox({ type: 'boolean' });
});

test('jsonSchemaToTypebox:array → Type.Array', () => {
  jsonSchemaToTypebox({ type: 'array', items: { type: 'string' } });
});

test('jsonSchemaToTypebox:object → Type.Object', () => {
  jsonSchemaToTypebox({
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
    },
    required: ['name'],
  });
});

test('jsonSchemaToTypebox:enum → Type.Union of Literals', () => {
  jsonSchemaToTypebox({ type: 'string', enum: ['a', 'b', 'c'] });
});

test('jsonSchemaToTypebox:oneOf 取第一个', () => {
  jsonSchemaToTypebox({
    oneOf: [{ type: 'string' }, { type: 'number' }],
  });
});

test('jsonSchemaToTypebox:anyOf 取第一个', () => {
  jsonSchemaToTypebox({
    anyOf: [{ type: 'boolean' }, { type: 'string' }],
  });
});

test('jsonSchemaToTypebox:缺 type → Type.Any', () => {
  const t = jsonSchemaToTypebox({ description: 'no type' });
  assert.ok(t);
});

test('jsonSchemaToTypebox:null → Type.Any', () => {
  const t = jsonSchemaToTypebox(null);
  assert.ok(t);
});

test('jsonSchemaToTypebox:嵌套 object 递归', () => {
  const t = jsonSchemaToTypebox({
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  });
  assert.ok(t);
});

// =================== convertTools ===================

test('convertTools:基本字段映射', () => {
  const ours: ToolDefinition[] = [
    {
      name: 'bash',
      description: '执行 shell 命令',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  ];
  const theirs = convertTools(ours);
  assert.equal(theirs.length, 1);
  assert.equal(theirs[0].name, 'bash');
  assert.equal(theirs[0].description, '执行 shell 命令');
  assert.ok(theirs[0].parameters);
});

test('convertTools:空数组', () => {
  assert.deepEqual(convertTools([]), []);
});

// =================== convertMessages ===================

test('convertMessages:user 文本', () => {
  const out = convertMessages([{ role: 'user', content: 'hi' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'user');
  assert.equal(out[0].content, 'hi');
});

test('convertMessages:system 消息被过滤', () => {
  const out = convertMessages([
    { role: 'system', content: '你是助手' },
    { role: 'user', content: 'hi' },
  ]);
  // system 不在 messages 里
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'user');
});

test('convertMessages:assistant 文本', () => {
  const out = convertMessages([
    { role: 'assistant', content: 'ok' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[0].content[0].type, 'text');
  assert.equal(out[0].content[0].text, 'ok');
});

test('convertMessages:assistant 多个 content blocks', () => {
  const out = convertMessages([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '我来' },
        { type: 'tool_use', id: 'tc1', name: 'bash', input: { command: 'ls' } },
      ],
    },
  ]);
  assert.equal(out[0].content.length, 2);
  assert.equal(out[0].content[0].type, 'text');
  assert.equal(out[0].content[1].type, 'toolCall');
  assert.equal(out[0].content[1].name, 'bash');
  assert.deepEqual(out[0].content[1].arguments, { command: 'ls' });
});

test('convertMessages:assistant.toolCalls 顶层 toolCalls 转 toolCall block', () => {
  const out = convertMessages([
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'tc1', name: 'read', input: { path: '/x' } },
      ],
    },
  ]);
  // content 为空字符串,不产 text block;toolCalls 产 toolCall block
  const tcBlocks = out[0].content.filter((b: any) => b.type === 'toolCall');
  assert.equal(tcBlocks.length, 1);
  assert.equal(tcBlocks[0].name, 'read');
});

test('convertMessages:tool 消息转 toolResult', () => {
  const out = convertMessages([
    {
      role: 'tool',
      content: 'result data',
      toolCallId: 'tc1',
      name: 'bash',
    },
  ]);
  assert.equal(out[0].role, 'toolResult');
  assert.equal(out[0].toolCallId, 'tc1');
  assert.equal(out[0].isError, false);
});

test('convertMessages:tool name=tool_error → isError=true', () => {
  const out = convertMessages([
    {
      role: 'tool',
      content: '失败原因',
      toolCallId: 'tc1',
      name: 'tool_error',
    },
  ]);
  assert.equal(out[0].isError, true);
});

test('convertMessages:user content 是 blocks 时 blocksToText 拼成 string', () => {
  const out = convertMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: '第一行' },
        { type: 'text', text: '第二行' },
      ],
    },
  ]);
  assert.equal(typeof out[0].content, 'string');
  assert.ok(out[0].content.includes('第一行'));
  assert.ok(out[0].content.includes('第二行'));
});

// =================== blocksToText ===================

test('blocksToText:多种 block 拼成文本', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', text: 'hello' },
    { type: 'tool_use', id: '1', name: 'bash', input: {} },
    { type: 'tool_result', toolUseId: '1', content: 'output' },
  ];
  const out = blocksToText(blocks);
  assert.ok(out.includes('hello'));
  assert.ok(out.includes('[tool_use: bash]'));
  assert.ok(out.includes('[tool_result: output]'));
});

test('blocksToText:空数组返空串', () => {
  assert.equal(blocksToText([]), '');
});

// =================== convertAssistantMessage ===================

test('convertAssistantMessage:text + toolCall 混合', () => {
  const msg: any = {
    content: [
      { type: 'text', text: '好的' },
      { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'ls' } },
    ],
    stopReason: 'tool_use',
    usage: { input: 100, output: 50 },
  };
  const out = convertAssistantMessage(msg);
  assert.equal(out.text, '好的');
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'bash');
  assert.deepEqual(out.toolCalls[0].input, { command: 'ls' });
  assert.equal(out.stopReason, 'tool_use');
  assert.deepEqual(out.usage, { inputTokens: 100, outputTokens: 50 });
});

test('convertAssistantMessage:空 content', () => {
  const msg: any = { content: [], stopReason: 'stop', usage: { input: 0, output: 0 } };
  const out = convertAssistantMessage(msg);
  assert.equal(out.text, '');
  assert.deepEqual(out.toolCalls, []);
});

test('convertAssistantMessage:多个 text 块拼接', () => {
  const msg: any = {
    content: [
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
    ],
    stopReason: 'stop',
  };
  const out = convertAssistantMessage(msg);
  assert.equal(out.text, '第一段第二段');
});

// =================== mapStopReason ===================

test('mapStopReason:stop/end_turn → end_turn', () => {
  assert.equal(mapStopReason('stop'), 'end_turn');
  assert.equal(mapStopReason('end_turn'), 'end_turn');
});

test('mapStopReason:tool_use/tool_calls → tool_use', () => {
  assert.equal(mapStopReason('tool_use'), 'tool_use');
  assert.equal(mapStopReason('tool_calls'), 'tool_use');
});

test('mapStopReason:length/max_tokens → max_tokens', () => {
  assert.equal(mapStopReason('length'), 'max_tokens');
  assert.equal(mapStopReason('max_tokens'), 'max_tokens');
});

test('mapStopReason:stop_sequence/content_filter → stop_sequence', () => {
  assert.equal(mapStopReason('stop_sequence'), 'stop_sequence');
  assert.equal(mapStopReason('content_filter'), 'stop_sequence');
});

test('mapStopReason:error/aborted → error', () => {
  assert.equal(mapStopReason('error'), 'error');
  assert.equal(mapStopReason('aborted'), 'error');
});

test('mapStopReason:undefined → end_turn(default)', () => {
  assert.equal(mapStopReason(undefined), 'end_turn');
});

test('mapStopReason:未知字符串 → end_turn(default)', () => {
  assert.equal(mapStopReason('xxx'), 'end_turn');
});

// =================== createEndpointRewriteFetch ===================

test('createEndpointRewriteFetch:同源请求被改写 path + query', async () => {
  // 用一个真实存在的 host(httpbin)测... 但网络可能不通
  // 改测 URL 字符串处理
  const fetchFn = createEndpointRewriteFetch('https://api.example.com/v1/messages');
  // 用一个 stub fetch 测 fetchFn 的 URL 改写逻辑
  const origFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: any) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{}');
  }) as any;
  try {
    await fetchFn('https://api.example.com/v1/messages?stream=true', {});
    assert.equal(capturedUrl, 'https://api.example.com/v1/messages?stream=true');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('createEndpointRewriteFetch:跨源请求原样转发', async () => {
  const fetchFn = createEndpointRewriteFetch('https://api.example.com/v1/messages');
  const origFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: any) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{}');
  }) as any;
  try {
    await fetchFn('https://other-host.com/whatever', {});
    assert.equal(capturedUrl, 'https://other-host.com/whatever');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('createEndpointRewriteFetch:无 endpoint 时是无效 URL,跨源不被改写', async () => {
  const fetchFn = createEndpointRewriteFetch('not-a-url');
  const origFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: any) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{}');
  }) as any;
  try {
    await fetchFn('https://api.example.com/anything', {});
    // 无效 endpoint → origin = 'https://invalid.local' → 不同源 → 原样
    assert.equal(capturedUrl, 'https://api.example.com/anything');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('createEndpointRewriteFetch:合并 SDK 加的 query 和 endpoint 的 query', async () => {
  const fetchFn = createEndpointRewriteFetch('https://api.example.com/v1/msg?api-version=2024');
  const origFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: any) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{}');
  }) as any;
  try {
    // SDK 拼出 "https://api.example.com/something?stream=true"
    await fetchFn('https://api.example.com/something?stream=true', {});
    // 期望:path 来自 endpoint,query 合并(SDK 的 stream 覆盖 endpoint 的)
    const url = new URL(capturedUrl);
    assert.equal(url.pathname, '/v1/msg');
    assert.equal(url.searchParams.get('stream'), 'true');
    assert.equal(url.searchParams.get('api-version'), '2024');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('createEndpointRewriteFetch:接受 Request 对象作 input', async () => {
  const fetchFn = createEndpointRewriteFetch('https://api.example.com/v1/msg');
  const origFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: any) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{}');
  }) as any;
  try {
    const req = new Request('https://api.example.com/v1/msg');
    await fetchFn(req, {});
    assert.equal(capturedUrl, 'https://api.example.com/v1/msg');
  } finally {
    globalThis.fetch = origFetch;
  }
});

// =================== extractSystem ===================

test('extractSystem:抽 system 到 systemPrompt,剩余 messages 不含 system', () => {
  const msgs: LLMMessage[] = [
    { role: 'system', content: '你是球球的助手' },
    { role: 'user', content: 'hi' },
  ];
  const { system, messages } = extractSystem(msgs);
  assert.equal(system, '你是球球的助手');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
});

test('extractSystem:多 system 消息拼一起(\\n\\n 分隔)', () => {
  const msgs: LLMMessage[] = [
    { role: 'system', content: '规则 1' },
    { role: 'system', content: '规则 2' },
    { role: 'user', content: 'hi' },
  ];
  const { system, messages } = extractSystem(msgs);
  assert.equal(system, '规则 1\n\n规则 2');
  assert.equal(messages.length, 1);
});

test('extractSystem:无 system 消息时 system 为空串', () => {
  const msgs: LLMMessage[] = [
    { role: 'user', content: 'hi' },
  ];
  const { system, messages } = extractSystem(msgs);
  assert.equal(system, '');
  assert.equal(messages.length, 1);
});

test('extractSystem:system content 是 blocks 时取空串(简化行为)', () => {
  const msgs: LLMMessage[] = [
    { role: 'system', content: [{ type: 'text', text: 'block' }] },
    { role: 'user', content: 'hi' },
  ];
  const { system } = extractSystem(msgs);
  // 当前实现:system content 是 blocks 时取 ''
  assert.equal(system, '');
});

// =================== createPiProvider 构造 ===================

test('createPiProvider:anthropic 协议,model 已知', () => {
  const p = createPiProvider({
    id: 'anthropic',
    type: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
  });
  assert.equal(p.id, 'anthropic');
  assert.equal(p.type, 'anthropic');
  assert.equal(typeof p.chat, 'function');
  assert.equal(typeof p.stream, 'function');
});

test('createPiProvider:openai 协议 + 未知 model → fallback model 构造', () => {
  const p = createPiProvider({
    id: 'my-custom',
    type: 'openai',
    model: 'mysterious-model-9000',
  });
  assert.equal(p.id, 'my-custom');
  assert.equal(p.type, 'openai');
});

test('createPiProvider:model 带 provider 前缀(anthropic/claude-x)', () => {
  const p = createPiProvider({
    id: 'openai',
    type: 'openai',
    model: 'anthropic/claude-3-5-sonnet-20241022',
  });
  // 应能解析,不会抛错
  assert.equal(p.id, 'openai');
});

test('createPiProvider:endpoint 启用时构造 fetch wrapper', () => {
  const p = createPiProvider({
    id: 'anthropic',
    type: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    endpoint: 'https://api.example.com/v1/messages',
  });
  assert.ok(p);
});
