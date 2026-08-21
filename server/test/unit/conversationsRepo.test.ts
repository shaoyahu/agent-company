import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDB } from '../../src/store/db.js';
import { ConversationRepo } from '../../src/store/conversations.js';
import { cleanupDB, freshDB, truncateAll } from '../helpers/db.js';

let dir: string;
let path: string;
let repo: ConversationRepo;

before(() => {
  ({ dir, path } = freshDB());
  repo = new ConversationRepo();
});

after(() => {
  cleanupDB(dir, path);
});

beforeEach(() => {
  truncateAll();
});

function createDirect(id = 'direct-1', agentId = 'agent-a') {
  return repo.create({
    id,
    kind: 'direct',
    title: `与 ${agentId} 对话`,
    agentIds: [agentId],
  });
}

function createGroup(id = 'group-1', agentIds = ['agent-a', 'agent-b']) {
  return repo.create({
    id,
    kind: 'group',
    title: '架构讨论',
    agentIds,
    schedulerMode: 'llm',
    schedulerLlm: 'llm-main',
  });
}

function humanMessage(conversationId: string, id: string, content = '人类消息') {
  return {
    id,
    conversationId,
    senderId: 'boss',
    senderType: 'human' as const,
    content,
    mentions: [],
  };
}

function agentMessage(conversationId: string, senderId: string, id: string) {
  return {
    id,
    conversationId,
    senderId,
    senderType: 'agent' as const,
    content: `${senderId} 消息`,
    mentions: [],
  };
}

test('create 创建 direct 并应用默认值和固定 boss 成员', () => {
  const conversation = createDirect();
  assert.equal(conversation.kind, 'direct');
  assert.equal(conversation.createdBy, 'boss');
  assert.equal(conversation.agentMessageLimit, 30);
  assert.equal(conversation.maxConsecutiveSpeeches, 2);
  assert.equal(conversation.maxMessageChars, 300);
  assert.equal(conversation.cooldownMs, 5000);
  assert.equal(conversation.paused, false);
  assert.equal(conversation.pauseReason, undefined);
  assert.equal(conversation.pinned, false);
  assert.equal(conversation.muted, false);
  assert.equal(conversation.lastReadSequence, 0);
  assert.deepEqual(
    repo.listMembers(conversation.id).map((member) => [member.memberId, member.memberType, member.enabled, member.paused]),
    [
      ['boss', 'human', true, false],
      ['agent-a', 'agent', true, false],
    ],
  );
});

test('create 创建 group 并保留显式配置', () => {
  const conversation = repo.create({
    id: 'group-custom',
    kind: 'group',
    title: '  架构讨论  ',
    agentIds: ['agent-a', 'agent-b'],
    agentMessageLimit: 10,
    maxConsecutiveSpeeches: 3,
    maxMessageChars: 600,
    cooldownMs: 8000,
  });
  assert.equal(conversation.title, '架构讨论');
  assert.equal(conversation.agentMessageLimit, 10);
  assert.equal(conversation.maxConsecutiveSpeeches, 3);
  assert.equal(conversation.maxMessageChars, 600);
  assert.equal(conversation.cooldownMs, 8000);
  assert.deepEqual(repo.listMembers(conversation.id).map((member) => member.memberId), [
    'boss',
    'agent-a',
    'agent-b',
  ]);
});

test('create 校验标题、kind、成员数量、重复成员和 hostile id', () => {
  assert.throws(() => repo.create({
    id: 'blank-title',
    kind: 'direct',
    title: '   ',
    agentIds: ['agent-a'],
  }), /标题/);
  assert.throws(() => repo.create({
    id: 'bad-kind',
    kind: 'channel' as any,
    title: '错误类型',
    agentIds: ['agent-a'],
  }), /类型/);
  assert.throws(() => repo.create({
    id: 'direct-many',
    kind: 'direct',
    title: '私聊',
    agentIds: ['agent-a', 'agent-b'],
  }), /一个 Agent/);
  assert.throws(() => repo.create({
    id: 'group-few',
    kind: 'group',
    title: '群聊',
    agentIds: ['agent-a'],
  }), /至少.*两个 Agent/);
  assert.throws(() => repo.create({
    id: 'duplicates',
    kind: 'group',
    title: '群聊',
    agentIds: ['agent-a', 'agent-a'],
  }), /重复/);
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.throws(() => repo.create({
      id: `hostile-${String(hostile)}`,
      kind: 'direct',
      title: '私聊',
      agentIds: [hostile] as any,
    }), /Agent/);
  }
});

test('create 校验数值配置边界', () => {
  const fields = [
    ['agentMessageLimit', 0],
    ['maxConsecutiveSpeeches', -1],
    ['maxMessageChars', 0],
    ['cooldownMs', -1],
  ] as const;
  for (const [field, value] of fields) {
    assert.throws(() => repo.create({
      id: `invalid-${field}`,
      kind: 'direct',
      title: '私聊',
      agentIds: ['agent-a'],
      [field]: value,
    }), /配置/);
  }
});

