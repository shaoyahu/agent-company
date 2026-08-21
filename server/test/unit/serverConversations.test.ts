import Fastify, { type FastifyInstance } from 'fastify';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerConversationRoutes } from '../../src/api/conversations.js';
import type {
  Conversation,
  ConversationMessage,
  ParticipantState,
} from '../../src/conversations/types.js';
import { ConversationRuntimeManager } from '../../src/conversations/runtime.js';
import { ConversationRepo } from '../../src/store/conversations.js';
import { getDB } from '../../src/store/db.js';
import type { AgentConfig } from '../../src/types/company.js';
import { cleanupDB, freshDB, truncateAll } from '../helpers/db.js';

let app: FastifyInstance;
let dir: string;
let path: string;
let repo: ConversationRepo;
let messages: ConversationMessage[];
let updates: string[];
let deletions: string[];
let groupNotifications: string[];
let messageOrder: string[];
let runtimeHooks: string[];
let runtime: ConversationRuntimeManager;
let states: Array<{
  conversationId: string;
  agentId: string;
  state: ParticipantState;
}>;
let directReply: (conversation: Conversation, agentId: string) => Promise<string>;

const agents: AgentConfig[] = [
  {
    id: 'agent-a',
    name: '甲',
    department: 'dev',
    role: 'worker',
    llm: 'llm',
    systemPrompt: '',
    tools: [],
  },
  {
    id: 'agent-b',
    name: '乙',
    department: 'dev',
    role: 'worker',
    llm: 'llm',
    systemPrompt: '',
    tools: [],
  },
  {
    id: 'agent-c',
    name: '丙',
    department: 'dev',
    role: 'worker',
    llm: 'llm',
    systemPrompt: '',
    tools: [],
  },
  {
    id: 'agent-disabled',
    name: '停用',
    department: 'dev',
    role: 'worker',
    llm: 'llm',
    systemPrompt: '',
    tools: [],
    enabled: false,
  } as AgentConfig,
];
let configuredAgents: AgentConfig[] = agents;

before(async () => {
  ({ dir, path } = freshDB());
  repo = new ConversationRepo();
  app = Fastify({ logger: false });
  const captureMessage = (message: ConversationMessage) => {
    assert.ok(
      repo.listMessages(message.conversationId).some((stored) => stored.id === message.id),
      'onMessage 调用前消息必须已经落库',
    );
    messages.push(message);
    messageOrder.push(`message:${message.id}`);
  };
  runtime = new ConversationRuntimeManager(
    repo,
    { decideAndSpeak: async () => ({ decision: 'skip' }) },
    () => configuredAgents,
    {
      message: captureMessage,
      state: (event) => {
        states.push({
          conversationId: event.conversationId,
          agentId: event.agentId,
          state: event.state,
        });
      },
    },
    undefined,
    (conversation, agentId) => directReply(conversation, agentId),
  );
  registerConversationRoutes(app, {
    repo,
    getAgents: () => configuredAgents,
    hasProvider: (id) => id === 'llm',
    bossName: '球球',
    onMessage: captureMessage,
    notifyMessage: (conversationId) => {
      groupNotifications.push(conversationId);
      messageOrder.push(`notify:${conversationId}`);
      runtime.notifyMessage(conversationId);
    },
    notifyMembershipChanged: (conversationId) => {
      runtimeHooks.push(`membership-changed:${conversationId}`);
      runtime.notifyMembershipChanged(conversationId);
    },
    pauseConversation: (conversationId) => {
      runtimeHooks.push(`pause-conversation:${conversationId}`);
      runtime.pauseConversation(conversationId);
    },
    resumeConversation: (conversationId) => {
      runtimeHooks.push(`resume-conversation:${conversationId}`);
      runtime.resumeConversation(conversationId);
    },
    pauseAgent: (conversationId, agentId) => {
      runtimeHooks.push(`pause-agent:${conversationId}:${agentId}`);
      runtime.pauseAgent(conversationId, agentId);
    },
    resumeAgent: (conversationId, agentId) => {
      runtimeHooks.push(`resume-agent:${conversationId}:${agentId}`);
      runtime.resumeAgent(conversationId, agentId);
    },
    removeConversation: (conversationId) => {
      runtimeHooks.push(`remove-conversation:${conversationId}`);
      runtime.removeConversation(conversationId);
    },
    onConversationUpdated: (conversationId) => updates.push(conversationId),
    onConversationDeleted: (conversationId) => deletions.push(conversationId),
  });
  await app.ready();
});

