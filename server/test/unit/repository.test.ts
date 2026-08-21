/**
 * repository.ts 单测:5 个 Repo 的 CRUD 行为
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDB, closeDB } from '../../src/store/db.js';
import {
  ProjectRepo,
  TaskRepo,
  DeliverableRepo,
  MessageRepo,
  AgentStatusRepo,
} from '../../src/store/repository.js';
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
  // 清表,保留 schema
  const db = getDB();
  for (const t of ['messages', 'agent_status', 'deliverables', 'tasks', 'projects']) {
    db.exec(`DELETE FROM ${t}`);
  }
  // seed 一个 p1(给 task / deliverable / message 外键用)
  // ProjectRepo 自己测时用其他 id 避免冲突
  new ProjectRepo().create(makeProject({ id: 'p1' }));
});

function makeProject(over: Partial<Parameters<ProjectRepo['create']>[0]> = {}) {
  return {
    id: 'p1',
    title: '球球的视频项目',
    description: '测试用',
    boss: '球球',
    status: 'idea' as const,
    phase: 'idea',
    metadata: { tag: 'demo' },
    ...over,
  };
}

/** 给 TaskRepo / DeliverableRepo / MessageRepo 测试用的 seed project */
function seedProject() {
  new ProjectRepo().create(makeProject());
}

function makeTask(over: Partial<Parameters<TaskRepo['create']>[0]> = {}) {
  return {
    id: 't1',
    projectId: 'p1',
    phase: 'dev',
    department: 'dev',
    assignee: 'a1',
    title: '写代码',
    prompt: '写个 hello world',
    status: 'pending' as const,
    inputFiles: [],
    outputFiles: [],
    dependsOn: [],
    attempts: 0,
    maxAttempts: 3,
    workflowIteration: 0,
    cost: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
    ...over,
  };
}

function makeDeliverable(over: Partial<Parameters<DeliverableRepo['create']>[0]> = {}) {
  return {
    id: 'd1',
    projectId: 'p1',
    taskId: 't1',
    type: 'code' as const,
    path: '/tmp/x.ts',
    metadata: {},
    ...over,
  };
}

function makeMessage(over: Partial<Parameters<MessageRepo['create']>[0]> = {}) {
  return {
    id: 'm1',
    projectId: 'p1',
    channel: 'general',
    fromId: 'boss',
    fromName: '球球',
    content: '你好',
    type: 'message' as const,
    mentions: [],
    ...over,
  };
}

// =================== ProjectRepo ===================

test('ProjectRepo.create 写入并能 get 取回', () => {
  const repo = new ProjectRepo();
  const p = repo.create(makeProject({ id: 'proj-1' }));
  assert.equal(p.id, 'proj-1');
  assert.equal(p.title, '球球的视频项目');
  assert.equal(p.boss, '球球');
  assert.deepEqual(p.metadata, { tag: 'demo' });
  const got = repo.get('proj-1');
  assert.ok(got);
  assert.equal(got!.title, '球球的视频项目');
});

test('ProjectRepo.get 不存在返 null', () => {
  const repo = new ProjectRepo();
  assert.equal(repo.get('nope'), null);
});

test('ProjectRepo.list 按 created_at DESC 排序', async () => {
  const repo = new ProjectRepo();
  repo.create(makeProject({ id: 'proj-a' }));
  await new Promise((r) => setTimeout(r, 5));
  repo.create(makeProject({ id: 'proj-b' }));
  const list = repo.list();
  // beforeEach 已有 p1 + 2 新增
  assert.equal(list.length, 3);
  // 最新的在最前
  assert.equal(list[0].id, 'proj-b');
});

test('ProjectRepo.updateStatus 更新状态和 phase', () => {
  const repo = new ProjectRepo();
  repo.updateStatus('p1', 'dev', 'dev');
  const got = repo.get('p1')!;
  assert.equal(got.status, 'dev');
  assert.equal(got.phase, 'dev');
  assert.ok(got.updatedAt >= got.createdAt);
});