test('create 拒绝所有数值配置的 null', () => {
  const fields = [
    'agentMessageLimit',
    'maxConsecutiveSpeeches',
    'maxMessageChars',
    'cooldownMs',
  ] as const;
  for (const field of fields) {
    assert.throws(() => repo.create({
      id: `null-${field}`,
      kind: 'group',
      title: `${field} null`,
      agentIds: ['agent-a', 'agent-b'],
      [field]: null,
    } as any), /配置/);
  }
});

test('get、list 和 findDirectByAgent 返回持久化会话', () => {
  const direct = createDirect();
  createGroup();
  assert.deepEqual(repo.get(direct.id), direct);
  assert.equal(repo.get('missing'), null);
  assert.equal(repo.findDirectByAgent('agent-a')?.id, direct.id);
  assert.equal(repo.findDirectByAgent('agent-b'), null);
  assert.deepEqual(new Set(repo.list().map((item) => item.id)), new Set(['direct-1', 'group-1']));
});

test('同一 Agent 重复创建 direct 返回已有会话', () => {
  const first = createDirect('direct-first', 'agent-a');
  const second = repo.create({
    id: 'direct-second',
    kind: 'direct',
    title: '重复私聊',
    agentIds: ['agent-a'],
  });
  assert.equal(second.id, first.id);
  assert.equal(repo.list().length, 1);
});

test('list 摘要包含每个会话最后一条消息', () => {
  const direct = createDirect();
  repo.appendMessage(humanMessage(direct.id, 'm1', '第一条'));
  const latest = repo.appendMessage(humanMessage(direct.id, 'm2', '最后一条'));
  const summary = repo.list().find((item) => item.id === direct.id);
  assert.deepEqual(summary?.lastMessage, latest);
});

test('list 摘要包含置顶、免打扰和按 Agent 消息计算的未读数', () => {
  const normal = createDirect('direct-normal', 'agent-a');
  const pinned = createDirect('direct-pinned', 'agent-b');
  repo.appendMessage(humanMessage(normal.id, 'normal-human', '人类消息不计未读'));
  repo.appendMessage(agentMessage(normal.id, 'agent-a', 'normal-agent-1'));
  repo.appendMessage(agentMessage(normal.id, 'agent-a', 'normal-agent-2'));
  repo.markConversationRead(normal.id);
  repo.appendMessage(humanMessage(normal.id, 'normal-human-2', '仍不计未读'));
  repo.appendMessage(agentMessage(normal.id, 'agent-a', 'normal-agent-3'));
  repo.setConversationMuted(normal.id, true);
  repo.setConversationPinned(pinned.id, true);

  const list = repo.list();
  assert.equal(list[0]?.id, pinned.id);
  const normalSummary = list.find((item) => item.id === normal.id);
  assert.equal(normalSummary?.unreadCount, 1);
  assert.equal(normalSummary?.muted, true);
  assert.equal(normalSummary?.pinned, false);
  assert.equal(normalSummary?.lastReadSequence, 3);
});

test('会话置顶、免打扰和已读游标拒绝 hostile id', () => {
  const direct = createDirect();
  assert.equal(repo.setConversationPinned(direct.id, true).pinned, true);
  assert.equal(repo.setConversationMuted(direct.id, true).muted, true);
  repo.appendMessage(agentMessage(direct.id, 'agent-a', 'agent-unread'));
  assert.equal(repo.markConversationRead(direct.id).lastReadSequence, 1);

  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.throws(() => repo.setConversationPinned(hostile as any, true), /会话 id/);
    assert.throws(() => repo.setConversationMuted(hostile as any, true), /会话 id/);
    assert.throws(() => repo.markConversationRead(hostile as any), /会话 id/);
  }
});

test('群成员可增删和暂停，direct 不允许改变 Agent 成员', () => {
  const group = createGroup();
  const added = repo.addAgentMember(group.id, 'agent-c');
  assert.equal(added.memberId, 'agent-c');
  assert.equal(added.enabled, true);
  assert.equal(repo.setMemberPaused(group.id, 'agent-c', true).paused, true);
  assert.equal(repo.removeAgentMember(group.id, 'agent-c'), true);
  assert.equal(repo.removeAgentMember(group.id, 'agent-c'), false);
  assert.equal(repo.removeAgentMember(group.id, 'agent-a'), true);
  assert.equal(repo.removeAgentMember(group.id, 'agent-b'), true);
  assert.deepEqual(repo.listMembers(group.id).map((member) => member.memberId), ['boss']);

  const direct = createDirect();
  assert.throws(() => repo.addAgentMember(direct.id, 'agent-b'), /私聊/);
  assert.throws(() => repo.removeAgentMember(direct.id, 'agent-a'), /私聊/);
});

test('成员操作拒绝重复、boss、hostile 和不存在的目标', () => {
  const group = createGroup();
  assert.throws(() => repo.addAgentMember(group.id, 'agent-a'), /已存在/);
  assert.throws(() => repo.addAgentMember(group.id, 'boss'), /Agent/);
  assert.throws(() => repo.removeAgentMember(group.id, 'boss'), /boss/);
  assert.throws(() => repo.setMemberPaused(group.id, 'missing', true), /成员不存在/);
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.throws(() => repo.addAgentMember(group.id, hostile as any), /Agent/);
  }
});