after(async () => {
  runtime.stop();
  await app.close();
  cleanupDB(dir, path);
});

beforeEach(() => {
  runtime.stop();
  truncateAll();
  messages = [];
  updates = [];
  deletions = [];
  groupNotifications = [];
  messageOrder = [];
  runtimeHooks = [];
  states = [];
  configuredAgents = agents;
  directReply = async () => '默认完整回复';
  runtime.start();
});

async function createGroup(agentIds = ['agent-a', 'agent-b']) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: {
      kind: 'group',
      title: '架构讨论',
      agentIds,
      schedulerMode: 'llm',
      schedulerLlm: 'llm',
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

test('会话列表、创建、详情和删除覆盖完整 endpoint', async () => {
  const empty = await app.inject({ method: 'GET', url: '/api/conversations' });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), []);

  const create = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: { kind: 'direct', agentIds: ['agent-a'] },
  });
  assert.equal(create.statusCode, 200, create.body);
  const detail = create.json();
  assert.equal(detail.kind, 'direct');
  assert.equal(detail.title, '与甲对话');
  assert.deepEqual(detail.members.map((member: { memberId: string }) => member.memberId), [
    'boss',
    'agent-a',
  ]);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: { kind: 'direct', agentIds: ['agent-a'] },
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().id, detail.id);

  const get = await app.inject({
    method: 'GET',
    url: `/api/conversations/${detail.id}`,
  });
  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.json().members, detail.members);

  const list = await app.inject({ method: 'GET', url: '/api/conversations' });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);

  const pin = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/pin`,
  });
  assert.equal(pin.statusCode, 200);
  assert.equal(pin.json().pinned, true);

  const mute = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/mute`,
  });
  assert.equal(mute.statusCode, 200);
  assert.equal(mute.json().muted, true);

  const read = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/read`,
  });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().lastReadSequence, 0);

  const profile = await app.inject({
    method: 'PATCH',
    url: `/api/conversations/${detail.id}`,
    payload: { title: '新版标题', avatar: '队' },
  });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().title, '新版标题');
  assert.equal(profile.json().avatar, '队');

  const badProfile = await app.inject({
    method: 'PATCH',
    url: `/api/conversations/${detail.id}`,
    payload: { title: '', avatar: '队' },
  });
  assert.equal(badProfile.statusCode, 400);
  assert.match(badProfile.json().error, /会话标题不能为空/);

  const unmute = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/unmute`,
  });
  assert.equal(unmute.statusCode, 200);
  assert.equal(unmute.json().muted, false);

  const unpin = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/unpin`,
  });
  assert.equal(unpin.statusCode, 200);
  assert.equal(unpin.json().pinned, false);

  const remove = await app.inject({
    method: 'DELETE',
    url: `/api/conversations/${detail.id}`,
  });
  assert.equal(remove.statusCode, 200);
  assert.deepEqual(remove.json(), { ok: true });
  assert.deepEqual(updates, [
    detail.id,
    detail.id,
    detail.id,
    detail.id,
    detail.id,
    detail.id,
    detail.id,
  ]);
  assert.deepEqual(deletions, [detail.id]);
  assert.deepEqual(runtimeHooks, [`remove-conversation:${detail.id}`]);

  const missing = await app.inject({
    method: 'GET',
    url: `/api/conversations/${detail.id}`,
  });
  assert.equal(missing.statusCode, 404);
  assert.match(missing.json().error, /会话不存在/);
});

test('创建群聊必须回传隐藏调度器配置且调度器 Agent 不进入成员列表', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: {
      kind: 'group',
      title: '带调度器群聊',
      agentIds: ['agent-a', 'agent-b'],
      schedulerMode: 'agent',
      schedulerAgentId: 'agent-c',
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const detail = response.json();
  assert.equal(detail.schedulerMode, 'agent');
  assert.equal(detail.schedulerAgentId, 'agent-c');
  assert.equal(detail.schedulerLlm, undefined);
  assert.deepEqual(
    detail.members.map((member: { memberId: string }) => member.memberId),
    ['boss', 'agent-a', 'agent-b'],
  );
});

test('创建校验 direct、group、Agent 存在启用且不重复', async () => {
  const cases = [
    {
      payload: { kind: 'direct', agentIds: ['agent-a', 'agent-b'] },
      error: /私聊/,
    },
    {
      payload: { kind: 'group', title: '少成员', agentIds: ['agent-a'] },
      error: /群聊至少需要两个 Agent/,
    },
    {
      payload: { kind: 'group', title: '重复', agentIds: ['agent-a', 'agent-a'] },
      error: /重复/,
    },
    {
      payload: { kind: 'direct', agentIds: ['missing'] },
      error: /Agent.*不存在/,
    },
    {
      payload: { kind: 'direct', agentIds: ['agent-disabled'] },
      error: /Agent.*未启用/,
    },
    {
      payload: { kind: 'direct', agentIds: ['boss'] },
      error: /boss/,
    },
    {
      payload: { kind: 'direct', agentIds: ['__proto__'] },
      error: /有效字符串/,
    },
    {
      payload: { kind: 'group', title: '   ', agentIds: ['agent-a', 'agent-b'] },
      error: /标题/,
    },
    {
      payload: { kind: 'group', title: '缺少调度器', agentIds: ['agent-a', 'agent-b'] },
      error: /群聊必须配置调度器/,
    },
    {
      payload: {
        kind: 'group',
        title: '未知调度 LLM',
        agentIds: ['agent-a', 'agent-b'],
        schedulerMode: 'llm',
        schedulerLlm: 'missing-llm',
      },
      error: /调度器 LLM 不存在/,
    },
    {
      payload: {
        kind: 'group',
        title: '未知调度 Agent',
        agentIds: ['agent-a', 'agent-b'],
        schedulerMode: 'agent',
        schedulerAgentId: 'missing',
      },
      error: /Agent 'missing' 不存在/,
    },
  ];

  for (const item of cases) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: item.payload,
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error, item.error);
  }
});

test('外部创建 cooldownMs 只接受固定数值 5000', async () => {
  for (const cooldownMs of [0, 4_999, 5_001, '5000', null]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {
        kind: 'direct',
        agentIds: ['agent-a'],
        cooldownMs,
      },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error, /冷却.*5000/);
  }

  const accepted = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: {
      kind: 'direct',
      agentIds: ['agent-a'],
      cooldownMs: 5_000,
    },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().cooldownMs, 5_000);
});

test('外部创建拒绝所有数值配置的 null', async () => {
  const existing = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: {
      kind: 'direct',
      agentIds: ['agent-a'],
    },
  });
  assert.equal(existing.statusCode, 200, existing.body);

  const fields = [
    'agentMessageLimit',
    'maxConsecutiveSpeeches',
    'maxMessageChars',
    'cooldownMs',
  ] as const;
  for (const field of fields) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {
        kind: 'direct',
        agentIds: ['agent-a'],
        [field]: null,
      },
    });
    assert.equal(response.statusCode, 400, `${field}: ${response.body}`);
    assert.match(response.json().error, /配置|冷却/);
  }
});

test('成员增删写后回读，拒绝 boss、未知、停用和 hostile Agent', async () => {
  const detail = await createGroup(['agent-a', 'agent-b', 'agent-c']);
  const addTarget = 'agent-c';

  const existing = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/members`,
    payload: { agentId: addTarget },
  });
  assert.equal(existing.statusCode, 400);
  assert.match(existing.json().error, /已存在/);

  repo.removeAgentMember(detail.id, addTarget);
  const add = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/members`,
    payload: { agentId: addTarget },
  });
  assert.equal(add.statusCode, 200, add.body);
  assert.equal(add.json().memberId, addTarget);
  assert.ok(repo.listMembers(detail.id).some((member) => member.memberId === addTarget));

  const remove = await app.inject({
    method: 'DELETE',
    url: `/api/conversations/${detail.id}/members/${addTarget}`,
  });
  assert.equal(remove.statusCode, 200, remove.body);
  assert.deepEqual(remove.json(), { ok: true });
  assert.ok(!repo.listMembers(detail.id).some((member) => member.memberId === addTarget));
  assert.deepEqual(runtimeHooks, [
    `membership-changed:${detail.id}`,
    `membership-changed:${detail.id}`,
  ]);

  for (const agentId of ['boss', '__proto__', 'constructor']) {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${detail.id}/members/${agentId}`,
    });
    assert.equal(response.statusCode, 400, response.body);
  }

  for (const agentId of ['missing', 'agent-disabled']) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${detail.id}/members`,
      payload: { agentId },
    });
    assert.equal(response.statusCode, 400, response.body);
  }
});

test('会话详情过滤组织中已删除的 Agent 成员', async () => {
  const detail = await createGroup(['agent-a', 'agent-b']);
  configuredAgents = agents.filter((agent) => agent.id !== 'agent-a');

  const response = await app.inject({
    method: 'GET',
    url: `/api/conversations/${detail.id}`,
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(
    response.json().members.map((member: { memberId: string }) => member.memberId),
    ['boss', 'agent-b'],
  );
});

test('移除 Agent 时 pending 和 processing 投递都 failed 并通知 Runtime', async () => {
  const detail = await createGroup(['agent-a', 'agent-b', 'agent-c']);
  repo.appendMessage({
    id: 'm1',
    conversationId: detail.id,
    senderId: 'boss',
    senderType: 'human',
    content: '第一条',
  });
  repo.claimPending(detail.id, 'agent-c', 'batch-c');
  repo.appendMessage({
    id: 'm2',
    conversationId: detail.id,
    senderId: 'boss',
    senderType: 'human',
    content: '第二条',
  });

  const remove = await app.inject({
    method: 'DELETE',
    url: `/api/conversations/${detail.id}/members/agent-c`,
  });
  assert.equal(remove.statusCode, 200, remove.body);
  const rows = repo.listMessages(detail.id).flatMap((message) => {
    const row = getDB().prepare(
      `SELECT status, batch_id, error
       FROM conversation_deliveries
       WHERE message_id = ? AND agent_id = 'agent-c'`,
    ).get(message.id);
    return row ? [row] : [];
  }) as Array<{ status: string; batch_id: string | null; error: string }>;
  assert.deepEqual(rows, [
    { status: 'failed', batch_id: null, error: '已移出群聊' },
    { status: 'failed', batch_id: null, error: '已移出群聊' },
  ]);
  assert.deepEqual(runtimeHooks, [`membership-changed:${detail.id}`]);
});

test('消息发送固定 boss、落库后回调，并支持分页回读', async () => {
  const detail = await createGroup();
  const send = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/messages`,
    payload: { content: '  大家好  ' },
  });
  assert.equal(send.statusCode, 200, send.body);
  assert.equal(send.json().senderId, 'boss');
  assert.equal(send.json().senderType, 'human');
  assert.equal(send.json().content, '大家好');
  assert.equal(messages.length, 1);
  assert.deepEqual(groupNotifications, [detail.id]);
  assert.deepEqual(messageOrder, [
    `message:${send.json().id}`,
    `notify:${detail.id}`,
  ]);

  repo.appendMessage({
    id: 'agent-message',
    conversationId: detail.id,
    senderId: 'agent-a',
    senderType: 'agent',
    content: '收到',
  });
  const page = await app.inject({
    method: 'GET',
    url: `/api/conversations/${detail.id}/messages?beforeSequence=2&limit=1`,
  });
  assert.equal(page.statusCode, 200, page.body);
  assert.deepEqual(page.json().map((message: { sequence: number }) => message.sequence), [1]);

  const forged = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/messages`,
    payload: { content: '伪造', senderId: 'agent-a', senderType: 'agent' },
  });
  assert.equal(forged.statusCode, 400);
  assert.match(forged.json().error, /发送者/);
});

test('消息接口从正文解析 mentions 并按当前 enabled 成员过滤去重 hostile', async () => {
  const detail = await createGroup();
  repo.setMemberPaused(detail.id, 'agent-a', true);
  getDB().prepare(
    `UPDATE conversation_members SET enabled = 0 WHERE conversation_id = ? AND member_id = ?`,
  ).run(detail.id, 'agent-b');

  const send = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/messages`,
    payload: {
      content: [
        '@agent-a 请处理',
        '@agent-b 已停用',
        '@agent-disabled 不在群内',
        '@missing 不存在',
        '@__proto__ @constructor',
        '@agent-a 请复核',
      ].join(' '),
      mentions: ['agent-b', 'agent-disabled'],
    },
  });

  assert.equal(send.statusCode, 200, send.body);
  assert.deepEqual(send.json().mentions, ['agent-a']);
  assert.deepEqual(repo.listMessages(detail.id)[0]?.mentions, ['agent-a']);
  assert.equal(repo.hasPending(detail.id, 'agent-a'), true);
  assert.equal(repo.hasPending(detail.id, 'agent-b'), false);
});

