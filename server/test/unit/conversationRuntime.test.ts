import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AgentSpeaker,
  AgentSpeakerInput,
} from '../../src/conversations/agentSpeaker.js';
import {
  ConversationRuntimeManager,
  type Clock,
} from '../../src/conversations/runtime.js';
import type {
  AgentSpeechDecision,
  Conversation,
  ParticipantState,
} from '../../src/conversations/types.js';
import { ConversationRepo } from '../../src/store/conversations.js';
import { getDB } from '../../src/store/db.js';
import type { AgentConfig } from '../../src/types/company.js';
import { cleanupDB, freshDB, truncateAll } from '../helpers/db.js';

interface Timer {
  at: number;
  callback: () => void;
}

class FakeClock implements Clock {
  private current = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, Timer>();

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.current + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.timers.delete(handle);
  }

  advanceBy(delayMs: number): void {
    const target = this.current + delayMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      const [handle, timer] = next;
      this.timers.delete(handle);
      this.current = timer.at;
      timer.callback();
    }
    this.current = target;
  }
}

class RecordingSpeaker implements AgentSpeaker {
  readonly calls: AgentSpeakerInput[] = [];

  constructor(
    private readonly decide: (
      input: AgentSpeakerInput,
      callIndex: number,
    ) => Promise<AgentSpeechDecision> = async () => ({ decision: 'skip' }),
  ) {}

  decideAndSpeak(input: AgentSpeakerInput): Promise<AgentSpeechDecision> {
    this.calls.push(input);
    return this.decide(input, this.calls.length - 1);
  }
}

const agents: AgentConfig[] = ['agent-a', 'agent-b', 'agent-c'].map((id) => ({
  id,
  name: id,
  department: 'dev',
  role: 'worker',
  llm: 'llm',
  systemPrompt: '',
  tools: [],
}));

let dir: string;
let path: string;
let repo: ConversationRepo;
let clock: FakeClock;
let states: Array<{ agentId: string; state: ParticipantState; since: number }>;
let runtime: ConversationRuntimeManager | undefined;

before(() => {
  ({ dir, path } = freshDB());
  repo = new ConversationRepo();
});

after(() => {
  runtime?.stop();
  cleanupDB(dir, path);
});

beforeEach(() => {
  runtime?.stop();
  runtime = undefined;
  truncateAll();
  clock = new FakeClock();
  states = [];
});

function createGroup(agentIds = ['agent-a', 'agent-b']) {
  return repo.create({
    id: `group-${agentIds.length}`,
    kind: 'group',
    title: '运行时测试',
    agentIds,
    cooldownMs: 5_000,
    schedulerMode: 'llm',
    schedulerLlm: 'llm-main',
  });
}

function appendHuman(conversationId: string, id: string, content = id) {
  return repo.appendMessage({
    id,
    conversationId,
    senderId: 'boss',
    senderType: 'human',
    content,
  });
}

function appendAgent(
  conversationId: string,
  senderId: string,
  id: string,
  content = id,
) {
  return repo.appendMessage({
    id,
    conversationId,
    senderId,
    senderType: 'agent',
    content,
  });
}

function makeStoppedRuntime(
  speaker: AgentSpeaker,
  onState?: (agentId: string, state: ParticipantState) => void,
  onMessage?: (messageId: string) => void,
  getAgentConfigs: () => AgentConfig[] = () => agents,
  directReply?: (conversation: Conversation, agentId: string) => Promise<string>,
  onUpdated?: (conversationId: string) => void,
  scheduler?: any,
) {
  runtime = new (ConversationRuntimeManager as any)(
    repo,
    speaker,
    getAgentConfigs,
    {
      message: (message) => onMessage?.(message.id),
      state: (event) => {
        states.push({
          agentId: event.agentId,
          state: event.state,
          since: event.since,
        });
        onState?.(event.agentId, event.state);
      },
      updated: (conversationId) => onUpdated?.(conversationId),
    },
    clock,
    directReply,
    scheduler,
  );
  return runtime;
}

function makeRuntime(
  speaker: AgentSpeaker,
  onState?: (agentId: string, state: ParticipantState) => void,
  onMessage?: (messageId: string) => void,
  getAgentConfigs: () => AgentConfig[] = () => agents,
  directReply?: (conversation: Conversation, agentId: string) => Promise<string>,
  onUpdated?: (conversationId: string) => void,
  scheduler?: any,
) {
  const manager = makeStoppedRuntime(
    speaker,
    onState,
    onMessage,
    getAgentConfigs,
    directReply,
    onUpdated,
    scheduler,
  );
  runtime.start();
  return manager;
}