test('ProjectRepo metadata 序列化为 JSON 再反序列化', () => {
  const repo = new ProjectRepo();
  // p1 是 beforeEach seed 的,验证 metadata
  const got = repo.get('p1')!;
  assert.deepEqual(got.metadata, { tag: 'demo' });
  // 再写一个自定义 metadata
  repo.create(makeProject({ id: 'proj-2', metadata: { tags: ['a', 'b'], count: 3 } }));
  const got2 = repo.get('proj-2')!;
  assert.deepEqual(got2.metadata, { tags: ['a', 'b'], count: 3 });
});

test('ProjectRepo.delete 删除项目记录和关联数据但不删除项目目录文件', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'repo-delete-project-'));
  const markerPath = join(projectDir, '留存文件.txt');
  mkdirSync(join(projectDir, '.agent-company'), { recursive: true });
  writeFileSync(markerPath, '不能删除文件');

  const projectRepo = new ProjectRepo();
  const taskRepo = new TaskRepo();
  const deliverableRepo = new DeliverableRepo();
  const messageRepo = new MessageRepo();

  try {
    projectRepo.create(makeProject({
      id: 'delete-me',
      metadata: { projectDir },
    }));
    taskRepo.create(makeTask({ id: 'task-delete-me', projectId: 'delete-me' }));
    deliverableRepo.create(makeDeliverable({
      id: 'deliverable-delete-me',
      projectId: 'delete-me',
      taskId: 'task-delete-me',
    }));
    messageRepo.create(makeMessage({ id: 'message-delete-me', projectId: 'delete-me' }));

    assert.equal(projectRepo.delete('delete-me'), true);

    assert.equal(projectRepo.get('delete-me'), null);
    assert.deepEqual(taskRepo.listByProject('delete-me'), []);
    assert.deepEqual(deliverableRepo.listByProject('delete-me'), []);
    assert.deepEqual(messageRepo.listByProject('delete-me'), []);
    assert.equal(existsSync(projectDir), true);
    assert.equal(existsSync(markerPath), true);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('ProjectRepo.delete 删除不存在项目返回 false', () => {
  const repo = new ProjectRepo();
  assert.equal(repo.delete('missing-project'), false);
});

// =================== TaskRepo ===================

test('TaskRepo.create 写入并能 get 取回', () => {
  const repo = new TaskRepo();
  const t = repo.create(makeTask({
    workflowNodeId: 'stage-dev',
    workflowIteration: 2,
    cost: { inputTokens: 10, outputTokens: 20, durationMs: 100 },
  }));
  assert.equal(t.id, 't1');
  assert.equal(t.workflowNodeId, 'stage-dev');
  assert.equal(t.workflowIteration, 2);
  assert.deepEqual(t.cost, { inputTokens: 10, outputTokens: 20, durationMs: 100 });
  const got = repo.get('t1');
  assert.ok(got);
  assert.equal(got.workflowNodeId, 'stage-dev');
  assert.equal(got.workflowIteration, 2);
  assert.deepEqual(got!.inputFiles, []);
  assert.deepEqual(got!.dependsOn, []);
});

test('TaskRepo 完整映射 hostile node ID 且状态更新不丢失归属', () => {
  const repo = new TaskRepo();
  for (const [index, workflowNodeId] of ['__proto__', 'constructor'].entries()) {
    const id = `hostile-node-${index}`;
    repo.create(makeTask({
      id,
      workflowNodeId,
      workflowIteration: index + 1,
    }));
    repo.updateStatus(id, 'running');

    const got = repo.get(id);
    assert.equal(got?.workflowNodeId, workflowNodeId);
    assert.equal(got?.workflowIteration, index + 1);
    const listed = repo.listByProject('p1').find((task) => task.id === id);
    assert.equal(listed?.workflowNodeId, workflowNodeId);
    assert.equal(listed?.workflowIteration, index + 1);
  }
});

test('TaskRepo 旧归属缺失时读取为 undefined/0', () => {
  const repo = new TaskRepo();
  repo.create(makeTask({ id: 'legacy-shape' }));

  const task = repo.get('legacy-shape');
  assert.equal(task?.workflowNodeId, undefined);
  assert.equal(task?.workflowIteration, 0);
});

test('TaskRepo.create 拒绝无效 workflow node 与 iteration', () => {
  const repo = new TaskRepo();
  const invalidNodeIds = [null, '', '   ', 'x'.repeat(201)];
  for (const [index, workflowNodeId] of invalidNodeIds.entries()) {
    assert.throws(
      () => repo.create(makeTask({
        id: `invalid-node-${index}`,
        workflowNodeId: workflowNodeId as unknown as string,
      })),
      /工作流节点 ID/,
    );
  }

  const invalidIterations = [
    undefined,
    null,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ];
  for (const [index, workflowIteration] of invalidIterations.entries()) {
    assert.throws(
      () => repo.create(makeTask({
        id: `invalid-iteration-${index}`,
        workflowIteration: workflowIteration as unknown as number,
      })),
      /工作流轮次/,
    );
  }
});

test('TaskRepo.listByProject 按 created_at ASC', async () => {
  const repo = new TaskRepo();
  repo.create(makeTask({ id: 'first' }));
  await new Promise((r) => setTimeout(r, 5));
  repo.create(makeTask({ id: 'second' }));
  const list = repo.listByProject('p1');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'first');
  assert.equal(list[1].id, 'second');
});