test('direct 消息接口只等待人类消息落库，完整回复成功后追加并广播', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: { kind: 'direct', agentIds: ['agent-a'] },
  });
  const detail = create.json();
  let resolveReply!: (value: string) => void;
  directReply = async (conversation, agentId) => {
    assert.equal(conversation.id, detail.id);
    assert.equal(agentId, 'agent-a');
    return new Promise<string>((resolve) => {
      resolveReply = resolve;
    });
  };

  const send = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/messages`,
    payload: { content: '当前问题' },
  });
  assert.equal(send.statusCode, 200, send.body);
  assert.equal(send.json().content, '当前问题');
  assert.deepEqual(
    repo.listMessages(detail.id).map((message) => message.content),
    ['当前问题'],
  );
  assert.deepEqual(messages.map((message) => message.content), ['当前问题']);
  assert.deepEqual(groupNotifications, [detail.id]);

  resolveReply('第一段\n第二段');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    repo.listMessages(detail.id).map((message) => ({
      senderId: message.senderId,
      senderType: message.senderType,
      content: message.content,
    })),
    [
      { senderId: 'boss', senderType: 'human', content: '当前问题' },
      { senderId: 'agent-a', senderType: 'agent', content: '第一段\n第二段' },
    ],
  );
  assert.deepEqual(messages.map((message) => message.content), [
    '当前问题',
    '第一段\n第二段',
  ]);
  assert.deepEqual(states, [
    { conversationId: detail.id, agentId: 'agent-a', state: 'speaking' },
    { conversationId: detail.id, agentId: 'agent-a', state: 'idle' },
  ]);
  const delivery = getDB().prepare(
    `SELECT status, batch_id, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(detail.id, 'agent-a') as {
    status: string;
    batch_id: string | null;
    error: string | null;
  };
  assert.equal(delivery.status, 'processed');
  assert.ok(delivery.batch_id);
  assert.equal(delivery.error, null);
});