async function flushRuntime(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test('第一条 pending 进入 cooling，4999 毫秒不判断且 5000 毫秒恰好判断', async () => {
  const conversation = createGroup();
  const speaker = new RecordingSpeaker();
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);

  assert.deepEqual(
    states.filter((event) => event.state === 'cooling').map((event) => event.agentId),
    ['agent-a', 'agent-b'],
  );
  clock.advanceBy(4_999);
  assert.equal(speaker.calls.length, 0);
  clock.advanceBy(1);
  assert.equal(speaker.calls.length, 2);
  await flushRuntime();
});

test('cooling 中新增消息合并且不重置五秒 timer', async () => {
  const conversation = createGroup();
  const speaker = new RecordingSpeaker();
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(4_000);
  appendHuman(conversation.id, 'm2');
  manager.notifyMessage(conversation.id);

  clock.advanceBy(999);
  assert.equal(speaker.calls.length, 0);
  clock.advanceBy(1);
  assert.equal(speaker.calls.length, 2);
  for (const call of speaker.calls) {
    assert.deepEqual(call.newMessages.map((message) => message.id), ['m1', 'm2']);
  }
  await flushRuntime();
});

test('A/B/C 使用独立 Actor 并发判断', () => {
  const conversation = createGroup(['agent-a', 'agent-b', 'agent-c']);
  const speaker = new RecordingSpeaker(
    async () => new Promise<AgentSpeechDecision>(() => {}),
  );
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);

  assert.deepEqual(
    speaker.calls.map((call) => call.agent.id).sort(),
    ['agent-a', 'agent-b', 'agent-c'],
  );
  assert.deepEqual(
    states.filter((event) => event.state === 'deciding').map((event) => event.agentId).sort(),
    ['agent-a', 'agent-b', 'agent-c'],
  );
});

test('同一 Agent 只有一个 in-flight，完成后为新 pending 重新冷却', async () => {
  const conversation = createGroup();
  let resolveFirstA!: (decision: AgentSpeechDecision) => void;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-a' && !resolveFirstA) {
      return new Promise<AgentSpeechDecision>((resolve) => {
        resolveFirstA = resolve;
      });
    }
    return { decision: 'skip' };
  });
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  assert.equal(speaker.calls.filter((call) => call.agent.id === 'agent-a').length, 1);

  appendAgent(conversation.id, 'agent-b', 'm2');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  assert.equal(speaker.calls.filter((call) => call.agent.id === 'agent-a').length, 1);

  resolveFirstA({ decision: 'skip' });
  await flushRuntime();
  clock.advanceBy(4_999);
  assert.equal(speaker.calls.filter((call) => call.agent.id === 'agent-a').length, 1);
  clock.advanceBy(1);
  assert.equal(speaker.calls.filter((call) => call.agent.id === 'agent-a').length, 2);
  await flushRuntime();
});

test('deciding 使用冻结快照，期间新消息进入下一批', async () => {
  const conversation = createGroup();
  let resolveFirstA!: (decision: AgentSpeechDecision) => void;
  let firstA = true;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-a' && firstA) {
      firstA = false;
      return new Promise<AgentSpeechDecision>((resolve) => {
        resolveFirstA = resolve;
      });
    }
    return { decision: 'skip' };
  });
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  const firstCall = speaker.calls.find((call) => call.agent.id === 'agent-a');
  assert.deepEqual(firstCall?.newMessages.map((message) => message.id), ['m1']);

  appendAgent(conversation.id, 'agent-b', 'm2');
  manager.notifyMessage(conversation.id);
  assert.deepEqual(firstCall?.newMessages.map((message) => message.id), ['m1']);

  resolveFirstA({ decision: 'skip' });
  await flushRuntime();
  clock.advanceBy(5_000);
  const callsForA = speaker.calls.filter((call) => call.agent.id === 'agent-a');
  assert.equal(callsForA.length, 2);
  assert.deepEqual(callsForA[1]?.newMessages.map((message) => message.id), ['m2']);
  await flushRuntime();
});

test('speaking 使用冻结快照，自有消息不进入自己的下一批 pending', async () => {
  const conversation = createGroup();
  let injected = false;
  const speaker = new RecordingSpeaker(async (input) => (
    input.agent.id === 'agent-a' && input.newMessages[0]?.id === 'm1'
      ? { decision: 'speak', content: 'A 的完整发言' }
      : { decision: 'skip' }
  ));
  let manager!: ConversationRuntimeManager;
  manager = makeRuntime(speaker, (agentId, state) => {
    if (agentId === 'agent-a' && state === 'speaking' && !injected) {
      injected = true;
      appendAgent(conversation.id, 'agent-b', 'm2');
      manager.notifyMessage(conversation.id);
    }
  });

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();

  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => [message.senderId, message.content]),
    [
      ['boss', 'm1'],
      ['agent-b', 'm2'],
      ['agent-a', 'A 的完整发言'],
    ],
  );
  clock.advanceBy(5_000);
  const callsForA = speaker.calls.filter((call) => call.agent.id === 'agent-a');
  assert.equal(callsForA.length, 2);
  assert.deepEqual(callsForA[1]?.newMessages.map((message) => message.id), ['m2']);
  await flushRuntime();
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), false);
});

