import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AgentSpeaker,
  AgentSpeakerInput,
} from '../../src/conversations/agentSpeaker.js';
import { ConversationRuntimeManager } from '../../src/conversations/runtime.js';
import type {
  AgentSpeechDecision,
  ConversationMessage,
  ParticipantState,
} from '../../src/conversations/types.js';
import { getDB } from '../../src/store/db.js';
import { ConversationRepo } from '../../src/store/conversations.js';
import type { AgentConfig } from '../../src/types/company.js';
import { cleanupDB, freshDB, truncateAll } from '../helpers/db.js';

interface Timer {
  at: number;
  callback: () => void;
}

interface SpeakerCall {
  agentId: string;
  at: number;
  newMessageIds: string[];
  newMessageContents: string[];
}

interface DeliveryRow {
  message_id: string;
  agent_id: string;
  status: string;
  batch_id: string | null;
  error: string | null;
}

class FakeClock {
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

function deferredDecision() {
  let resolve!: (decision: AgentSpeechDecision) => void;
  const promise = new Promise<AgentSpeechDecision>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
let runtime: ConversationRuntimeManager | undefined;
let states: Array<{ agentId: string; state: ParticipantState; since: number }>;
let published: ConversationMessage[];

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
  published = [];
});

function createGroup() {
  return repo.create({
    id: 'scenario-group',
    kind: 'group',
    title: 'A/B/C 集成场景',
    agentIds: agents.map((agent) => agent.id),
    cooldownMs: 5_000,
    maxConsecutiveSpeeches: 10,
  });
}

function appendHuman(conversationId: string, id: string, content: string) {
  return repo.appendMessage({
    id,
    conversationId,
    senderId: 'boss',
    senderType: 'human',
    content,
  });
}

function startRuntime(speaker: AgentSpeaker): ConversationRuntimeManager {
  runtime = new (ConversationRuntimeManager as any)(
    repo,
    speaker,
    () => agents,
    {
      message: (message: ConversationMessage) => published.push(message),
      state: (event: {
        agentId: string;
        state: ParticipantState;
        since: number;
      }) => states.push({
        agentId: event.agentId,
        state: event.state,
        since: event.since,
      }),
    },
    clock,
  );
  runtime.start();
  return runtime;
}

