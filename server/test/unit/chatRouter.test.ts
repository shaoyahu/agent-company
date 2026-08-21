/**
 * orchestrator/chat-router.ts 单测
 *
 * 关键:用 mock 的 LLMRegistry / MessageBus 隔离 LLM 真实调用
 * 注意:FakeBus.publish 不能 emit 'message'(会触发 router 无限递归),
 *       测试用 deliver() 显式 emit 'message' 触发路由。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { ChatRouter } from '../../src/orchestrator/chat-router.js';
import type { ChatMessage, AgentConfig } from '../../src/types/company.js';
import { freshDB, cleanupDB } from '../helpers/db.js';

let dir: string;
let path: string;

before(() => {
  ({ dir, path } = freshDB());
});

after(() => {
  cleanupDB(dir, path);
});

beforeEach(() => {
  const db = new Database(path);
  db.exec(`DELETE FROM messages`);
  db.close();
});

// =================== Mocks ===================

class FakeLLM {
  constructor(public replyText: string) {}
  async chat(_opts: any): Promise<{ text: string }> {
    return { text: this.replyText };
  }
}

class FakeLLMRegistry {
  providers = new Map<string, FakeLLM>();
  set(id: string, provider: FakeLLM) { this.providers.set(id, provider); }
  get(id: string): FakeLLM | undefined { return this.providers.get(id); }
}

class FakeBus extends EventEmitter {
  published: Array<any> = [];
  async publish(opts: any): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: 'fake-' + this.published.length,
      projectId: opts.projectId,
      channel: opts.channel,
      fromId: opts.fromId,
      fromName: opts.fromName,
      fromRole: opts.fromRole,
      content: opts.content,
      type: opts.type ?? 'message',
      toolName: opts.toolName,
      toolInput: opts.toolInput,
      mentions: opts.mentions ?? [],
      createdAt: Date.now(),
    };
    this.published.push(msg);
    // 不 emit 'message' — 否则 router 收到自己发的 reply,又触发 reply(reply 的 fromId != msg.fromId? 不会,
    // reply 的 fromId 是 agent.id,msg.fromId 是 boss,可能真的又触发)。
    // 安全做法:完全不 emit,让测试用 deliver() 显式触发。
    return msg;
  }
}

const AGENTS: AgentConfig[] = [
  { id: 'a-product', name: '产品-小李', department: 'product', role: 'head', llm: 'p-product', systemPrompt: '', tools: [] },
  { id: 'a-dev', name: '研发-老王', department: 'dev', role: 'head', llm: 'p-dev', systemPrompt: '', tools: [] },
  { id: 'a-qa', name: 'QA-小赵', department: 'qa', role: 'head', llm: 'p-qa', systemPrompt: '', tools: [] },
];

function makeRouter() {
  const bus = new FakeBus() as any;
  const registry = new FakeLLMRegistry();
  registry.set('p-product', new FakeLLM('SKIP'));
  registry.set('p-dev', new FakeLLM('我来接活'));
  registry.set('p-qa', new FakeLLM('SKIP'));
  const router = new ChatRouter(bus, registry as any, () => AGENTS);
  return { bus, registry, router };
}

function makeMsg(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-' + Math.random(),
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: 'test',
    type: 'message',
    mentions: [],
    createdAt: Date.now(),
    ...over,
  };
}

/** 发 message 事件触发 router,然后等异步 handler 完成 */
async function deliver(bus: FakeBus, msg: ChatMessage) {
  bus.emit('message', msg);
  // routeMessage → maybeReply → provider.chat 是 async,等久一点
  await new Promise((r) => setTimeout(r, 30));
}

function repliesFrom(bus: FakeBus) {
  return bus.published.filter((p: any) => p.fromId !== 'boss');
}

// =================== findCandidates (通过行为测) ===================

test('无 mention 时所有 agent 都是候选', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ mentions: [] });
  await deliver(bus, msg);
  // 3 个 agent 都跑了 maybeReply:product/qa SKIP,dev 发了一条
  const replies = repliesFrom(bus);
  assert.equal(replies.length, 1, '只有 dev 回复');
  assert.equal(replies[0].content, '我来接活');
});

test('有 @mention 时只 @ 过的 agent 是候选', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ mentions: ['a-dev'] });
  await deliver(bus, msg);
  const replies = repliesFrom(bus);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].fromId, 'a-dev');
});

test('@ 部门名时匹配部门下所有 agent', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ mentions: ['dev'] });
  await deliver(bus, msg);
  const replies = repliesFrom(bus);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].fromId, 'a-dev');
});

// =================== routeMessage 过滤 ===================

test('自己发的消息不接(避免自回复)', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ fromId: 'a-dev', fromName: '研发-老王', content: '我刚说完' });
  await deliver(bus, msg);
  // a-dev 自己是消息发送者,不应被路由
  const fromDev = bus.published.filter((p: any) => p.fromId === 'a-dev');
  assert.deepEqual(fromDev, [], '不应自回复');
});