test('notifyMessage 遇到 paused 会话不会启动冷却或判断', () => {
  const conversation = createGroup();
  const speaker = new RecordingSpeaker();
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  repo.setConversationPaused(conversation.id, true, 'manual');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);

  assert.equal(speaker.calls.length, 0);
  assert.equal(states.some((event) => event.state === 'cooling'), false);
});

test('同一 Agent 已连续发言两次时第三次保护性沉默并完成当前批次', async () => {
  const conversation = createGroup();
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  appendHuman(conversation.id, 'human-1');
  appendAgent(conversation.id, 'agent-a', 'agent-a-1');
  appendAgent(conversation.id, 'agent-a', 'agent-a-2');
  const speaker = new RecordingSpeaker(async () => ({
    decision: 'speak',
    content: '不应出现的第三次发言',
  }));
  const manager = makeRuntime(speaker);

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();

  assert.equal(speaker.calls.length, 0);
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), false);
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['human-1', 'agent-a-1', 'agent-a-2'],
  );
});

test('达到会话配置的 Agent 消息上限后自动 limit 暂停且使用动态 system 文案', async () => {
  const conversation = repo.create({
    id: 'group-limit',
    kind: 'group',
    title: '讨论上限测试',
    agentIds: ['agent-a', 'agent-b'],
    agentMessageLimit: 3,
    maxConsecutiveSpeeches: 100,
    cooldownMs: 5_000,
  });
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  appendHuman(conversation.id, 'human-1');
  for (let index = 1; index <= 2; index += 1) {
    appendAgent(conversation.id, 'agent-a', `agent-a-${index}`);
  }
  const broadcastMessageIds: string[] = [];
  const speaker = new RecordingSpeaker(async () => ({
    decision: 'speak',
    content: '第 3 条 Agent 消息',
  }));
  const manager = makeRuntime(speaker, undefined, (messageId) => {
    broadcastMessageIds.push(messageId);
  });

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();

  const stored = repo.get(conversation.id);
  assert.equal(stored?.paused, true);
  assert.equal(stored?.pauseReason, 'limit');
  const systemMessages = repo
    .listMessages(conversation.id, { limit: 100 })
    .filter((message) => message.senderType === 'system');
  assert.deepEqual(
    systemMessages.map((message) => message.content),
    ['本轮 Agent 讨论已达到 3 条，为避免循环已暂停。发送新消息或手动恢复后可继续。'],
  );
  assert.equal(
    systemMessages[0]?.protectionBoundary,
    'discussion_limit_resume',
  );
  assert.deepEqual(
    broadcastMessageIds,
    [
      repo.listMessages(conversation.id, { limit: 100 }).find(
        (message) => message.content === '第 3 条 Agent 消息',
      )?.id,
      systemMessages[0]?.id,
    ],
  );
  const systemDeliveryCount = getDB().prepare(
    `SELECT COUNT(*) AS count
     FROM conversation_deliveries
     WHERE message_id = ?`,
  ).get(systemMessages[0]?.id) as { count: number };
  assert.equal(systemDeliveryCount.count, 0);

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();
  assert.equal(
    repo.listMessages(conversation.id, { limit: 100 })
      .filter((message) => message.senderType === 'system').length,
    1,
  );
});

test('隐藏调度器在 Agent 发言后可自动 scheduler 暂停并广播原因', async () => {
  const conversation = createGroup();
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  appendHuman(conversation.id, 'human-1');
  const broadcastMessageIds: string[] = [];
  const updates: string[] = [];
  const schedulerCalls: unknown[] = [];
  const speaker = new RecordingSpeaker(async () => ({
    decision: 'speak',
    content: '我认为方案已经收敛。',
  }));
  const scheduler = {
    async decide(input: unknown) {
      schedulerCalls.push(input);
      return {
        decision: 'pause_conversation',
        reason: '讨论已经收敛，已暂停群聊。',
      };
    },
  };
  const manager = makeRuntime(
    speaker,
    undefined,
    (messageId) => broadcastMessageIds.push(messageId),
    () => agents,
    undefined,
    (conversationId) => updates.push(conversationId),
    scheduler,
  );

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();

  assert.equal(schedulerCalls.length, 1);
  const stored = repo.get(conversation.id);
  assert.equal(stored?.paused, true);
  assert.equal(stored?.pauseReason, 'scheduler');
  assert.deepEqual(updates, [conversation.id]);
  const storedMessages = repo.listMessages(conversation.id, { limit: 100 });
  assert.deepEqual(
    storedMessages.map((message) => [message.senderType, message.content]),
    [
      ['human', 'human-1'],
      ['agent', '我认为方案已经收敛。'],
      ['system', '讨论已经收敛，已暂停群聊。'],
    ],
  );
  assert.deepEqual(
    broadcastMessageIds,
    storedMessages.slice(1).map((message) => message.id),
  );

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();
  assert.equal(schedulerCalls.length, 1);
});

