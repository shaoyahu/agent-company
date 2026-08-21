import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { createServer } from '../../src/api/server.js';
import { LLMRegistry } from '../../src/llm/registry.js';
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  StreamChunk,
} from '../../src/llm/types.js';
import { ConfigService } from '../../src/store/config-merge.js';
import { ConversationRepo } from '../../src/store/conversations.js';
import { getDB } from '../../src/store/db.js';
import { AgentRepo, DepartmentRepo } from '../../src/store/org.js';
import { cleanupDB, freshDB, truncateAll } from '../helpers/db.js';

interface PendingCall {
  systemPrompt: string;
  resolve(response: ChatResponse): void;
}

class ControlledProvider implements LLMProvider {
  readonly id = 'llm';
  readonly type = 'openai' as const;
  readonly pending: PendingCall[] = [];

  chat(request: ChatRequest): Promise<ChatResponse> {
    const systemPrompt = request.messages[0]?.content;
    assert.equal(typeof systemPrompt, 'string');
    return new Promise((resolve) => {
      this.pending.push({ systemPrompt, resolve });
    });
  }

  async *stream(_request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error('测试不应调用流式接口');
  }

  resolve(fragment: string, text: string): void {
    const index = this.pending.findIndex((call) => call.systemPrompt.includes(fragment));
    assert.notEqual(index, -1, `未找到包含 '${fragment}' 的待处理调用`);
    const [call] = this.pending.splice(index, 1);
    call!.resolve({
      text,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
  }
}

let dir: string;
let path: string;

before(() => {
  ({ dir, path } = freshDB());
});

after(() => {
  cleanupDB(dir, path);
});

beforeEach(() => {
  truncateAll();
});

function seedAgent(id: string, systemPrompt: string): void {
  new AgentRepo().upsert({
    id,
    name: id,
    department: 'dev',
    role: 'worker',
    llm: 'llm',
    systemPrompt,
    tools: [],
  });
}

async function makeServer(provider: LLMProvider) {
  new DepartmentRepo().upsert({
    id: 'dev',
    name: '开发部',
    head: '',
  });
  seedAgent('agent-a', '旧配置-A');
  seedAgent('agent-b', '稳定配置-B');

  const registry = new LLMRegistry();
  (registry as any).providers.set('llm', provider);
  (registry as any).metadata.set('llm', {
    source: 'test',
    enabled: true,
    model: 'test',
    type: 'openai',
  });
  const orchestrator = {
    getEvents: () => ({}),
    bindEvents() {},
    updateConfig() {},
  };
  return createServer({
    orchestrator: orchestrator as any,
    llmRegistry: registry,
    companyRoot: tmpdir(),
    bossName: '球球',
    providerRepo: {} as any,
    configService: new ConfigService(),
  }, { host: '127.0.0.1', port: 0 });
}

async function createDirect(
  app: Awaited<ReturnType<typeof makeServer>>['app'],
  agentId: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: { kind: 'direct', agentIds: [agentId] },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().id;
}

async function sendMessage(
  app: Awaited<ReturnType<typeof makeServer>>['app'],
  conversationId: string,
  content: string,
): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/conversations/${conversationId}/messages`,
    payload: { content },
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function waitForSocketEvent(
  socket: WebSocket,
  predicate: (event: Record<string, unknown>) => boolean,
  timeoutMs = 1_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('等待 WebSocket 事件超时'));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      let event: unknown;
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (
        typeof event !== 'object'
        || event === null
        || Array.isArray(event)
        || !predicate(event as Record<string, unknown>)
      ) {
        return;
      }
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(event as Record<string, unknown>);
    };
    socket.on('message', onMessage);
  });
}

test('PUT Agent 使目标 generation 失效并用新配置重跑，其他 Agent 不受影响', async () => {
  const provider = new ControlledProvider();
  const server = await makeServer(provider);
  const repo = new ConversationRepo();
  try {
    const conversationA = await createDirect(server.app, 'agent-a');
    const conversationB = await createDirect(server.app, 'agent-b');
    await sendMessage(server.app, conversationA, '问题-A');
    await sendMessage(server.app, conversationB, '问题-B');

    const update = await server.app.inject({
      method: 'PUT',
      url: '/api/agents/agent-a',
      payload: { systemPrompt: '新配置-A' },
    });
    assert.equal(update.statusCode, 200, update.body);

    provider.resolve('旧配置-A', '旧配置结果不得落库');
    provider.resolve('稳定配置-B', 'B 正常回复');
    await settle();

    assert.deepEqual(
      repo.listMessages(conversationA).map((message) => message.content),
      ['问题-A'],
    );
    assert.deepEqual(
      repo.listMessages(conversationB).map((message) => message.content),
      ['问题-B', 'B 正常回复'],
    );

    provider.resolve('新配置-A', 'A 新配置回复');
    await settle();
    assert.deepEqual(
      repo.listMessages(conversationA).map((message) => message.content),
      ['问题-A', 'A 新配置回复'],
    );
  } finally {
    await server.app.close();
  }
});

test('DELETE Agent 使目标 processing failed 且旧结果不落库，其他 Agent 不受影响', async () => {
  const provider = new ControlledProvider();
  const server = await makeServer(provider);
  const repo = new ConversationRepo();
  try {
    const conversationA = await createDirect(server.app, 'agent-a');
    const conversationB = await createDirect(server.app, 'agent-b');
    await sendMessage(server.app, conversationA, '删除前问题-A');
    await sendMessage(server.app, conversationB, '删除时问题-B');

    const remove = await server.app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-a',
    });
    assert.equal(remove.statusCode, 200, remove.body);
    assert.deepEqual(remove.json(), { ok: true });

    provider.resolve('旧配置-A', '删除后的旧结果不得落库');
    provider.resolve('稳定配置-B', 'B 删除期间正常回复');
    await settle();

    assert.deepEqual(
      repo.listMessages(conversationA).map((message) => message.content),
      ['删除前问题-A'],
    );
    assert.deepEqual(
      repo.listMessages(conversationB).map((message) => message.content),
      ['删除时问题-B', 'B 删除期间正常回复'],
    );
    const delivery = getDB().prepare(
      `SELECT status, batch_id, error
       FROM conversation_deliveries
       WHERE conversation_id = ? AND agent_id = 'agent-a'`,
    ).get(conversationA) as {
      status: string;
      batch_id: string | null;
      error: string | null;
    };
    assert.deepEqual(delivery, {
      status: 'failed',
      batch_id: null,
      error: 'Agent 已删除',
    });
  } finally {
    await server.app.close();
  }
});

test('DELETE conversation 清理生产 Runtime，旧 in-flight 不落库不发状态', async () => {
  const provider = new ControlledProvider();
  const server = await makeServer(provider);
  const repo = new ConversationRepo();
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const observed: Record<string, unknown>[] = [];
  const recordEvent = (data: WebSocket.RawData) => {
    let event: unknown;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof event === 'object' && event !== null && !Array.isArray(event)) {
      observed.push(event as Record<string, unknown>);
    }
  };
  socket.on('message', recordEvent);

  try {
    await waitForSocketEvent(socket, (event) => event.type === 'connected');
    const conversationId = await createDirect(server.app, 'agent-a');
    await sendMessage(server.app, conversationId, '删除会话前的问题');
    assert.equal(provider.pending.length, 1);

      const deletedEvent = waitForSocketEvent(
      socket,
      (event) =>
          event.type === 'conversation_deleted'
        && event.conversationId === conversationId,
    );
    const remove = await server.app.inject({
      method: 'DELETE',
      url: `/api/conversations/${conversationId}`,
    });
    assert.equal(remove.statusCode, 200, remove.body);
    assert.deepEqual(remove.json(), { ok: true });
      await deletedEvent;
    observed.length = 0;

    provider.resolve('旧配置-A', '删除会话后的旧结果不得落库');
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(repo.get(conversationId), null);
    assert.deepEqual(
      observed.filter((event) =>
        event.conversationId === conversationId
        && (event.type === 'conversation_message' || event.type === 'conversation_state')),
      [],
    );
  } finally {
    socket.off('message', recordEvent);
    socket.close();
    await server.app.close();
  }
});

test('PUT 禁用 Agent 使目标 processing failed 且旧结果不落库', async () => {
  const provider = new ControlledProvider();
  const server = await makeServer(provider);
  const repo = new ConversationRepo();
  try {
    const conversation = await createDirect(server.app, 'agent-a');
    await sendMessage(server.app, conversation, '禁用前问题');

    const disable = await server.app.inject({
      method: 'PUT',
      url: '/api/agents/agent-a',
      payload: { enabled: false },
    });
    assert.equal(disable.statusCode, 200, disable.body);
    assert.equal(disable.json().enabled, false);

    provider.resolve('旧配置-A', '禁用后的旧结果不得落库');
    await settle();

    assert.deepEqual(
      repo.listMessages(conversation).map((message) => message.content),
      ['禁用前问题'],
    );
    const delivery = getDB().prepare(
      `SELECT status, batch_id, error
       FROM conversation_deliveries
       WHERE conversation_id = ? AND agent_id = 'agent-a'`,
    ).get(conversation) as {
      status: string;
      batch_id: string | null;
      error: string | null;
    };
    assert.deepEqual(delivery, {
      status: 'failed',
      batch_id: null,
      error: "Agent 'agent-a' 不存在或未启用",
    });
  } finally {
    await server.app.close();
  }
});

test('WebSocket 广播三类会话事件，达到消息上限后额外广播会话更新', async () => {
  const provider: LLMProvider = {
    id: 'llm',
    type: 'openai',
    async chat() {
      return {
        text: '{"decision":"speak","content":"达到上限"}',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
    async *stream() {
      throw new Error('测试不应调用流式接口');
    },
  };
  const server = await makeServer(provider);
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  try {
    const connected = await waitForSocketEvent(
      socket,
      (event) => event.type === 'connected',
    );
    assert.deepEqual(Object.keys(connected).sort(), ['timestamp', 'type']);

    const createUpdated = waitForSocketEvent(
      socket,
      (event) => event.type === 'conversation_updated',
    );
    const create = await server.app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {
        kind: 'group',
        title: '事件载荷测试',
        agentIds: ['agent-a', 'agent-b'],
        agentMessageLimit: 1,
        maxConsecutiveSpeeches: 100,
        schedulerMode: 'llm',
        schedulerLlm: 'llm',
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const conversationId = create.json().id as string;
    assert.deepEqual(await createUpdated, {
      type: 'conversation_updated',
      conversationId,
    });

    const pauseUpdated = waitForSocketEvent(
      socket,
      (event) =>
        event.type === 'conversation_updated'
        && event.conversationId === conversationId,
    );
    const pause = await server.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/members/agent-b/pause`,
    });
    assert.equal(pause.statusCode, 200, pause.body);
    await pauseUpdated;

    const messageEvent = waitForSocketEvent(
      socket,
      (event) =>
        event.type === 'conversation_message'
        && event.conversationId === conversationId
        && (event.message as { senderId?: unknown } | undefined)?.senderId === 'boss',
    );
    const stateEvent = waitForSocketEvent(
      socket,
      (event) =>
        event.type === 'conversation_state'
        && event.conversationId === conversationId
        && event.agentId === 'agent-a',
    );
    const automaticUpdated = waitForSocketEvent(
      socket,
      (event) =>
        event.type === 'conversation_updated'
        && event.conversationId === conversationId,
      7_000,
    );
    const send = await server.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/messages`,
      payload: { content: '开始讨论' },
    });
    assert.equal(send.statusCode, 200, send.body);

    assert.deepEqual(await messageEvent, {
      type: 'conversation_message',
      conversationId,
      message: send.json(),
    });
    const state = await stateEvent;
    assert.deepEqual(Object.keys(state).sort(), [
      'agentId',
      'conversationId',
      'since',
      'state',
      'type',
    ]);
    assert.equal(state.type, 'conversation_state');
    assert.equal(state.conversationId, conversationId);
    assert.equal(state.agentId, 'agent-a');
    assert.equal(state.state, 'cooling');
    assert.equal(typeof state.since, 'number');
    assert.deepEqual(await automaticUpdated, {
      type: 'conversation_updated',
      conversationId,
    });

    const detail = await server.app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}`,
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().paused, true);
    assert.equal(detail.json().pauseReason, 'limit');
  } finally {
    socket.close();
    await server.app.close();
  }
});