test('type=tool 不路由', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ type: 'tool', content: 'shell ls' });
  await deliver(bus, msg);
  const replies = repliesFrom(bus);
  assert.equal(replies.length, 0, 'tool 消息不路由');
});

test('type=system 不路由', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ type: 'system', content: 'server started' });
  await deliver(bus, msg);
  const replies = repliesFrom(bus);
  assert.equal(replies.length, 0, 'system 消息不路由');
});

// =================== maybeReply 行为 ===================

test('LLM 返 SKIP 不发送', async () => {
  const { bus, registry, router } = makeRouter();
  registry.set('p-dev', new FakeLLM('SKIP'));
  const msg = makeMsg({ mentions: ['a-dev'] });
  await deliver(bus, msg);
  const replies = bus.published.filter((p: any) => p.fromId === 'a-dev');
  assert.equal(replies.length, 0, 'SKIP 不发');
});

test('LLM 返 "SKIP\\n..." 也跳过(startsWith SKIP)', async () => {
  const { bus, registry, router } = makeRouter();
  registry.set('p-dev', new FakeLLM('SKIP\n我没什么想说的'));
  const msg = makeMsg({ mentions: ['a-dev'] });
  await deliver(bus, msg);
  const replies = bus.published.filter((p: any) => p.fromId === 'a-dev');
  assert.equal(replies.length, 0, 'SKIP 前缀也跳过');
});

test('LLM 返空字符串不发送', async () => {
  const { bus, registry, router } = makeRouter();
  registry.set('p-dev', new FakeLLM(''));
  const msg = makeMsg({ mentions: ['a-dev'] });
  await deliver(bus, msg);
  const replies = bus.published.filter((p: any) => p.fromId === 'a-dev');
  assert.equal(replies.length, 0, '空内容不发');
});

test('LLM 返内容则 publish 到 channel', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ channel: 'dev', mentions: ['a-dev'] });
  await deliver(bus, msg);
  const replies = bus.published.filter((p: any) => p.fromId === 'a-dev');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].content, '我来接活');
  assert.equal(replies[0].channel, 'dev', '应发到原 channel');
  assert.equal(replies[0].projectId, msg.projectId);
});

test('reply 的 fromRole 包含 department 和 role', async () => {
  const { bus, router } = makeRouter();
  const msg = makeMsg({ mentions: ['a-dev'] });
  await deliver(bus, msg);
  const reply = bus.published.find((p: any) => p.fromId === 'a-dev');
  assert.equal(reply.fromRole, 'dev · head');
});

test('agent.llm 找不到 provider 时抛错并被 catch', async () => {
  const bus = new FakeBus() as any;
  const registry = new FakeLLMRegistry();
  // 不注册 a-product 的 llm
  registry.set('p-dev', new FakeLLM('hi'));
  registry.set('p-qa', new FakeLLM('hi'));
  const router = new ChatRouter(bus, registry as any, () => AGENTS);
  // 抑制 console.error(routeMessage catch 内部会打)
  const orig = console.error;
  console.error = () => {};
  try {
    const msg = makeMsg();
    await deliver(bus, msg);
    // 等 catch handler 跑完
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    console.error = orig;
  }
  // 不应崩;其他正常 agent 的 reply 也不应发(因为路由在 maybeReply 内 try/catch)
  const replies = repliesFrom(bus);
  // a-product 抛错被 catch,a-dev 返 hi(发),a-qa 返 hi(发) → 2 条
  // 关键:不该崩,且 a-product 不应有 reply
  const productReply = bus.published.find((p: any) => p.fromId === 'a-product');
  assert.equal(productReply, undefined, 'product LLM 缺失不应有 reply');
  assert.ok(replies.length >= 1, '其他 agent 正常发 reply');
});

// =================== shouldOpenMeeting ===================

test('shouldOpenMeeting:boss + 2+ mention → true', () => {
  const m = makeMsg({ fromId: 'boss', mentions: ['a-dev', 'a-qa'] });
  assert.equal(ChatRouter.shouldOpenMeeting(m), true);
});

test('shouldOpenMeeting:boss + 1 mention → false', () => {
  const m = makeMsg({ fromId: 'boss', mentions: ['a-dev'] });
  assert.equal(ChatRouter.shouldOpenMeeting(m), false);
});

test('shouldOpenMeeting:boss + 0 mention → false', () => {
  const m = makeMsg({ fromId: 'boss', mentions: [] });
  assert.equal(ChatRouter.shouldOpenMeeting(m), false);
});

test('shouldOpenMeeting:非 boss 永远 false', () => {
  const m = makeMsg({ fromId: 'a-dev', mentions: ['a-product', 'a-qa'] });
  assert.equal(ChatRouter.shouldOpenMeeting(m), false);
});

test('shouldOpenMeeting:mentions undefined → false', () => {
  const m = makeMsg({ fromId: 'boss' });
  m.mentions = undefined as any;
  assert.equal(ChatRouter.shouldOpenMeeting(m), false);
});