test('Agent skip 时隐藏调度器不运行', async () => {
  const conversation = createGroup();
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  appendHuman(conversation.id, 'human-1');
  let schedulerCalls = 0;
  const speaker = new RecordingSpeaker(async () => ({ decision: 'skip' }));
  const scheduler = {
    async decide() {
      schedulerCalls += 1;
      return { decision: 'continue' };
    },
  };
  const manager = makeRuntime(
    speaker,
    undefined,
    undefined,
    () => agents,
    undefined,
    undefined,
    scheduler,
  );

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();

  assert.equal(schedulerCalls, 0);
  assert.equal(repo.get(conversation.id)?.paused, false);
});

test('Runtime 原子提交 limit 暂停后才广播 guard、会话更新和暂停状态', async () => {
  const conversation = repo.create({
    id: 'group-limit-atomic',
    kind: 'group',
    title: '原子上限测试',
    agentIds: ['agent-a', 'agent-b'],
    agentMessageLimit: 1,
    maxConsecutiveSpeeches: 100,
    cooldownMs: 5_000,
  });
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  const originalAtomicPause = repo.pauseForDiscussionLimit.bind(repo);
  const originalSetPaused = repo.setConversationPaused.bind(repo);
  const originalAppendMessage = repo.appendMessage.bind(repo);
  let atomicCommits = 0;
  let committed = false;
  const postCommitEvents = new Set<string>();
  repo.pauseForDiscussionLimit = ((id, content) => {
    const result = originalAtomicPause(id, content);
    atomicCommits += 1;
    committed =
      repo.get(id)?.pauseReason === 'limit'
      && repo.listMessages(id).some((message) =>
        message.id === result.message.id
        && message.protectionBoundary === 'discussion_limit_resume');
    return result;
  }) as ConversationRepo['pauseForDiscussionLimit'];
  repo.setConversationPaused = ((id, paused, reason) => {
    if (paused && reason === 'limit') {
      throw new Error('Runtime 不得拆分写入 limit 暂停');
    }
    return originalSetPaused(id, paused, reason);
  }) as ConversationRepo['setConversationPaused'];
  repo.appendMessage = ((input) => {
    if (input.protectionBoundary === 'discussion_limit_resume') {
      throw new Error('Runtime 不得拆分写入 guard 消息');
    }
    return originalAppendMessage(input);
  }) as ConversationRepo['appendMessage'];
  const speaker = new RecordingSpeaker(async () => ({
    decision: 'speak',
    content: '达到上限的 Agent 消息',
  }));
  const manager = makeRuntime(
    speaker,
    (_agentId, state) => {
      if (state !== 'paused') return;
      assert.equal(committed, true);
      postCommitEvents.add('state');
    },
    (messageId) => {
      const message = repo.listMessages(conversation.id).find((item) => item.id === messageId);
      if (message?.protectionBoundary !== 'discussion_limit_resume') return;
      assert.equal(committed, true);
      postCommitEvents.add('message');
    },
    () => agents,
    undefined,
    (conversationId) => {
      assert.equal(conversationId, conversation.id);
      assert.equal(committed, true);
      postCommitEvents.add('updated');
    },
  );

  try {
    appendHuman(conversation.id, 'human-limit-atomic');
    manager.notifyMessage(conversation.id);
    clock.advanceBy(5_000);
    await flushRuntime();

    assert.equal(atomicCommits, 1);
    assert.equal(repo.get(conversation.id)?.pauseReason, 'limit');
    assert.deepEqual(postCommitEvents, new Set(['message', 'updated', 'state']));
  } finally {
    repo.pauseForDiscussionLimit = originalAtomicPause;
    repo.setConversationPaused = originalSetPaused;
    repo.appendMessage = originalAppendMessage;
  }
});