async function flushRuntime(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function deliveryRows(conversationId: string): DeliveryRow[] {
  return getDB().prepare(
    `SELECT message_id, agent_id, status, batch_id, error
     FROM conversation_deliveries
     WHERE conversation_id = ?
     ORDER BY delivered_at, message_id, agent_id`,
  ).all(conversationId) as DeliveryRow[];
}

test('A/B/C 按冻结快照完成非重置冷却并只发布完整消息', async () => {
  const conversation = createGroup();
  const firstA = deferredDecision();
  const firstB = deferredDecision();
  const calls: SpeakerCall[] = [];
  const callCount = new Map<string, number>();
  const speaker: AgentSpeaker = {
    decideAndSpeak(input: AgentSpeakerInput): Promise<AgentSpeechDecision> {
      const count = (callCount.get(input.agent.id) ?? 0) + 1;
      callCount.set(input.agent.id, count);
      calls.push({
        agentId: input.agent.id,
        at: clock.now(),
        newMessageIds: input.newMessages.map((message) => message.id),
        newMessageContents: input.newMessages.map((message) => message.content),
      });
      if (input.agent.id === 'agent-a' && count === 1) return firstA.promise;
      if (input.agent.id === 'agent-b' && count === 1) return firstB.promise;
      if (input.agent.id === 'agent-c' && count === 2) {
        return Promise.resolve({
          decision: 'speak',
          content: '你去的是哪家游泳馆？',
        });
      }
      return Promise.resolve({ decision: 'skip' });
    },
  };
  const manager = startRuntime(speaker);

  appendHuman(conversation.id, 'human-1', '你们昨天都做了什么？');
  assert.deepEqual(
    deliveryRows(conversation.id).map((delivery) => [
      delivery.agent_id,
      delivery.status,
    ]),
    [
      ['agent-a', 'pending'],
      ['agent-b', 'pending'],
      ['agent-c', 'pending'],
    ],
  );
  manager.notifyMessage(conversation.id);

  assert.deepEqual(
    states.filter((event) => event.state === 'cooling'),
    agents.map((agent) => ({
      agentId: agent.id,
      state: 'cooling',
      since: 0,
    })),
  );
  clock.advanceBy(4_999);
  assert.equal(calls.length, 0);
  clock.advanceBy(1);
  assert.deepEqual(
    calls.map((call) => [call.agentId, call.at, call.newMessageIds]),
    [
      ['agent-a', 5_000, ['human-1']],
      ['agent-b', 5_000, ['human-1']],
      ['agent-c', 5_000, ['human-1']],
    ],
  );
  await flushRuntime();

  firstB.resolve({
    decision: 'speak',
    content: '昨天我去了一家餐厅。',
  });
  await flushRuntime();
  clock.advanceBy(2_000);
  firstA.resolve({
    decision: 'speak',
    content: '昨天我去游泳了。',
  });
  await flushRuntime();

  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => [
      message.sequence,
      message.senderId,
      message.content,
    ]),
    [
      [1, 'boss', '你们昨天都做了什么？'],
      [2, 'agent-b', '昨天我去了一家餐厅。'],
      [3, 'agent-a', '昨天我去游泳了。'],
    ],
  );
  clock.advanceBy(2_999);
  assert.equal(calls.filter((call) => call.agentId === 'agent-c').length, 1);
  clock.advanceBy(1);
  await flushRuntime();

  const cCalls = calls.filter((call) => call.agentId === 'agent-c');
  assert.deepEqual(
    cCalls.map((call) => [call.at, call.newMessageIds, call.newMessageContents]),
    [
      [5_000, ['human-1'], ['你们昨天都做了什么？']],
      [
        10_000,
        published.slice(0, 2).map((message) => message.id),
        ['昨天我去了一家餐厅。', '昨天我去游泳了。'],
      ],
    ],
  );
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => [
      message.sequence,
      message.senderId,
      message.content,
    ]),
    [
      [1, 'boss', '你们昨天都做了什么？'],
      [2, 'agent-b', '昨天我去了一家餐厅。'],
      [3, 'agent-a', '昨天我去游泳了。'],
      [4, 'agent-c', '你去的是哪家游泳馆？'],
    ],
  );
  assert.deepEqual(
    published.map((message) => [message.senderId, message.content]),
    [
      ['agent-b', '昨天我去了一家餐厅。'],
      ['agent-a', '昨天我去游泳了。'],
      ['agent-c', '你去的是哪家游泳馆？'],
    ],
  );

  assert.deepEqual(
    states
      .filter((event) =>
        event.state === 'cooling'
        && (event.agentId === 'agent-a' || event.agentId === 'agent-b'))
      .map((event) => [event.agentId, event.since])
      .sort(([leftAgent, leftSince], [rightAgent, rightSince]) =>
        Number(leftSince) - Number(rightSince)
        || String(leftAgent).localeCompare(String(rightAgent))),
    [
      ['agent-a', 0],
      ['agent-b', 0],
      ['agent-a', 7_000],
      ['agent-b', 7_000],
    ],
  );
  clock.advanceBy(1_999);
  assert.equal(calls.filter((call) => call.agentId !== 'agent-c').length, 2);
  clock.advanceBy(1);
  await flushRuntime();

  const followUps = calls.filter((call) =>
    call.at === 12_000 && call.agentId !== 'agent-c');
  assert.deepEqual(
    followUps
      .map((call) => [call.agentId, call.newMessageContents] as const)
      .sort(([leftAgent], [rightAgent]) => leftAgent.localeCompare(rightAgent)),
    [
      ['agent-a', ['昨天我去了一家餐厅。', '你去的是哪家游泳馆？']],
      ['agent-b', ['昨天我去游泳了。', '你去的是哪家游泳馆？']],
    ],
  );

  const messages = repo.listMessages(conversation.id);
  assert.deepEqual(
    messages.map((message) => message.sequence),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(messages.map((message) => message.id)).size, messages.length);
  assert.equal(new Set(published.map((message) => message.id)).size, published.length);
  assert.equal(deliveryRows(conversation.id).length, 9);
  assert.ok(deliveryRows(conversation.id).every((delivery) =>
    delivery.status === 'processed'));
});