test('TaskRepo.listByProject 只返指定项目', () => {
  const repo = new TaskRepo();
  // 额外建一个 p2 项目,让 t-p2 的外键合法
  new ProjectRepo().create(makeProject({ id: 'p2' }));
  repo.create(makeTask({ id: 't-p1' }));
  repo.create(makeTask({ id: 't-p2', projectId: 'p2' }));
  const list = repo.listByProject('p1');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 't-p1');
});

test('TaskRepo.listByStatus 过滤 status', () => {
  const repo = new TaskRepo();
  repo.create(makeTask({ id: 'a', status: 'pending' }));
  repo.create(makeTask({ id: 'b', status: 'running' }));
  repo.create(makeTask({ id: 'c', status: 'pending' }));
  const list = repo.listByStatus('pending');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((t) => t.id).sort(), ['a', 'c']);
});

test('TaskRepo.updateStatus:running 设置 started_at', () => {
  const repo = new TaskRepo();
  repo.create(makeTask());
  const before = Date.now();
  repo.updateStatus('t1', 'running');
  const got = repo.get('t1')!;
  assert.equal(got.status, 'running');
  assert.ok(got.startedAt! >= before);
  assert.equal(got.finishedAt, undefined, '未完成不应有 finishedAt');
});

test('TaskRepo.updateStatus:done 设置 finished_at 不覆盖 started_at', () => {
  const repo = new TaskRepo();
  repo.create(makeTask());
  repo.updateStatus('t1', 'running');
  const startedAt = repo.get('t1')!.startedAt;
  repo.updateStatus('t1', 'done');
  const got = repo.get('t1')!;
  assert.equal(got.status, 'done');
  assert.equal(got.finishedAt, got.startedAt! >= startedAt! ? got.finishedAt : startedAt);
  assert.equal(got.startedAt, startedAt, 'startedAt 不应被覆盖');
});

test('TaskRepo.updateStatus:failed 标记 finished_at', () => {
  const repo = new TaskRepo();
  repo.create(makeTask());
  repo.updateStatus('t1', 'failed');
  const got = repo.get('t1')!;
  assert.equal(got.status, 'failed');
  assert.ok(got.finishedAt);
});

test('TaskRepo.recordResult 无错时 status=done', () => {
  const repo = new TaskRepo();
  repo.create(makeTask());
  repo.recordResult('t1', {
    outputFiles: ['/x.ts'],
    outputSummary: 'ok',
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 2000,
  });
  const got = repo.get('t1')!;
  assert.equal(got.status, 'done');
  assert.equal(got.outputSummary, 'ok');
  assert.deepEqual(got.outputFiles, ['/x.ts']);
  assert.deepEqual(got.cost, { inputTokens: 100, outputTokens: 50, durationMs: 2000 });
  assert.equal(got.error, undefined);
});

test('TaskRepo.recordResult 有错时 status=failed + 存 error', () => {
  const repo = new TaskRepo();
  repo.create(makeTask());
  repo.recordResult('t1', {
    outputFiles: [],
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 100,
    error: 'boom',
  });
  const got = repo.get('t1')!;
  assert.equal(got.status, 'failed');
  assert.equal(got.error, 'boom');
});

test('TaskRepo.incrementAttempts 累加', () => {
  const repo = new TaskRepo();
  repo.create(makeTask());
  repo.incrementAttempts('t1');
  repo.incrementAttempts('t1');
  repo.incrementAttempts('t1');
  const got = repo.get('t1')!;
  assert.equal(got.attempts, 3);
});