test('真实达到 limit 后显式恢复会开启持久化的新一轮统计', async () => {
  const conversation = repo.create({
    id: 'group-limit-resume',
    kind: 'group',
    title: '上限恢复测试',
    agentIds: ['agent-a', 'agent-b'],
    agentMessageLimit: 2,
    maxConsecutiveSpeeches: 100,
    cooldownMs: 5_000,
  });
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  appendHuman(conversation.id, 'human-1');
  appendAgent(conversation.id, 'agent-b', 'agent-b-1');
  const speaker = new RecordingSpeaker(async (input) => (
    input.agent.id === 'agent-a'
      ? { decision: 'speak', content: '第 2 条 Agent 消息' }
      : { decision: 'skip' }
  ));
  const manager = makeRuntime(speaker);

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  repo.setMemberPaused(conversation.id, 'agent-b', false);
  await flushRuntime();

  assert.equal(repo.get(conversation.id)?.pauseReason, 'limit');
  assert.equal(
    repo.listMessages(conversation.id, { limit: 100 })
      .filter((message) => message.senderType === 'system').length,
    1,
  );

  repo.setConversationPaused(conversation.id, false);
  manager.resumeConversation(conversation.id);
  clock.advanceBy(4_999);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-b').length,
    0,
  );
  clock.advanceBy(1);
  await flushRuntime();

  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-b').length,
    1,
  );
  assert.equal(repo.get(conversation.id)?.paused, false);
  assert.equal(
    repo.listMessages(conversation.id, { limit: 100 })
      .filter((message) => message.senderType === 'system').length,
    1,
  );
});

test('Agent 暂停保留 pending，恢复后重新等待完整 5000 毫秒', async () => {
  const conversation = createGroup();
  const speaker = new RecordingSpeaker();
  const manager = makeRuntime(speaker);
  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);

  repo.setMemberPaused(conversation.id, 'agent-a', true);
  manager.pauseAgent(conversation.id, 'agent-a');
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), true);
  clock.advanceBy(5_000);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    0,
  );

  repo.setMemberPaused(conversation.id, 'agent-a', false);
  manager.resumeAgent(conversation.id, 'agent-a');
  clock.advanceBy(4_999);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    0,
  );
  clock.advanceBy(1);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    1,
  );
  await flushRuntime();
});

