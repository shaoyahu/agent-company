/**
 * config-merge.ts 单测:ConfigService 走 db
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDB, closeDB } from '../../src/store/db.js';
import { ConfigService } from '../../src/store/config-merge.js';
import { ProviderRepo } from '../../src/store/providers.js';
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
  const db = getDB();
  for (const t of ['agents', 'departments', 'llm_providers']) {
    db.exec(`DELETE FROM ${t}`);
  }
});

test('ConfigService.departments 返空列表当无数据', () => {
  const svc = new ConfigService();
  assert.deepEqual(svc.departments(), []);
});

test('ConfigService.agents 返空列表当无数据', () => {
  const svc = new ConfigService();
  assert.deepEqual(svc.agents(), []);
});

test('ConfigService.llmProviders 返空列表当无数据', () => {
  const svc = new ConfigService();
  assert.deepEqual(svc.llmProviders(), []);
});

test('ConfigService.merged 返固定 boss/name 字段', () => {
  const svc = new ConfigService();
  const merged = svc.merged();
  assert.equal(merged.boss, '球球');
  assert.equal(merged.name, '球球的 AI 公司');
  assert.equal(merged.description, '完全 Web 化配置');
});

test('ConfigService.departments 返 db 实际数据', () => {
  const db = getDB();
  const now = Date.now();
  db.prepare(
    `INSERT INTO departments (id, name, head, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('d1', '研发', 'a1', now, now);

  const svc = new ConfigService();
  const list = svc.departments();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'd1');
  assert.equal(list[0].name, '研发');
  assert.equal(list[0].head, 'a1');
});

test('ConfigService.llmProviders 字段映射正确', () => {
  const repo = new ProviderRepo();
  const now = Date.now();
  repo.upsert({
    id: 'p1',
    type: 'anthropic',
    apiKey: 'sk-test',
    endpoint: 'https://api.example.com/v1',
    model: 'claude-test',
    maxTokens: 8192,
    temperature: 0.7,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const svc = new ConfigService();
  const list = svc.llmProviders();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'p1');
  assert.equal(list[0].model, 'claude-test');
  assert.equal(list[0].apiKey, 'sk-test');

  // merged() 里 llm_providers 字段映射
  const merged = svc.merged();
  assert.equal(merged.llm_providers.length, 1);
  assert.equal(merged.llm_providers[0].id, 'p1');
  assert.equal(merged.llm_providers[0].model, 'claude-test');
  assert.equal(merged.llm_providers[0].apiKey, 'sk-test');
  assert.equal(merged.llm_providers[0].maxTokens, 8192);
  assert.equal(merged.llm_providers[0].temperature, 0.7);
});

test('ConfigService.merged 完整组合三个 repo', () => {
  const db = getDB();
  const now = Date.now();
  db.prepare(
    `INSERT INTO departments (id, name, head, created_at, updated_at) VALUES ('d1', '研发', 'a1', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO agents (id, department, role, llm, system_prompt, tools, created_at, updated_at)
     VALUES ('a1', 'd1', 'head', 'p1', '你是头', '[]', ?, ?)`,
  ).run(now, now);
  const provRepo = new ProviderRepo();
  provRepo.upsert({
    id: 'p1',
    type: 'anthropic',
    apiKey: '',
    endpoint: '',
    model: 'claude',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const merged = new ConfigService().merged();
  assert.equal(merged.departments.length, 1);
  assert.equal(merged.agents.length, 1);
  assert.equal(merged.llm_providers.length, 1);
  assert.equal(merged.agents[0].id, 'a1');
  assert.equal(merged.departments[0].name, '研发');
});

test('ConfigService.reload 重新读取 SQLite 配置', () => {
  const service = new ConfigService();
  const db = getDB();
  db.prepare(
    `INSERT INTO departments (id, name, head, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('reload-dept', '刷新部门', 'boss', 1, 1);

  service.reload();
  assert.equal(service.departments().some((dept) => dept.id === 'reload-dept'), true);
});