test('B 失败只终止旧 batch，新人类消息进入新 batch 且不重试旧消息', async () => {
  const conversation = createGroup();
  const calls: SpeakerCall[] = [];
  const callCount = new Map<string, number>();
  const speaker: AgentSpeaker = {
    async decideAndSpeak(input: AgentSpeakerInput): Promise<AgentSpeechDecision> {
      const count = (callCount.get(input.agent.id) ?? 0) + 1;
      callCount.set(input.agent.id, count);
      calls.push({
        agentId: input.agent.id,
        at: clock.now(),
        newMessageIds: input.newMessages.map((message) => message.id),
        newMessageContents: input.newMessages.map((message) => message.content),
      });
      if (input.agent.id === 'agent-b' && count === 1) {
        throw new Error('B speaker 失败');
      }
      if (input.agent.id === 'agent-a' && count === 1) {
        return { decision: 'speak', content: 'A 正常完成。' };
      }
      if (input.agent.id === 'agent-c' && count === 1) {
        return { decision: 'speak', content: 'C 正常完成。' };
      }
      return { decision: 'skip' };
    },
  };
  const manager = startRuntime(speaker);

  appendHuman(conversation.id, 'human-old', '第一轮问题');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(5_000);
  await flushRuntime();

  assert.deepEqual(
    published.map((message) => [message.senderId, message.content]),
    [
      ['agent-a', 'A 正常完成。'],
      ['agent-c', 'C 正常完成。'],
    ],
  );
  assert.ok(states.some((event) =>
    event.agentId === 'agent-b' && event.state === 'error'));
  const oldDelivery = deliveryRows(conversation.id).find((delivery) =>
    delivery.message_id === 'human-old' && delivery.agent_id === 'agent-b');
  assert.equal(oldDelivery?.status, 'failed');
  assert.equal(oldDelivery?.error, 'B speaker 失败');
  assert.ok(oldDelivery?.batch_id);

  clock.advanceBy(1_000);
  appendHuman(conversation.id, 'human-new', '第二轮问题');
  manager.notifyMessage(conversation.id);
  clock.advanceBy(3_999);
  assert.equal(calls.filter((call) => call.agentId === 'agent-b').length, 1);
  clock.advanceBy(1);
  await flushRuntime();

  const bCalls = calls.filter((call) => call.agentId === 'agent-b');
  assert.deepEqual(
    bCalls.map((call) => [call.at, call.newMessageIds]),
    [
      [5_000, ['human-old']],
      [
        10_000,
        [
          published[0]!.id,
          published[1]!.id,
          'human-new',
        ],
      ],
    ],
  );
  assert.equal(bCalls[1]!.newMessageIds.includes('human-old'), false);

  const bDeliveries = deliveryRows(conversation.id).filter((delivery) =>
    delivery.agent_id === 'agent-b');
  const newBatchIds = new Set(
    bDeliveries
      .filter((delivery) => delivery.message_id !== 'human-old')
      .map((delivery) => delivery.batch_id),
  );
  assert.equal(newBatchIds.size, 1);
  assert.equal(newBatchIds.has(oldDelivery!.batch_id), false);
  assert.ok(
    bDeliveries
      .filter((delivery) => delivery.message_id !== 'human-old')
      .every((delivery) => delivery.status === 'processed'),
  );
  assert.equal(
    deliveryRows(conversation.id).some((delivery) =>
      delivery.status === 'pending' || delivery.status === 'processing'),
    false,
  );
});