test('配置失效 Agent 的未完成投递 failed 且不阻塞其他 Agent', async () => {
  const conversation = createGroup();
  const speaker = new RecordingSpeaker();
  const manager = makeRuntime(
    speaker,
    undefined,
    undefined,
    () => agents.filter((agent) => agent.id !== 'agent-a'),
  );
  appendHuman(conversation.id, 'm1');

  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();

  const invalidDelivery = getDB().prepare(
    `SELECT status, batch_id, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(conversation.id, 'agent-a') as {
    status: string;
    batch_id: string | null;
    error: string | null;
  };
  assert.deepEqual(invalidDelivery, {
    status: 'failed',
    batch_id: null,
    error: "Agent 'agent-a' 不存在或未启用",
  });
  assert.equal(
    states.filter((event) => event.agentId === 'agent-a').at(-1)?.state,
    'error',
  );
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-b').length,
    1,
  );
});

test('Agent 在 processing 中配置失效后投递 failed 且旧结果不落库', async () => {
  const conversation = createGroup();
  let configuredAgents = agents;
  let resolveA!: (decision: AgentSpeechDecision) => void;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-a') {
      return new Promise<AgentSpeechDecision>((resolve) => {
        resolveA = resolve;
      });
    }
    return { decision: 'skip' };
  });
  const manager = makeRuntime(
    speaker,
    undefined,
    undefined,
    () => configuredAgents,
  );
  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);

  configuredAgents = agents.filter((agent) => agent.id !== 'agent-a');
  manager.notifyMessage(conversation.id);
  resolveA({ decision: 'speak', content: '失效后不得落库' });
  await flushRuntime();

  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['m1'],
  );
  const delivery = getDB().prepare(
    `SELECT status, batch_id, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(conversation.id, 'agent-a') as {
    status: string;
    batch_id: string | null;
    error: string | null;
  };
  assert.deepEqual(delivery, {
    status: 'failed',
    batch_id: null,
    error: "Agent 'agent-a' 不存在或未启用",
  });
  assert.equal(
    states.filter((event) => event.agentId === 'agent-a').at(-1)?.state,
    'error',
  );
});

test('移出正在判断的 Agent 后旧结果不落库且投递保持 failed', async () => {
  const conversation = createGroup(['agent-a', 'agent-b', 'agent-c']);
  let resolveC!: (decision: AgentSpeechDecision) => void;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-c') {
      return new Promise<AgentSpeechDecision>((resolve) => {
        resolveC = resolve;
      });
    }
    return { decision: 'skip' };
  });
  const manager = makeRuntime(speaker);
  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);

  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-c').length,
    1,
  );
  repo.removeAgentMember(conversation.id, 'agent-c');
  manager.notifyMembershipChanged(conversation.id);
  resolveC({ decision: 'speak', content: '移出后不得落库' });
  await flushRuntime();

  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['m1'],
  );
  const delivery = getDB().prepare(
    `SELECT status, batch_id, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(conversation.id, 'agent-c') as {
    status: string;
    batch_id: string | null;
    error: string | null;
  };
  assert.deepEqual(delivery, {
    status: 'failed',
    batch_id: null,
    error: '已移出群聊',
  });
});

test('deciding 暂停立即回队，恢复冷却到期仍等待旧 in-flight 结束', async () => {
  const conversation = createGroup();
  let resolveA!: (decision: AgentSpeechDecision) => void;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-a' && !resolveA) {
      return new Promise<AgentSpeechDecision>((resolve) => {
        resolveA = resolve;
      });
    }
    return { decision: 'skip' };
  });
  const broadcastMessageIds: string[] = [];
  const manager = makeRuntime(speaker, undefined, (messageId) => {
    broadcastMessageIds.push(messageId);
  });

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    1,
  );

  repo.setConversationPaused(conversation.id, true, 'manual');
  manager.pauseConversation(conversation.id);
  const pausedDelivery = getDB().prepare(
    `SELECT status, batch_id
     FROM conversation_deliveries
     WHERE conversation_id = ? AND message_id = ? AND agent_id = ?`,
  ).get(conversation.id, 'm1', 'agent-a') as {
    status: string;
    batch_id: string | null;
  };
  assert.deepEqual(pausedDelivery, { status: 'pending', batch_id: null });
  assert.equal(
    states.filter((event) => event.agentId === 'agent-a').at(-1)?.state,
    'paused',
  );

  repo.setConversationPaused(conversation.id, false);
  manager.resumeConversation(conversation.id);
  clock.advanceBy(5_000);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    1,
  );

  resolveA({ decision: 'speak', content: '暂停后不得落库' });
  await flushRuntime();
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    2,
  );
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['m1'],
  );
  assert.deepEqual(broadcastMessageIds, []);
  await flushRuntime();
});

test('旧 in-flight 在恢复冷却期内结束时仍等满 5000 毫秒', async () => {
  const conversation = createGroup();
  let resolveA!: (decision: AgentSpeechDecision) => void;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-a' && !resolveA) {
      return new Promise<AgentSpeechDecision>((resolve) => {
        resolveA = resolve;
      });
    }
    return { decision: 'skip' };
  });
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);

  repo.setConversationPaused(conversation.id, true, 'manual');
  manager.pauseConversation(conversation.id);
  repo.setConversationPaused(conversation.id, false);
  manager.resumeConversation(conversation.id);
  clock.advanceBy(2_000);
  resolveA({ decision: 'skip' });
  await flushRuntime();

  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    1,
  );
  clock.advanceBy(2_999);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    1,
  );
  clock.advanceBy(1);
  assert.equal(
    speaker.calls.filter((call) => call.agent.id === 'agent-a').length,
    2,
  );
  await flushRuntime();
});

test('stop 后 in-flight 成功结果不得落库、广播或完成批次', async () => {
  const conversation = createGroup();
  let resolveA!: (decision: AgentSpeechDecision) => void;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-a') {
      return new Promise<AgentSpeechDecision>((resolve) => {
        resolveA = resolve;
      });
    }
    return { decision: 'skip' };
  });
  const broadcastMessageIds: string[] = [];
  const manager = makeRuntime(speaker, undefined, (messageId) => {
    broadcastMessageIds.push(messageId);
  });

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  manager.stop();
  resolveA({ decision: 'speak', content: '关停后不得落库' });
  await flushRuntime();

  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['m1'],
  );
  assert.deepEqual(broadcastMessageIds, []);
  const delivery = getDB().prepare(
    `SELECT status, batch_id, processed_at, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(conversation.id, 'agent-a') as {
    status: string;
    batch_id: string | null;
    processed_at: number | null;
    error: string | null;
  };
  assert.equal(delivery.status, 'processing');
  assert.ok(delivery.batch_id);
  assert.equal(delivery.processed_at, null);
  assert.equal(delivery.error, null);
});