test('会话暂停和恢复会清理不适用的 pauseReason', () => {
  const conversation = createGroup();
  const paused = repo.setConversationPaused(conversation.id, true, 'limit');
  assert.equal(paused.paused, true);
  assert.equal(paused.pauseReason, 'limit');
  const resumed = repo.setConversationPaused(conversation.id, false);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.pauseReason, undefined);
  assert.throws(() => repo.setConversationPaused(conversation.id, true, 'other' as any), /暂停原因/);
  assert.throws(() => repo.setConversationPaused('missing', true), /会话不存在/);
});

test('群聊持久化隐藏调度器配置，私聊默认不启用调度器', () => {
  const direct = createDirect('direct-scheduler-default');
  assert.equal(direct.schedulerMode, 'none');
  assert.equal(direct.schedulerLlm, undefined);
  assert.equal(direct.schedulerAgentId, undefined);

  const byLlm = repo.create({
    id: 'group-scheduler-llm',
    kind: 'group',
    title: 'LLM 调度群聊',
    agentIds: ['agent-a', 'agent-b'],
    schedulerMode: 'llm',
    schedulerLlm: 'llm-main',
  });
  assert.equal(byLlm.schedulerMode, 'llm');
  assert.equal(byLlm.schedulerLlm, 'llm-main');
  assert.equal(byLlm.schedulerAgentId, undefined);
  assert.equal(repo.get(byLlm.id)?.schedulerLlm, 'llm-main');

  const byAgent = repo.create({
    id: 'group-scheduler-agent',
    kind: 'group',
    title: 'Agent 调度群聊',
    agentIds: ['agent-a', 'agent-b'],
    schedulerMode: 'agent',
    schedulerAgentId: 'agent-c',
  });
  assert.equal(byAgent.schedulerMode, 'agent');
  assert.equal(byAgent.schedulerAgentId, 'agent-c');
  assert.equal(byAgent.schedulerLlm, undefined);

  assert.throws(() => repo.create({
    id: 'group-scheduler-bad-llm',
    kind: 'group',
    title: '缺少 LLM',
    agentIds: ['agent-a', 'agent-b'],
    schedulerMode: 'llm',
  }), /调度器 LLM/);
  assert.throws(() => repo.create({
    id: 'group-scheduler-bad-agent',
    kind: 'group',
    title: '缺少 Agent',
    agentIds: ['agent-a', 'agent-b'],
    schedulerMode: 'agent',
  }), /调度器 Agent/);
});

test('会话标题和头像可持久化更新并拒绝非法输入', () => {
  const conversation = createGroup('profile-group');
  const updated = repo.updateConversationProfile(conversation.id, {
    title: '新的群聊标题',
    avatar: '研',
  });
  assert.equal(updated.title, '新的群聊标题');
  assert.equal(updated.avatar, '研');
  assert.equal(repo.get(conversation.id)?.avatar, '研');

  const cleared = repo.updateConversationProfile(conversation.id, {
    title: '清空头像',
    avatar: null,
  });
  assert.equal(cleared.title, '清空头像');
  assert.equal(cleared.avatar, undefined);

  assert.throws(() => repo.updateConversationProfile(conversation.id, {
    title: '   ',
    avatar: '研',
  }), /会话标题不能为空/);
  assert.throws(() => repo.updateConversationProfile(conversation.id, {
    title: '坏头像',
    avatar: 'x'.repeat(1_000_001),
  }), /会话头像过长/);
  assert.throws(() => repo.updateConversationProfile('__proto__', {
    title: '坏 id',
    avatar: '研',
  }), /会话 id/);
});

test('scheduler 暂停和系统消息原子提交', () => {
  const conversation = repo.create({
    id: 'group-scheduler-pause',
    kind: 'group',
    title: '调度暂停',
    agentIds: ['agent-a', 'agent-b'],
    schedulerMode: 'llm',
    schedulerLlm: 'llm-main',
  });
  const committed = repo.pauseForScheduler(
    conversation.id,
    '讨论已经收敛，已暂停群聊。',
  );
  assert.equal(committed.conversation.paused, true);
  assert.equal(committed.conversation.pauseReason, 'scheduler');
  assert.equal(committed.message.senderType, 'system');
  assert.equal(committed.message.content, '讨论已经收敛，已暂停群聊。');
  assert.deepEqual(repo.listMessages(conversation.id), [committed.message]);
});

