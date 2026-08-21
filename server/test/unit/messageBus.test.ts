/**
 * message-bus.ts 单测:EventEmitter + 持久化 + @mention
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDB, closeDB } from '../../src/store/db.js';
import {
  extractMentionIds,
  MessageBus,
} from '../../src/orchestrator/message-bus.js';
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
  getDB().exec(`DELETE FROM messages`);
});

test('subscribe 后 publish 触发 handler', async () => {
  const bus = new MessageBus();
  const got: string[] = [];
  bus.subscribe('general', (m) => { got.push(m.content); });

  await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: 'hello',
  });
  // notify 是 queueMicrotask 异步,等一下
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, ['hello']);
});

test('subscribe 返 unsubscribe 函数,调用后 handler 不再触发', async () => {
  const bus = new MessageBus();
  const got: string[] = [];
  const unsub = bus.subscribe('general', (m) => { got.push(m.content); });
  unsub();

  await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: 'x',
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, [], 'unsub 后不应触发');
});

test('publish 持久化到 db', async () => {
  const bus = new MessageBus();
  const msg = await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '持久化测试',
  });
  assert.ok(msg.id);
  assert.ok(msg.createdAt);
  // 从 db 直接验证
  const db = getDB();
  const row = db.prepare(`SELECT content FROM messages WHERE id = ?`).get(msg.id) as any;
  assert.equal(row.content, '持久化测试');
});

test('publish 触发所有订阅者,每个都收到', async () => {
  const bus = new MessageBus();
  const a: string[] = [];
  const b: string[] = [];
  bus.subscribe('general', (m) => { a.push(m.id); });
  bus.subscribe('general', (m) => { b.push(m.id); });

  const msg = await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '广播',
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(a, [msg.id]);
  assert.deepEqual(b, [msg.id]);
});

test('不同 channel 互不干扰', async () => {
  const bus = new MessageBus();
  const general: string[] = [];
  const dev: string[] = [];
  bus.subscribe('general', (m) => { general.push(m.content); });
  bus.subscribe('dev', (m) => { dev.push(m.content); });

  await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: 'general-msg',
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(general, ['general-msg']);
  assert.deepEqual(dev, []);
});

test('handler 抛错不影响其他 handler', async () => {
  const bus = new MessageBus();
  const got: string[] = [];
  bus.subscribe('general', () => { throw new Error('boom'); });
  bus.subscribe('general', (m) => { got.push(m.content); });

  // 抑制 handler 内的 console.error
  const orig = console.error;
  console.error = () => {};
  try {
    await bus.publish({
      projectId: 'p1',
      channel: 'general',
      fromId: 'boss',
      fromName: '球球',
      content: 'after-boom',
    });
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    console.error = orig;
  }
  assert.deepEqual(got, ['after-boom'], '后续 handler 应收到');
});

test('async handler 也被 await', async () => {
  const bus = new MessageBus();
  let resolved = false;
  bus.subscribe('general', async (m) => {
    await new Promise((r) => setTimeout(r, 10));
    resolved = true;
    assert.equal(m.content, 'async');
  });

  await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: 'async',
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(resolved, true, 'async handler 应被调用');
});

test('publish 自动提取 content 里的 @mention', async () => {
  const bus = new MessageBus();
  const msg = await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '@a-frontend @a-backend 看看这个',
  });
  assert.deepEqual(msg.mentions, ['a-frontend', 'a-backend']);
});

test('publish 提取 @ 中文 id(\\p{L} 支持)', async () => {
  const bus = new MessageBus();
  const msg = await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '@产品-张三 @研发-李四 来',
  });
  assert.deepEqual(msg.mentions, ['产品-张三', '研发-李四']);
});

test('publish 提取 @纯中文 id', async () => {
  const bus = new MessageBus();
  const msg = await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '@球球 @所有人',
  });
  assert.deepEqual(msg.mentions, ['球球', '所有人']);
});

test('publish 显式传 mentions 时优先用显式值', async () => {
  const bus = new MessageBus();
  const msg = await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '@auto-extract',
    mentions: ['explicit-1', 'explicit-2'],
  });
  assert.deepEqual(msg.mentions, ['explicit-1', 'explicit-2']);
});

test('content 不含 @ 时 mentions 为空数组', async () => {
  const bus = new MessageBus();
  const msg = await bus.publish({
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '普通消息',
  });
  assert.deepEqual(msg.mentions, []);
});

test('extractMentionIds 支持中文、按首次出现去重并拒绝 hostile 输入', () => {
  assert.deepEqual(
    extractMentionIds('@产品-张三 @agent-a @产品-张三 @__proto__ @constructor @prototype'),
    ['产品-张三', 'agent-a'],
  );
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.deepEqual(extractMentionIds(hostile), []);
  }
});

test('history 列项目历史消息(无 channel)', () => {
  const bus = new MessageBus();
  bus.messageRepo // ensure init
  const db = getDB();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, project_id, channel, from_id, from_name, content, type, mentions, created_at)
     VALUES ('m1', 'p1', 'general', 'boss', '球球', 'a', 'message', '[]', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO messages (id, project_id, channel, from_id, from_name, content, type, mentions, created_at)
     VALUES ('m2', 'p1', 'dev', 'boss', '球球', 'b', 'message', '[]', ?)`,
  ).run(now + 1);
  db.prepare(
    `INSERT INTO messages (id, project_id, channel, from_id, from_name, content, type, mentions, created_at)
     VALUES ('m3', 'p2', 'general', 'boss', '球球', 'c', 'message', '[]', ?)`,
  ).run(now + 2);

  const hist = bus.history('p1');
  assert.equal(hist.length, 2, '应只返 p1 的');
});

test('history 指定 channel 时过滤', () => {
  const bus = new MessageBus();
  const db = getDB();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, project_id, channel, from_id, from_name, content, type, mentions, created_at)
     VALUES ('m1', 'p1', 'general', 'boss', '球球', 'a', 'message', '[]', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO messages (id, project_id, channel, from_id, from_name, content, type, mentions, created_at)
     VALUES ('m2', 'p1', 'dev', 'boss', '球球', 'b', 'message', '[]', ?)`,
  ).run(now + 1);

  const hist = bus.history('p1', 'dev');
  assert.equal(hist.length, 1);
  assert.equal(hist[0].content, 'b');
});

test('publish 返的 msg 字段完整', async () => {
  const bus = new MessageBus();
  const msg = await bus.publish({
    projectId: 'p1',
    taskId: 't1',
    channel: 'general',
    fromId: 'a1',
    fromName: '前端-小李',
    fromRole: 'worker',
    content: '收到',
    type: 'message',
    mentions: ['boss'],
  });
  assert.equal(msg.projectId, 'p1');
  assert.equal(msg.taskId, 't1');
  assert.equal(msg.channel, 'general');
  assert.equal(msg.fromId, 'a1');
  assert.equal(msg.fromName, '前端-小李');
  assert.equal(msg.fromRole, 'worker');
  assert.equal(msg.type, 'message');
  assert.deepEqual(msg.mentions, ['boss']);
});