test('stop 后 in-flight 失败结果不得 fail 批次', async () => {
  const conversation = createGroup();
  let rejectA!: (error: Error) => void;
  const speaker = new RecordingSpeaker(async (input) => {
    if (input.agent.id === 'agent-a') {
      return new Promise<AgentSpeechDecision>((_resolve, reject) => {
        rejectA = reject;
      });
    }
    return { decision: 'skip' };
  });
  const manager = makeRuntime(speaker);

  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  manager.stop();
  rejectA(new Error('关停后的失败'));
  await flushRuntime();

  const delivery = getDB().prepare(
    `SELECT status, processed_at, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(conversation.id, 'agent-a') as {
    status: string;
    processed_at: number | null;
    error: string | null;
  };
  assert.equal(delivery.status, 'processing');
  assert.equal(delivery.processed_at, null);
  assert.equal(delivery.error, null);
});

test('removeConversation 清理目标会话全部 Actor timer 且不发状态', () => {
  const conversation = createGroup(['agent-a', 'agent-b', 'agent-c']);
  const speaker = new RecordingSpeaker();
  const manager = makeRuntime(speaker);
  appendHuman(conversation.id, 'remove-cooling');
  manager.notifyMessage(conversation.id);
  const statesBeforeRemoval = states.length;

  manager.removeConversation(conversation.id);
  clock.advanceBy(5_000);

  assert.equal(speaker.calls.length, 0);
  assert.equal(states.length, statesBeforeRemoval);
});

test('removeConversation 使旧 in-flight generation 失效且不落库不发状态', async () => {
  const conversation = createGroup();
  const resolvers = new Map<string, (decision: AgentSpeechDecision) => void>();
  const speaker = new RecordingSpeaker(async (input) =>
    new Promise<AgentSpeechDecision>((resolve) => {
      resolvers.set(input.agent.id, resolve);
    }));
  const broadcastMessageIds: string[] = [];
  const manager = makeRuntime(speaker, undefined, (messageId) => {
    broadcastMessageIds.push(messageId);
  });
  appendHuman(conversation.id, 'remove-in-flight');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  assert.equal(speaker.calls.length, 2);

  manager.removeConversation(conversation.id);
  assert.equal(repo.delete(conversation.id), true);
  const statesAfterRemoval = states.length;
  for (const resolve of resolvers.values()) {
    resolve({ decision: 'speak', content: '删除后不得落库' });
  }
  await flushRuntime();

  assert.equal(repo.get(conversation.id), null);
  assert.deepEqual(broadcastMessageIds, []);
  assert.equal(states.length, statesAfterRemoval);
});

test('启动时 processing 恢复 pending 并让群聊重新冷却完整 5000 毫秒', async () => {
  const conversation = createGroup();
  appendHuman(conversation.id, 'm1');
  repo.claimPending(conversation.id, 'agent-a', 'abandoned-batch');
  repo.failPendingForAgent(conversation.id, 'agent-b', '隔离其他 Agent');
  const speaker = new RecordingSpeaker();
  const manager = makeStoppedRuntime(speaker);

  manager.start();
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), true);
  clock.advanceBy(4_999);
  assert.equal(speaker.calls.length, 0);
  clock.advanceBy(1);
  assert.equal(speaker.calls.length, 1);
  await flushRuntime();
});

test('启动时 direct 的 processing 恢复不调用允许 skip 的群聊 Speaker', async () => {
  const conversation = repo.create({
    id: 'direct-recovery',
    kind: 'direct',
    title: '私聊恢复',
    agentIds: ['agent-a'],
  });
  appendHuman(conversation.id, 'm1');
  repo.claimPending(conversation.id, 'agent-a', 'abandoned-direct');
  const speaker = new RecordingSpeaker();
  let directCalls = 0;
  const manager = makeStoppedRuntime(
    speaker,
    undefined,
    undefined,
    () => agents,
    async (receivedConversation, agentId) => {
      directCalls += 1;
      assert.equal(receivedConversation.id, conversation.id);
      assert.equal(agentId, 'agent-a');
      return '恢复后的完整回复';
    },
  );

  manager.start();
  assert.equal(speaker.calls.length, 0);
  await flushRuntime();
  assert.equal(directCalls, 1);
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), false);
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['m1', '恢复后的完整回复'],
  );
});

test('启动恢复 direct 必回复失败时投递 failed 且状态 error', async () => {
  const conversation = repo.create({
    id: 'direct-recovery-failure',
    kind: 'direct',
    title: '私聊恢复失败',
    agentIds: ['agent-a'],
  });
  appendHuman(conversation.id, 'm1');
  repo.claimPending(conversation.id, 'agent-a', 'abandoned-direct');
  const speaker = new RecordingSpeaker();
  const manager = makeStoppedRuntime(
    speaker,
    undefined,
    undefined,
    () => agents,
    async () => {
      throw new Error('私聊完整回复失败');
    },
  );

  manager.start();
  await flushRuntime();

  assert.equal(speaker.calls.length, 0);
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['m1'],
  );
  const delivery = getDB().prepare(
    `SELECT status, error
     FROM conversation_deliveries
     WHERE conversation_id = ? AND agent_id = ?`,
  ).get(conversation.id, 'agent-a') as {
    status: string;
    error: string | null;
  };
  assert.deepEqual(delivery, {
    status: 'failed',
    error: '私聊完整回复失败',
  });
  assert.equal(
    states.filter((event) => event.agentId === 'agent-a').at(-1)?.state,
    'error',
  );
});

test('stop 只清 timer 不改 delivery，重新 start 后从完整冷却恢复', async () => {
  const conversation = createGroup();
  const speaker = new RecordingSpeaker();
  const manager = makeRuntime(speaker);
  appendHuman(conversation.id, 'm1');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(2_000);

  manager.stop();
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), true);
  clock.advanceBy(10_000);
  assert.equal(speaker.calls.length, 0);

  manager.start();
  clock.advanceBy(4_999);
  assert.equal(speaker.calls.length, 0);
  clock.advanceBy(1);
  assert.equal(speaker.calls.length, 2);
  await flushRuntime();
});

test('领取超过 200 条 pending 时完整快照不会丢失前部消息', () => {
  const conversation = createGroup();
  const speaker = new RecordingSpeaker(
    async () => new Promise<AgentSpeechDecision>(() => {}),
  );
  const manager = makeRuntime(speaker);

  for (let sequence = 1; sequence <= 205; sequence += 1) {
    appendHuman(conversation.id, `m${sequence}`);
  }
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);

  const callForA = speaker.calls.find((call) => call.agent.id === 'agent-a');
  assert.equal(callForA?.newMessages.length, 205);
  assert.deepEqual(
    callForA?.newMessages.map((message) => message.id),
    Array.from({ length: 205 }, (_, index) => `m${index + 1}`),
  );
});

test('Runtime 使用 Repository 原子操作提交 Agent 回复和当前 batch', async () => {
  const conversation = createGroup();
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  const originalAppendMessage = repo.appendMessage.bind(repo);
  const originalAtomicCommit = repo.appendAgentReplyAndCompleteBatch.bind(repo);
  let atomicCommits = 0;
  repo.appendMessage = ((input) => {
    if (input.senderType === 'agent') {
      throw new Error('Runtime 不得拆分追加 Agent 回复');
    }
    return originalAppendMessage(input);
  }) as ConversationRepo['appendMessage'];
  repo.appendAgentReplyAndCompleteBatch = ((input) => {
    atomicCommits += 1;
    return originalAtomicCommit(input);
  }) as ConversationRepo['appendAgentReplyAndCompleteBatch'];
  const speaker = new RecordingSpeaker(async (input) => (
    input.agent.id === 'agent-a'
      ? { decision: 'speak', content: '原子提交回复' }
      : { decision: 'skip' }
  ));
  const manager = makeRuntime(speaker);

  try {
    appendHuman(conversation.id, 'm1');
    manager.notifyMessage(conversation.id);
    clock.advanceBy(5_000);
    await flushRuntime();

    assert.equal(atomicCommits, 1);
    assert.deepEqual(
      repo.listMessages(conversation.id).map((message) => message.content),
      ['m1', '原子提交回复'],
    );
  } finally {
    repo.appendMessage = originalAppendMessage;
    repo.appendAgentReplyAndCompleteBatch = originalAtomicCommit;
  }
});

test('Agent 发言严格按 append、broadcast、notify 顺序执行', async () => {
  const conversation = createGroup();
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  const order: string[] = [];
  const originalAtomicCommit = repo.appendAgentReplyAndCompleteBatch.bind(repo);
  repo.appendAgentReplyAndCompleteBatch = ((input) => {
    const message = originalAtomicCommit(input);
    order.push('append');
    return message;
  }) as ConversationRepo['appendAgentReplyAndCompleteBatch'];
  const speaker = new RecordingSpeaker(async (input) => (
    input.agent.id === 'agent-a'
      ? { decision: 'speak', content: '顺序测试' }
      : { decision: 'skip' }
  ));
  const manager = makeRuntime(
    speaker,
    (agentId, state) => {
      if (agentId === 'agent-b' && state === 'cooling') order.push('notify');
    },
    () => order.push('broadcast'),
  );

  try {
    appendHuman(conversation.id, 'm1');
    manager.notifyMessage(conversation.id);
    repo.setMemberPaused(conversation.id, 'agent-b', false);
    clock.advanceBy(5_000);
    await flushRuntime();

    assert.deepEqual(order, ['append', 'broadcast', 'notify']);
  } finally {
      repo.appendAgentReplyAndCompleteBatch = originalAtomicCommit;
  }
});