test('direct 回复失败只广播 error 状态，不插入伪回复', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: { kind: 'direct', agentIds: ['agent-a'] },
  });
  const detail = create.json();
  directReply = async () => {
    throw new Error("Agent 'agent-a' 引用了不可用的 LLM 'missing'");
  };

  const send = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/messages`,
    payload: { content: '请回答' },
  });
  assert.equal(send.statusCode, 200, send.body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    repo.listMessages(detail.id).map((message) => message.content),
    ['请回答'],
  );
  assert.deepEqual(states, [
    { conversationId: detail.id, agentId: 'agent-a', state: 'speaking' },
    { conversationId: detail.id, agentId: 'agent-a', state: 'error' },
  ]);
  const delivery = getDB().prepare(
    `SELECT status, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(detail.id, 'agent-a') as {
    status: string;
    error: string | null;
  };
  assert.equal(delivery.status, 'failed');
  assert.match(delivery.error ?? '', /不可用的 LLM/);
});

test('direct 手动暂停时保留 pending 且恢复后必回复', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    payload: { kind: 'direct', agentIds: ['agent-a'] },
  });
  const detail = create.json();
  let replyCalls = 0;
  directReply = async () => {
    replyCalls += 1;
    return '恢复后的完整回复';
  };

  const pause = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/pause`,
  });
  assert.equal(pause.statusCode, 200, pause.body);
  assert.equal(pause.json().pauseReason, 'manual');

  const send = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/messages`,
    payload: { content: '暂停期间的问题' },
  });
  assert.equal(send.statusCode, 200, send.body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(replyCalls, 0);
  assert.equal(repo.hasPending(detail.id, 'agent-a'), true);
  assert.deepEqual(
    repo.listMessages(detail.id).map((message) => message.content),
    ['暂停期间的问题'],
  );
  assert.equal(repo.get(detail.id)?.pauseReason, 'manual');

  const resume = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/resume`,
  });
  assert.equal(resume.statusCode, 200, resume.body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(replyCalls, 1);
  assert.equal(repo.hasPending(detail.id, 'agent-a'), false);
  assert.deepEqual(
    repo.listMessages(detail.id).map((message) => message.content),
    ['暂停期间的问题', '恢复后的完整回复'],
  );
});

test('空消息和越界分页返回中文 400', async () => {
  const detail = await createGroup();
  for (const content of [undefined, null, '', '   ']) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${detail.id}/messages`,
      payload: { content },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error, /消息内容/);
  }

  for (const query of ['limit=0', 'limit=201', 'limit=abc', 'beforeSequence=0', 'beforeSequence=abc']) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${detail.id}/messages?${query}`,
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error, /分页/);
  }
});

test('会话和 Agent 暂停恢复 endpoint 写后回读', async () => {
  const detail = await createGroup();
  const pause = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/pause`,
  });
  assert.equal(pause.statusCode, 200);
  assert.equal(pause.json().paused, true);
  assert.equal(repo.get(detail.id)?.paused, true);

  const resume = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/resume`,
  });
  assert.equal(resume.statusCode, 200);
  assert.equal(resume.json().paused, false);
  assert.equal(repo.get(detail.id)?.paused, false);

  const pauseAgent = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/members/agent-a/pause`,
  });
  assert.equal(pauseAgent.statusCode, 200);
  assert.equal(pauseAgent.json().paused, true);
  assert.equal(
    repo.listMembers(detail.id).find((member) => member.memberId === 'agent-a')?.paused,
    true,
  );

  const resumeAgent = await app.inject({
    method: 'POST',
    url: `/api/conversations/${detail.id}/members/agent-a/resume`,
  });
  assert.equal(resumeAgent.statusCode, 200);
  assert.equal(resumeAgent.json().paused, false);
  assert.equal(
    repo.listMembers(detail.id).find((member) => member.memberId === 'agent-a')?.paused,
    false,
  );
  assert.deepEqual(runtimeHooks, [
    `pause-conversation:${detail.id}`,
    `resume-conversation:${detail.id}`,
    `pause-agent:${detail.id}:agent-a`,
    `resume-agent:${detail.id}:agent-a`,
  ]);
});