// =================== DeliverableRepo ===================

test('DeliverableRepo.create + listByProject', () => {
  const repo = new DeliverableRepo();
  repo.create(makeDeliverable({ id: 'd1' }));
  repo.create(makeDeliverable({ id: 'd2', type: 'design' }));
  const list = repo.listByProject('p1');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'd1');
  assert.equal(list[1].id, 'd2');
  assert.equal(list[1].type, 'design');
});

test('DeliverableRepo.listByProject 只返指定项目', () => {
  const repo = new DeliverableRepo();
  new ProjectRepo().create(makeProject({ id: 'p2' }));
  repo.create(makeDeliverable({ id: 'd1' }));
  repo.create(makeDeliverable({ id: 'd2', projectId: 'p2' }));
  const list = repo.listByProject('p1');
  assert.equal(list.length, 1);
});

test('DeliverableRepo metadata 序列化为 JSON', () => {
  const repo = new DeliverableRepo();
  repo.create(makeDeliverable({ metadata: { lines: 100, lang: 'ts' } }));
  const list = repo.listByProject('p1');
  assert.deepEqual(list[0].metadata, { lines: 100, lang: 'ts' });
});

// =================== MessageRepo ===================

test('MessageRepo.create + listByProject', () => {
  const repo = new MessageRepo();
  repo.create(makeMessage({ id: 'm1' }));
  repo.create(makeMessage({ id: 'm2' }));
  const list = repo.listByProject('p1');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'm1');
  assert.equal(list[1].id, 'm2');
});

test('MessageRepo.listByProject 限制 limit', () => {
  const repo = new MessageRepo();
  for (let i = 0; i < 5; i++) {
    repo.create(makeMessage({ id: `m${i}` }));
  }
  const list = repo.listByProject('p1', 2);
  assert.equal(list.length, 2);
});

test('MessageRepo.listByChannel 过滤 channel', () => {
  const repo = new MessageRepo();
  repo.create(makeMessage({ id: 'a', channel: 'general' }));
  repo.create(makeMessage({ id: 'b', channel: 'boss' }));
  repo.create(makeMessage({ id: 'c', channel: 'general' }));
  const list = repo.listByChannel('p1', 'general');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((m) => m.id).sort(), ['a', 'c']);
});

test('MessageRepo mentions 数组 JSON 序列化往返', () => {
  const repo = new MessageRepo();
  repo.create(makeMessage({ mentions: ['a1', 'a2'] }));
  const list = repo.listByProject('p1');
  assert.deepEqual(list[0].mentions, ['a1', 'a2']);
});

test('MessageRepo toolInput 对象 JSON 序列化往返', () => {
  const repo = new MessageRepo();
  repo.create(makeMessage({ type: 'tool', toolName: 'shell', toolInput: { cmd: 'ls' } }));
  const list = repo.listByProject('p1');
  assert.deepEqual(list[0].toolInput, { cmd: 'ls' });
  assert.equal(list[0].toolName, 'shell');
});

// =================== AgentStatusRepo ===================

test('AgentStatusRepo.setStatus 新增 + 再次 setStatus upsert', () => {
  const repo = new AgentStatusRepo();
  repo.setStatus('a1', 'busy', 't1');
  let all = repo.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].status, 'busy');
  assert.equal(all[0].currentTaskId, 't1');

  // 再次调用应覆盖
  repo.setStatus('a1', 'idle');
  all = repo.getAll();
  assert.equal(all.length, 1, 'upsert 不应新增');
  assert.equal(all[0].status, 'idle');
  assert.equal(all[0].currentTaskId, undefined, '省略 currentTaskId 应清空');
});

test('AgentStatusRepo.getAll 多个 agent', () => {
  const repo = new AgentStatusRepo();
  repo.setStatus('a1', 'idle');
  repo.setStatus('a2', 'busy', 't1');
  repo.setStatus('a3', 'offline');
  const all = repo.getAll();
  assert.equal(all.length, 3);
  const byId = Object.fromEntries(all.map((a) => [a.agentId, a]));
  assert.equal(byId.a1.status, 'idle');
  assert.equal(byId.a2.status, 'busy');
  assert.equal(byId.a3.status, 'offline');
});