test('limit 暂停和 guard 消息原子提交，guard 插入失败时全部回滚', () => {
  const conversation = createGroup();
  const db = getDB();
  db.exec(`
    CREATE TRIGGER fail_limit_guard_insert
    BEFORE INSERT ON conversation_messages
    WHEN NEW.protection_boundary = 'discussion_limit_resume'
    BEGIN
      SELECT RAISE(ABORT, '模拟 guard 插入失败');
    END;
  `);

  try {
    assert.throws(
      () => repo.pauseForDiscussionLimit(
        conversation.id,
        '本轮 Agent 讨论已达到 30 条，为避免循环已暂停。',
      ),
      /模拟 guard 插入失败/,
    );
    assert.equal(repo.get(conversation.id)?.paused, false);
    assert.equal(repo.get(conversation.id)?.pauseReason, undefined);
    assert.deepEqual(repo.listMessages(conversation.id), []);
  } finally {
    db.exec(`DROP TRIGGER fail_limit_guard_insert`);
  }
  const committed = repo.pauseForDiscussionLimit(
    conversation.id,
    '本轮 Agent 讨论已达到 30 条，为避免循环已暂停。',
  );
  assert.equal(committed.conversation.paused, true);
  assert.equal(committed.conversation.pauseReason, 'limit');
  assert.equal(committed.message.senderType, 'system');
  assert.equal(committed.message.protectionBoundary, 'discussion_limit_resume');
  assert.deepEqual(repo.listMessages(conversation.id), [committed.message]);
});