test('新人类消息只解除 limit 自动暂停，不解除 manual 暂停', async () => {
  const limited = await createGroup();
  repo.setConversationPaused(limited.id, true, 'limit');
  const resumeLimited = await app.inject({
    method: 'POST',
    url: `/api/conversations/${limited.id}/messages`,
    payload: { content: '继续讨论' },
  });
  assert.equal(resumeLimited.statusCode, 200, resumeLimited.body);
  assert.equal(repo.get(limited.id)?.paused, false);
  assert.equal(repo.get(limited.id)?.pauseReason, undefined);
  assert.ok(runtimeHooks.includes(`resume-conversation:${limited.id}`));

  runtimeHooks = [];
  const manual = await createGroup();
  repo.setConversationPaused(manual.id, true, 'manual');
  const keepManual = await app.inject({
    method: 'POST',
    url: `/api/conversations/${manual.id}/messages`,
    payload: { content: '这条消息不能解除手动暂停' },
  });
  assert.equal(keepManual.statusCode, 200, keepManual.body);
  assert.equal(repo.get(manual.id)?.paused, true);
  assert.equal(repo.get(manual.id)?.pauseReason, 'manual');
  assert.ok(!runtimeHooks.includes(`resume-conversation:${manual.id}`));
  assert.equal(repo.hasPending(manual.id, 'agent-a'), true);
});

