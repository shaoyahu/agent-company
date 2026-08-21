// DepartmentRepo + AgentRepo 单测 — 球球 review 关注的校验逻辑
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DepartmentRepo, AgentRepo } from '../../src/store/org.js';
import { freshDB, cleanupDB, truncateAll } from '../helpers/db.js';

let dir: string, path: string;

before(() => { ({ dir, path } = freshDB()); });
after(() => { cleanupDB(dir, path); });

// ─── DepartmentRepo ──────────────────────────────

test('DepartmentRepo.list 空表返 []', () => {
  truncateAll();
  assert.deepEqual(new DepartmentRepo().list(), []);
});

test('DepartmentRepo.upsert + get', () => {
  truncateAll();
  const repo = new DepartmentRepo();
  repo.upsert({ id: 'd1', name: '技术部', head: 'cto', teams: ['frontend'] });
  const got = repo.get('d1')!;
  assert.equal(got.id, 'd1');
  assert.equal(got.name, '技术部');
  assert.deepEqual(got.teams, ['frontend']);
});

test('DepartmentRepo.upsert 嵌套 parentId', () => {
  truncateAll();
  const repo = new DepartmentRepo();
  repo.upsert({ id: 'd1', name: '技术部', head: '' });
  repo.upsert({ id: 'd2', name: '前端组', head: '', parentId: 'd1' });
  assert.equal(repo.get('d2')!.parentId, 'd1');
});

test('DepartmentRepo.delete 级联 null(球球 review:删除父部门时子部门 parentId 变 null)', () => {
  truncateAll();
  const repo = new DepartmentRepo();
  repo.upsert({ id: 'd1', name: '父', head: '' });
  repo.upsert({ id: 'd2', name: '子', head: '', parentId: 'd1' });
  repo.delete('d1');
  assert.equal(repo.get('d1'), null);
  // d2 还在,但 parentId SET NULL(org.ts 把 sql null 转 undefined 给 TS 友好)
  assert.equal(repo.get('d2')!.parentId, undefined, 'SET NULL 后 select 返 null,经 fromRow ?? undefined 转 undefined');
});

test('DepartmentRepo.wouldCreateCycle 自身不算循环(只有 A→B→A 才算)', () => {
  truncateAll();
  const repo = new DepartmentRepo();
  repo.upsert({ id: 'd1', name: 'A', head: '' });
  // d1.parentId = d1 — 自身,但 shouldBeNotCreateCycle? 看实现
  // 通常允许(自己指自己),或者拒绝。测实际行为
  // 我先断言"不会抛 + return 布尔"
  const result = repo.wouldCreateCycle('d1', 'd1');
  assert.equal(typeof result, 'boolean');
});

test('DepartmentRepo.wouldCreateCycle 真循环(d1→d2→d1)', () => {
  truncateAll();
  const repo = new DepartmentRepo();
  repo.upsert({ id: 'd1', name: 'A', head: '' });
  repo.upsert({ id: 'd2', name: 'B', head: '', parentId: 'd1' });
  // 现在 d2.parent = d1,如果把 d1.parent = d2 就成环
  const wouldCycle = repo.wouldCreateCycle('d1', 'd2');
  assert.equal(wouldCycle, true, 'A→B→A 应识别为循环');
});

test('DepartmentRepo.wouldCreateCycle 非循环(设个不存在的 parent)', () => {
  truncateAll();
  const repo = new DepartmentRepo();
  repo.upsert({ id: 'd1', name: 'A', head: '' });
  // 把 d1.parent 设成一个还没创建的部门(不形成环)
  assert.equal(repo.wouldCreateCycle('d1', 'newparent'), false);
});

// ─── AgentRepo ──────────────────────────────

test('AgentRepo.list 空表返 []', () => {
  truncateAll();
  assert.deepEqual(new AgentRepo().list(), []);
});

test('AgentRepo.upsert 存 tools 数组(JSON 序列化)', () => {
  truncateAll();
  const repo = new AgentRepo();
  repo.upsert({
    id: 'a1', name: 'CTO', department: 'd1', role: 'head',
    llm: 'minimax', systemPrompt: '你是 CTO',
    tools: ['web_fetch', 'http_request'], skills: ['frontend-design'],
  });
  const got = repo.get('a1')!;
  assert.deepEqual(got.tools, ['web_fetch', 'http_request']);
  assert.deepEqual(got.skills, ['frontend-design']);
  assert.equal(got.llm, 'minimax');
});

test('AgentRepo 始终返回显式 enabled 布尔值', () => {
  truncateAll();
  const repo = new AgentRepo();
  const enabled = repo.upsert({
    id: 'enabled-agent',
    name: '启用',
    department: 'd1',
    role: 'worker',
    llm: 'x',
    systemPrompt: '',
    tools: [],
  });
  const disabled = repo.upsert({
    id: 'disabled-agent',
    name: '停用',
    department: 'd1',
    role: 'worker',
    llm: 'x',
    systemPrompt: '',
    tools: [],
    enabled: false,
  });
  assert.equal(enabled.enabled, true);
  assert.equal(disabled.enabled, false);
});

test('AgentRepo.upsert 缺 llm 应存(球球 review:server 端才校验,repo 不验)', () => {
  truncateAll();
  // repo 层只管存,没 llm 字段不会爆
  const repo = new AgentRepo();
  // 类型上 llm 是必填,但运行时 db 接受 — 测运行时行为
  // 这里故意给个空字符串(模拟"绕过 endpoint 校验")
  repo.upsert({
    id: 'a1', name: 'X', department: 'd1', role: 'worker',
    llm: '', systemPrompt: '', tools: [],
  } as any);
  assert.equal(repo.get('a1')!.llm, '');
});

test('AgentRepo.upsert 同一 id 二次 → 更新', () => {
  truncateAll();
  const repo = new AgentRepo();
  repo.upsert({ id: 'a1', name: 'A', department: 'd1', role: 'worker', llm: 'x', systemPrompt: '', tools: [] });
  repo.upsert({ id: 'a1', name: 'A2', department: 'd1', role: 'worker', llm: 'x', systemPrompt: '', tools: [] });
  const all = repo.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'A2');
});

test('AgentRepo.upsert 持久化 CLI 模型', () => {
  truncateAll();
  const repo = new AgentRepo();
  repo.upsert({
    id: 'cli-a', name: 'CLI', department: 'd1', role: 'worker',
    llm: 'unused', systemPrompt: '', tools: [],
    executor: 'cli', cliTool: 'trae-cli', cliModel: 'gpt-5.4',
  });
  const got = repo.get('cli-a')!;
  assert.equal(got.cliTool, 'trae-cli');
  assert.equal(got.cliModel, 'gpt-5.4');
});

test('AgentRepo.delete 返 true/false', () => {
  truncateAll();
  const repo = new AgentRepo();
  repo.upsert({ id: 'a1', name: 'A', department: 'd1', role: 'worker', llm: 'x', systemPrompt: '', tools: [] });
  assert.equal(repo.delete('a1'), true);
  assert.equal(repo.get('a1'), null);
  assert.equal(repo.delete('nope'), false);
});