test('人类消息、投递和 limit 自动恢复原子提交，失败后可无重复重试', () => {
  const conversation = createGroup();
  repo.setConversationPaused(conversation.id, true, 'limit');
  const db = getDB();
  db.exec(`
    CREATE TRIGGER fail_limit_auto_resume
    BEFORE UPDATE OF paused ON conversations
    WHEN OLD.pause_reason = 'limit' AND NEW.paused = 0
    BEGIN
      SELECT RAISE(ABORT, '模拟 limit 自动恢复失败');
    END;
  `);
  const input = humanMessage(conversation.id, 'human-resume-retry', '继续讨论');

  try {
    assert.throws(
      () => repo.appendHumanMessageAndResumeLimit(input),
      /模拟 limit 自动恢复失败/,
    );
    assert.deepEqual(repo.listMessages(conversation.id), []);
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM conversation_deliveries
         WHERE conversation_id = ?`,
      ).get(conversation.id)?.count,
      0,
    );
    assert.equal(repo.get(conversation.id)?.paused, true);
    assert.equal(repo.get(conversation.id)?.pauseReason, 'limit');
  } finally {
    db.exec(`DROP TRIGGER fail_limit_auto_resume`);
  }

  const committed = repo.appendHumanMessageAndResumeLimit(input);
  assert.equal(committed.resumedFromLimit, true);
  assert.equal(committed.message.id, input.id);
  assert.equal(repo.get(conversation.id)?.paused, false);
  assert.equal(repo.get(conversation.id)?.pauseReason, undefined);
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.id),
    ['human-resume-retry'],
  );
  assert.deepEqual(
    db.prepare(
      `SELECT message_id, agent_id, status
       FROM conversation_deliveries
       WHERE conversation_id = ?
       ORDER BY agent_id`,
    ).all(conversation.id),
    [
      { message_id: 'human-resume-retry', agent_id: 'agent-a', status: 'pending' },
      { message_id: 'human-resume-retry', agent_id: 'agent-b', status: 'pending' },
    ],
  );
});

test('人类消息原子入口不解除 manual 暂停', () => {
  const conversation = createGroup();
  repo.setConversationPaused(conversation.id, true, 'manual');
  const committed = repo.appendHumanMessageAndResumeLimit(
    humanMessage(conversation.id, 'human-manual-paused'),
  );

  assert.equal(committed.resumedFromLimit, false);
  assert.equal(repo.get(conversation.id)?.paused, true);
  assert.equal(repo.get(conversation.id)?.pauseReason, 'manual');
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), true);
  assert.equal(repo.hasPending(conversation.id, 'agent-b'), true);
});

test('appendMessage 在事务中分配递增 sequence 并过滤未知 mentions', () => {
  const conversation = createGroup();
  const first = repo.appendMessage({
    ...humanMessage(conversation.id, 'm1'),
    content: '  @agent-a 和 @unknown 你好  ',
    mentions: ['agent-a', 'unknown', 'agent-a'],
  });
  const second = repo.appendMessage(agentMessage(conversation.id, 'agent-a', 'm2'));
  assert.equal(first.sequence, 1);
  assert.equal(first.content, '@agent-a 和 @unknown 你好');
  assert.deepEqual(first.mentions, ['agent-a']);
  assert.equal(second.sequence, 2);
  assert.deepEqual(repo.listMessages(conversation.id).map((message) => message.sequence), [1, 2]);
});

test('appendMessage 校验会话、发送者、内容和 hostile mentions', () => {
  const conversation = createGroup();
  assert.throws(() => repo.appendMessage(humanMessage('missing', 'm1')), /会话不存在/);
  assert.throws(() => repo.appendMessage(agentMessage(conversation.id, 'agent-c', 'm2')), /发送者/);
  assert.throws(() => repo.appendMessage({
    ...humanMessage(conversation.id, 'm3'),
    senderId: 'agent-a',
  }), /发送者/);
  assert.throws(() => repo.appendMessage({
    ...humanMessage(conversation.id, 'm4'),
    content: '   ',
  }), /消息内容/);
  getDB().prepare(
    `UPDATE conversation_members SET enabled = 0 WHERE conversation_id = ? AND member_id = ?`,
  ).run(conversation.id, 'agent-b');
  const message = repo.appendMessage({
    ...humanMessage(conversation.id, 'm5'),
    mentions: [
      undefined,
      null,
      '',
      '   ',
      '__proto__',
      'constructor',
      'agent-b',
      'agent-a',
    ] as any,
  });
  assert.deepEqual(message.mentions, ['agent-a']);
});

test('system 消息允许落库但不创建投递', () => {
  const conversation = createGroup();
  const message = repo.appendMessage({
    id: 'system-1',
    conversationId: conversation.id,
    senderId: 'system',
    senderType: 'system',
    content: '系统消息',
    mentions: [],
  });
  assert.equal(message.sequence, 1);
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), false);
  assert.equal(repo.hasPending(conversation.id, 'agent-b'), false);
});

test('appendMessage 给其他 enabled Agent 创建投递且暂停成员仍保留 pending', () => {
  const conversation = createGroup('delivery-group', ['agent-a', 'agent-b', 'agent-c']);
  repo.setMemberPaused(conversation.id, 'agent-b', true);
  getDB().prepare(
    `UPDATE conversation_members SET enabled = 0 WHERE conversation_id = ? AND member_id = ?`,
  ).run(conversation.id, 'agent-c');

  repo.appendMessage(agentMessage(conversation.id, 'agent-a', 'm1'));
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), false);
  assert.equal(repo.hasPending(conversation.id, 'agent-b'), true);
  assert.equal(repo.hasPending(conversation.id, 'agent-c'), false);

  repo.setMemberPaused(conversation.id, 'agent-b', false);
  repo.appendMessage(humanMessage(conversation.id, 'm2'));
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), true);
  assert.equal(repo.hasPending(conversation.id, 'agent-b'), true);
  assert.equal(repo.hasPending(conversation.id, 'agent-c'), false);
});

test('listMessages 分页按 sequence 升序返回', () => {
  const conversation = createDirect();
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    repo.appendMessage(humanMessage(conversation.id, `m${sequence}`, `消息 ${sequence}`));
  }
  assert.deepEqual(
    repo.listMessages(conversation.id, { beforeSequence: 5, limit: 2 }).map((message) => message.sequence),
    [3, 4],
  );
  assert.deepEqual(
    repo.listMessages(conversation.id, { limit: 2 }).map((message) => message.sequence),
    [4, 5],
  );
});

test('listMessagesByIds 完整返回超过 200 条的指定消息并保持 sequence 顺序', () => {
  const conversation = createDirect();
  const messageIds: string[] = [];
  for (let sequence = 1; sequence <= 205; sequence += 1) {
    const message = repo.appendMessage(
      humanMessage(conversation.id, `m${sequence}`, `消息 ${sequence}`),
    );
    messageIds.push(message.id);
  }

  const messages = repo.listMessagesByIds(conversation.id, messageIds.reverse());
  assert.equal(messages.length, 205);
  assert.deepEqual(
    messages.map((message) => message.sequence),
    Array.from({ length: 205 }, (_, index) => index + 1),
  );
});

test('listMessages 拒绝 hostile 会话 id 和越界分页', () => {
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.throws(() => repo.listMessages(hostile as any), /会话/);
    assert.throws(() => repo.listMessagesByIds(hostile as any, []), /会话/);
  }
  const conversation = createDirect();
  assert.deepEqual(repo.listMessagesByIds(conversation.id, []), []);
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.throws(
      () => repo.listMessagesByIds(conversation.id, [hostile] as any),
      /消息 id/,
    );
  }
  for (const options of [
    { limit: 0 },
    { limit: 201 },
    { limit: Number.NaN },
    { beforeSequence: 0 },
    { beforeSequence: 1.5 },
  ]) {
    assert.throws(() => repo.listMessages(conversation.id, options), /分页/);
  }
});

test('claimPending 只领取调用时已有 pending，后到消息进入下一批', () => {
  const conversation = createDirect();
  const first = repo.appendMessage(humanMessage(conversation.id, 'm1'));
  const batch1 = repo.claimPending(conversation.id, 'agent-a', 'batch-1');
  assert.deepEqual(batch1.map((item) => item.messageId), [first.id]);
  assert.equal(batch1[0]?.status, 'processing');

  const second = repo.appendMessage(humanMessage(conversation.id, 'm2'));
  assert.deepEqual(repo.claimPending(conversation.id, 'agent-a', 'batch-2').map((item) => item.messageId), [
    second.id,
  ]);
});

test('Agent 自己后落库的消息不会吞掉生成期间收到的投递', () => {
  const conversation = createGroup();
  const human = repo.appendMessage(humanMessage(conversation.id, 'm1'));
  const fromB = repo.appendMessage(agentMessage(conversation.id, 'agent-b', 'm2'));
  repo.appendMessage(agentMessage(conversation.id, 'agent-a', 'm3'));
  const pendingForA = repo.claimPending(conversation.id, 'agent-a', 'batch-a');
  assert.deepEqual(pendingForA.map((item) => item.messageId), [human.id, fromB.id]);
});

test('requeueBatch 只将指定 processing 批次恢复为 pending', () => {
  const conversation = createGroup();
  repo.appendMessage(humanMessage(conversation.id, 'm1'));
  repo.claimPending(conversation.id, 'agent-a', 'batch-requeue');
  repo.claimPending(conversation.id, 'agent-b', 'batch-other');

  assert.equal(repo.requeueBatch('batch-requeue'), 1);
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), true);
  assert.equal(repo.hasPending(conversation.id, 'agent-b'), false);

  const rows = getDB().prepare(
    `SELECT agent_id, status, batch_id, processed_at, error
     FROM conversation_deliveries
     ORDER BY agent_id`,
  ).all() as Array<{
    agent_id: string;
    status: string;
    batch_id: string | null;
    processed_at: number | null;
    error: string | null;
  }>;
  assert.deepEqual(rows, [
    {
      agent_id: 'agent-a',
      status: 'pending',
      batch_id: null,
      processed_at: null,
      error: null,
    },
    {
      agent_id: 'agent-b',
      status: 'processing',
      batch_id: 'batch-other',
      processed_at: null,
      error: null,
    },
  ]);
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.throws(() => repo.requeueBatch(hostile as any), /批次 id/);
  }
});

test('completeBatch 和 failBatch 只更新对应 processing 批次', () => {
  const conversation = createGroup();
  repo.appendMessage(humanMessage(conversation.id, 'm1'));
  repo.claimPending(conversation.id, 'agent-a', 'batch-complete');
  repo.claimPending(conversation.id, 'agent-b', 'batch-fail');
  repo.completeBatch('batch-complete');
  repo.failBatch('batch-fail', '模型不可用');

  const rows = getDB().prepare(
    `SELECT agent_id, status, processed_at, error FROM conversation_deliveries ORDER BY agent_id`,
  ).all() as Array<{ agent_id: string; status: string; processed_at: number | null; error: string | null }>;
  assert.deepEqual(rows.map((row) => [row.agent_id, row.status, typeof row.processed_at, row.error]), [
    ['agent-a', 'processed', 'number', null],
    ['agent-b', 'failed', 'number', '模型不可用'],
  ]);
});

test('appendAgentReplyAndCompleteBatch 原子提交 group 回复、其他成员投递和当前 batch', () => {
  const conversation = createGroup();
  repo.appendMessage(humanMessage(conversation.id, 'human-1'));
  repo.claimPending(conversation.id, 'agent-a', 'batch-group');

  const reply = repo.appendAgentReplyAndCompleteBatch({
    id: 'reply-group',
    batchId: 'batch-group',
    conversationId: conversation.id,
    agentId: 'agent-a',
    content: '完整群聊回复',
  });

  assert.equal(reply.senderId, 'agent-a');
  assert.equal(reply.senderType, 'agent');
  assert.equal(repo.hasPending(conversation.id, 'agent-b'), true);
  const currentBatch = getDB().prepare(
    `SELECT status, processed_at, error
     FROM conversation_deliveries
     WHERE batch_id = ? AND agent_id = ?`,
  ).get('batch-group', 'agent-a') as {
    status: string;
    processed_at: number | null;
    error: string | null;
  };
  assert.equal(currentBatch.status, 'processed');
  assert.equal(typeof currentBatch.processed_at, 'number');
  assert.equal(currentBatch.error, null);
});

test('appendAgentReplyAndCompleteBatch 原子提交 direct 回复且不创建自有投递', () => {
  const conversation = createDirect();
  repo.appendMessage(humanMessage(conversation.id, 'human-1'));
  repo.claimPending(conversation.id, 'agent-a', 'batch-direct');

  repo.appendAgentReplyAndCompleteBatch({
    id: 'reply-direct',
    batchId: 'batch-direct',
    conversationId: conversation.id,
    agentId: 'agent-a',
    content: '完整私聊回复',
  });

  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['人类消息', '完整私聊回复'],
  );
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), false);
});

test('原子回复在 batch complete 失败时整体回滚，恢复后不会重复回复', () => {
  const conversation = createDirect();
  repo.appendMessage(humanMessage(conversation.id, 'human-1'));
  repo.claimPending(conversation.id, 'agent-a', 'batch-crash');
  const db = getDB();
  db.exec(`
    CREATE TRIGGER fail_conversation_batch_complete
    BEFORE UPDATE OF status ON conversation_deliveries
    WHEN NEW.status = 'processed'
    BEGIN
      SELECT RAISE(ABORT, '模拟 batch complete 崩溃');
    END;
  `);

  assert.throws(() => repo.appendAgentReplyAndCompleteBatch({
    id: 'reply-before-crash',
    batchId: 'batch-crash',
    conversationId: conversation.id,
    agentId: 'agent-a',
    content: '崩溃窗口中的回复',
  }), /模拟 batch complete 崩溃/);
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.id),
    ['human-1'],
  );
  assert.deepEqual(
    db.prepare(
      `SELECT status, batch_id FROM conversation_deliveries
       WHERE message_id = ? AND agent_id = ?`,
    ).get('human-1', 'agent-a'),
    { status: 'processing', batch_id: 'batch-crash' },
  );

  db.exec(`DROP TRIGGER fail_conversation_batch_complete`);
  assert.equal(repo.recoverProcessing(), 1);
  repo.claimPending(conversation.id, 'agent-a', 'batch-recovered');
  repo.appendAgentReplyAndCompleteBatch({
    id: 'reply-after-recovery',
    batchId: 'batch-recovered',
    conversationId: conversation.id,
    agentId: 'agent-a',
    content: '恢复后的唯一回复',
  });
  assert.deepEqual(
    repo.listMessages(conversation.id).map((message) => message.content),
    ['人类消息', '恢复后的唯一回复'],
  );
});

test('recoverProcessing 将遗留 processing 恢复为 pending', () => {
  const conversation = createDirect();
  repo.appendMessage(humanMessage(conversation.id, 'm1'));
  repo.claimPending(conversation.id, 'agent-a', 'batch-1');
  assert.equal(repo.recoverProcessing(), 1);
  assert.equal(repo.hasPending(conversation.id, 'agent-a'), true);
  const delivery = repo.claimPending(conversation.id, 'agent-a', 'batch-2')[0];
  assert.equal(delivery?.batchId, 'batch-2');
  assert.equal(delivery?.processedAt, undefined);
  assert.equal(delivery?.error, undefined);
});

test('getDiscussionStats 只由人类消息或命名 protection boundary 重置', () => {
  const conversation = createGroup();
  assert.equal(typeof (repo as any).getDiscussionStats, 'function');
  assert.deepEqual(repo.getDiscussionStats(conversation.id), {
    agentMessagesSinceHuman: 0,
    lastSenderId: undefined,
    consecutiveLastSender: 0,
  });

  repo.appendMessage(humanMessage(conversation.id, 'human-1'));
  repo.appendMessage(agentMessage(conversation.id, 'agent-a', 'agent-a-1'));
  repo.appendMessage(agentMessage(conversation.id, 'agent-a', 'agent-a-2'));
  assert.deepEqual(repo.getDiscussionStats(conversation.id), {
    agentMessagesSinceHuman: 2,
    lastSenderId: 'agent-a',
    consecutiveLastSender: 2,
  });

  repo.appendMessage(agentMessage(conversation.id, 'agent-b', 'agent-b-1'));
  assert.deepEqual(repo.getDiscussionStats(conversation.id), {
    agentMessagesSinceHuman: 3,
    lastSenderId: 'agent-b',
    consecutiveLastSender: 1,
  });

  repo.appendMessage({
    id: 'system-1',
    conversationId: conversation.id,
    senderId: 'system',
    senderType: 'system',
    content: '普通系统通知',
  });
  assert.deepEqual(repo.getDiscussionStats(conversation.id), {
    agentMessagesSinceHuman: 3,
    lastSenderId: 'agent-b',
    consecutiveLastSender: 1,
  });
  repo.appendMessage(agentMessage(conversation.id, 'agent-b', 'agent-b-2'));
  assert.deepEqual(repo.getDiscussionStats(conversation.id), {
    agentMessagesSinceHuman: 4,
    lastSenderId: 'agent-b',
    consecutiveLastSender: 2,
  });

  repo.appendMessage(humanMessage(conversation.id, 'human-2'));
  assert.deepEqual(repo.getDiscussionStats(conversation.id), {
    agentMessagesSinceHuman: 0,
    lastSenderId: undefined,
    consecutiveLastSender: 0,
  });

  repo.appendMessage(agentMessage(conversation.id, 'agent-a', 'agent-a-3'));
  const boundary = repo.appendMessage({
    id: 'limit-resume-boundary',
    conversationId: conversation.id,
    senderId: 'system',
    senderType: 'system',
    content: '讨论保护已暂停，显式恢复后开启新窗口',
    protectionBoundary: 'discussion_limit_resume',
  });
  assert.equal(boundary.protectionBoundary, 'discussion_limit_resume');
  assert.deepEqual(repo.getDiscussionStats(conversation.id), {
    agentMessagesSinceHuman: 0,
    lastSenderId: undefined,
    consecutiveLastSender: 0,
  });
});

test('failPendingForAgent 只失败目标 Agent 的 pending 和 processing', () => {
  const conversation = createGroup();
  repo.appendMessage(humanMessage(conversation.id, 'm1'));
  repo.claimPending(conversation.id, 'agent-b', 'batch-b');
  repo.appendMessage(humanMessage(conversation.id, 'm2'));

  assert.equal(typeof (repo as any).failPendingForAgent, 'function');
  assert.equal(
    repo.failPendingForAgent(conversation.id, 'agent-b', 'Agent 配置已失效'),
    2,
  );
  const rows = getDB().prepare(
    `SELECT agent_id, status, batch_id, processed_at, error
     FROM conversation_deliveries
     ORDER BY agent_id`,
  ).all() as Array<{
    agent_id: string;
    status: string;
    batch_id: string | null;
    processed_at: number | null;
    error: string | null;
  }>;
  const agentARows = rows.filter((row) => row.agent_id === 'agent-a');
  const agentBRows = rows.filter((row) => row.agent_id === 'agent-b');
  assert.deepEqual(agentARows.map((row) => row.status), ['pending', 'pending']);
  assert.deepEqual(
    agentBRows.map((row) => ({
      status: row.status,
      batch_id: row.batch_id,
      error: row.error,
    })),
    [
      { status: 'failed', batch_id: null, error: 'Agent 配置已失效' },
      { status: 'failed', batch_id: null, error: 'Agent 配置已失效' },
    ],
  );
  assert.ok(agentBRows.every((row) => typeof row.processed_at === 'number'));
});

test('移除群成员会将该 Agent 未完成投递标记为 failed', () => {
  const conversation = createGroup('remove-group', ['agent-a', 'agent-b', 'agent-c']);
  repo.appendMessage(humanMessage(conversation.id, 'm1'));
  repo.claimPending(conversation.id, 'agent-c', 'batch-c');
  repo.appendMessage(humanMessage(conversation.id, 'm2'));
  assert.equal(repo.removeAgentMember(conversation.id, 'agent-c'), true);
  const rows = getDB().prepare(
    `SELECT status, error FROM conversation_deliveries WHERE conversation_id = ? AND agent_id = ?`,
  ).all(conversation.id, 'agent-c') as Array<{ status: string; error: string }>;
  assert.deepEqual(rows, [
    { status: 'failed', error: '已移出群聊' },
    { status: 'failed', error: '已移出群聊' },
  ]);
});

test('删除 Agent 配置时清理所有会话成员并失败未完成投递', () => {
  const group = createGroup('deleted-agent-group', ['agent-a', 'agent-b']);
  const direct = createDirect('deleted-agent-direct', 'agent-a');
  repo.appendMessage(humanMessage(group.id, 'm1'));
  repo.claimPending(group.id, 'agent-a', 'batch-a');
  repo.appendMessage(humanMessage(group.id, 'm2'));

  const changed = repo.removeAgentFromAllConversations('agent-a');

  assert.deepEqual(changed.sort(), [direct.id, group.id].sort());
  assert.deepEqual(repo.listMembers(group.id).map((member) => member.memberId), ['boss', 'agent-b']);
  assert.deepEqual(repo.listMembers(direct.id).map((member) => member.memberId), ['boss']);
  const rows = getDB().prepare(
    `SELECT status, error FROM conversation_deliveries WHERE conversation_id = ? AND agent_id = ?`,
  ).all(group.id, 'agent-a') as Array<{ status: string; error: string }>;
  assert.deepEqual(rows, [
    { status: 'failed', error: 'Agent 已删除' },
    { status: 'failed', error: 'Agent 已删除' },
  ]);
});

test('row mapper 遇到损坏 mentions JSON 时安全返回空数组', () => {
  const conversation = createDirect();
  repo.appendMessage(humanMessage(conversation.id, 'm1'));
  getDB().prepare(`UPDATE conversation_messages SET mentions = ? WHERE id = ?`).run('{bad json', 'm1');
  assert.deepEqual(repo.listMessages(conversation.id)[0]?.mentions, []);
  getDB().prepare(`UPDATE conversation_messages SET mentions = ? WHERE id = ?`).run(
    JSON.stringify(['agent-a', 1, null]),
    'm1',
  );
  assert.deepEqual(repo.listMessages(conversation.id)[0]?.mentions, ['agent-a']);
});

test('delete 级联删除成员、消息和投递', () => {
  const conversation = createDirect();
  repo.appendMessage(humanMessage(conversation.id, 'm1'));
  assert.equal(repo.delete(conversation.id), true);
  assert.equal(repo.delete(conversation.id), false);
  for (const table of [
    'conversation_members',
    'conversation_messages',
    'conversation_deliveries',
  ]) {
    const row = getDB().prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE conversation_id = ?`,
    ).get(conversation.id) as { count: number };
    assert.equal(row.count, 0, `${table} 应级联删除`);
  }
});

test('lookup 方法对 hostile input 不抛 TypeError', () => {
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.doesNotThrow(() => repo.get(hostile as any));
    assert.equal(repo.get(hostile as any), null);
    assert.doesNotThrow(() => repo.findDirectByAgent(hostile as any));
    assert.equal(repo.findDirectByAgent(hostile as any), null);
    assert.doesNotThrow(() => repo.hasPending(hostile as any, hostile as any));
    assert.equal(repo.hasPending(hostile as any, hostile as any), false);
  }
});

test('讨论统计和投递失败接口拒绝 hostile input 与空错误', () => {
  const conversation = createGroup();
  assert.equal(typeof (repo as any).getDiscussionStats, 'function');
  assert.equal(typeof (repo as any).failPendingForAgent, 'function');
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.throws(() => repo.getDiscussionStats(hostile as any), /会话 id/);
    assert.throws(
      () => repo.failPendingForAgent(
        conversation.id,
        hostile as any,
        '配置失效',
      ),
      /Agent id/,
    );
  }
  for (const error of [undefined, null, '', '   ']) {
    assert.throws(
      () => repo.failPendingForAgent(
        conversation.id,
        'agent-a',
        error as any,
      ),
      /投递错误/,
    );
  }
});