test('limit 自动恢复失败接口不留消息或 pending，重试后不重复', async () => {
  const limited = await createGroup();
  repo.setConversationPaused(limited.id, true, 'limit');
  const db = getDB();
  db.exec(`
    CREATE TRIGGER fail_api_limit_auto_resume
    BEFORE UPDATE OF paused ON conversations
    WHEN OLD.pause_reason = 'limit' AND NEW.paused = 0
    BEGIN
      SELECT RAISE(ABORT, '模拟接口 limit 自动恢复失败');
    END;
  `);

  try {
    const failed = await app.inject({
      method: 'POST',
      url: `/api/conversations/${limited.id}/messages`,
      payload: { content: '失败后重试的同一条消息' },
    });
    assert.equal(failed.statusCode, 400, failed.body);
    assert.match(failed.json().error, /模拟接口 limit 自动恢复失败/);
    assert.deepEqual(repo.listMessages(limited.id), []);
    const deliveryCount = db.prepare(
      `SELECT COUNT(*) AS count FROM conversation_deliveries
       WHERE conversation_id = ?`,
    ).get(limited.id) as { count: number };
    assert.equal(deliveryCount.count, 0);
    assert.equal(repo.get(limited.id)?.paused, true);
    assert.equal(repo.get(limited.id)?.pauseReason, 'limit');
    assert.deepEqual(messages, []);
    assert.ok(!runtimeHooks.includes(`resume-conversation:${limited.id}`));
  } finally {
    db.exec(`DROP TRIGGER fail_api_limit_auto_resume`);
  }

  const retried = await app.inject({
    method: 'POST',
    url: `/api/conversations/${limited.id}/messages`,
    payload: { content: '失败后重试的同一条消息' },
  });
  assert.equal(retried.statusCode, 200, retried.body);
  assert.deepEqual(
    repo.listMessages(limited.id).map((message) => message.content),
    ['失败后重试的同一条消息'],
  );
  assert.deepEqual(
    db.prepare(
      `SELECT agent_id, status FROM conversation_deliveries
       WHERE conversation_id = ?
       ORDER BY agent_id`,
    ).all(limited.id),
    [
      { agent_id: 'agent-a', status: 'pending' },
      { agent_id: 'agent-b', status: 'pending' },
    ],
  );
  assert.equal(messages.length, 1);
  assert.equal(
    runtimeHooks.filter((hook) => hook === `resume-conversation:${limited.id}`).length,
    1,
  );
});

test('不存在资源映射 404，hostile 会话 id 映射中文 400', async () => {
  const missingRoutes = [
    { method: 'GET', url: '/api/conversations/missing' },
    { method: 'DELETE', url: '/api/conversations/missing' },
    { method: 'GET', url: '/api/conversations/missing/messages' },
    { method: 'POST', url: '/api/conversations/missing/pause' },
    { method: 'POST', url: '/api/conversations/missing/members/agent-a/pause' },
  ] as const;
  for (const route of missingRoutes) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 404, `${route.method} ${route.url}: ${response.body}`);
    assert.match(response.json().error, /不存在/);
  }

  for (const id of ['__proto__', 'constructor']) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}`,
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error, /会话 id/);
  }
});
