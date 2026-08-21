// 球球 review 2026-08-15:LLMRegistry 的 list() model 不再 'unknown'(之前 (p as any).model 永远 undefined)
// + yaml / db 优先级 + enabled=false 跳过
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LLMRegistry, type ProviderConfig } from '../../src/llm/registry.js';
import type { StoredProvider } from '../../src/store/providers.js';

// 球球 review 2026-08-15:apiKey 不能为空(registry.addWithSource 显式抛错)
// 用真实测试 key 满足校验,但 addWithSource 会写到 process.env
// 测试用唯一 provider id,加 afterEach 清理 env
const envKeysToCleanup: string[] = [];

function makeYamlCfg(over: Partial<ProviderConfig> = {}): ProviderConfig {
  const id = over.id ?? 'test-yaml-' + Math.random().toString(36).slice(2, 8);
  const envName = `PI_LLM_API_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  envKeysToCleanup.push(envName);
  return {
    id,
    type: 'anthropic',
    apiKey: 'test-key-' + id,
    endpoint: 'https://api.example.com/v1/messages',
    model: 'claude-test',
    source: 'yaml',
    enabled: true,
    ...over,
  };
}

function makeDbProvider(over: Partial<StoredProvider> = {}): StoredProvider {
  const id = over.id ?? 'test-db-' + Math.random().toString(36).slice(2, 8);
  const envName = `PI_LLM_API_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  envKeysToCleanup.push(envName);
  return {
    id,
    type: 'anthropic',
    apiKey: 'test-key-' + id,
    endpoint: 'https://api.example.com/v1/messages',
    model: 'claude-test',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  };
}

afterEach(() => {
  // 清理测试期间写入的 PI_LLM_API_KEY_* env vars
  for (const k of envKeysToCleanup) {
    delete process.env[k];
  }
  envKeysToCleanup.length = 0;
});

// ─── list() 基础行为 ──────────────────────────────

test('LLMRegistry — init 空配置,list() 应返空数组', () => {
  const r = new LLMRegistry();
  r.init([], []);
  assert.equal(r.list().length, 0);
  assert.equal(r.size(), 0);
});

test('LLMRegistry — init 一个 yaml provider,list() 应返 1 个', () => {
  const r = new LLMRegistry();
  r.init([makeYamlCfg({ id: 'a' })], []);
  const list = r.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a');
  assert.equal(list[0].source, 'yaml');
  assert.equal(list[0].enabled, true);
});

test('LLMRegistry — list() 应包含真实 model(球球 review 2026-08-15 bug)', () => {
  // 之前 (p as any).model 永远 undefined → 'unknown'
  // 现在 model 存到 metadata,list() 从 metadata 读
  const r = new LLMRegistry();
  r.init([makeYamlCfg({ id: 'a', model: 'claude-haiku-4-5' })], []);
  const list = r.list();
  assert.equal(list[0].model, 'claude-haiku-4-5', 'model 不应是 "unknown"');
  assert.notEqual(list[0].model, 'unknown');
});

test('LLMRegistry — type 字段也走 metadata(球球 review 同步修的)', () => {
  const r = new LLMRegistry();
  r.init([makeYamlCfg({ id: 'a', type: 'openai', model: 'gpt-4o' })], []);
  const list = r.list();
  assert.equal(list[0].type, 'openai');
});

// ─── source 优先级 ──────────────────────────────

test('LLMRegistry — db provider 覆盖 yaml 同 id(球球 review:db 优先级高)', () => {
  const r = new LLMRegistry();
  const yaml = makeYamlCfg({ id: 'same', model: 'yaml-model' });
  const db = makeDbProvider({ id: 'same', model: 'db-model' });
  r.init([yaml], [db]);
  const list = r.list();
  // db 应该在 yaml 之后 add(覆盖) — 但 list() 只能有 1 个(同 id 覆盖)
  const found = list.find(p => p.id === 'same')!;
  assert.ok(found, '应能找到 same');
  assert.equal(found.model, 'db-model', 'db 覆盖 yaml model');
  assert.equal(found.source, 'db');
  // 验证 size:覆盖了同一个 id,总数量 1
  assert.equal(r.size(), 1, '覆盖同 id 后总数仍是 1');
});

test('LLMRegistry — 多个 provider 不同 id 都列出', () => {
  const r = new LLMRegistry();
  r.init([makeYamlCfg({ id: 'a' }), makeYamlCfg({ id: 'b' }), makeYamlCfg({ id: 'c' })], []);
  assert.equal(r.list().length, 3);
});

// ─── enabled 过滤 ──────────────────────────────

test('LLMRegistry — enabled: false 的 provider 被跳过', () => {
  const r = new LLMRegistry();
  r.init([makeYamlCfg({ id: 'a' }), makeYamlCfg({ id: 'b', enabled: false })], []);
  const list = r.list();
  assert.equal(list.length, 1, 'disabled 的不列出');
  assert.equal(list[0].id, 'a');
});

test('LLMRegistry — db provider enabled: false 也跳过', () => {
  const r = new LLMRegistry();
  r.init([], [makeDbProvider({ id: 'a', enabled: false })]);
  assert.equal(r.list().length, 0);
});

test('LLMRegistry — 已启用 Provider 更新为禁用时同步删除 provider 和 metadata', () => {
  const r = new LLMRegistry();
  r.init([
    makeYamlCfg({ id: 'target' }),
    makeYamlCfg({ id: 'untouched' }),
  ], []);

  r.add(makeYamlCfg({ id: 'target', enabled: false }));

  assert.equal(r.get('target'), undefined);
  assert.equal(r.list().some((provider) => provider.id === 'target'), false);
  assert.equal((r as any).metadata.has('target'), false);
  assert.ok(r.get('untouched'));
  assert.equal(r.list().some((provider) => provider.id === 'untouched'), true);
});

test('LLMRegistry — 禁用的 db Provider 覆盖同 ID yaml 且不影响其他来源', () => {
  const r = new LLMRegistry();
  r.init(
    [
      makeYamlCfg({ id: 'same', model: 'yaml-model' }),
      makeYamlCfg({ id: 'yaml-only' }),
    ],
    [makeDbProvider({ id: 'same', enabled: false })],
  );

  assert.equal(r.get('same'), undefined);
  assert.equal(r.list().some((provider) => provider.id === 'same'), false);
  assert.equal((r as any).metadata.has('same'), false);
  assert.equal(r.list().find((provider) => provider.id === 'yaml-only')?.source, 'yaml');
});

// ─── get / add / remove ──────────────────────────────

test('LLMRegistry — get(id) 返 provider,未找到返 undefined', () => {
  const r = new LLMRegistry();
  r.init([makeYamlCfg({ id: 'a' })], []);
  assert.ok(r.get('a'));
  assert.equal(r.get('nope'), undefined);
});

test('LLMRegistry — add() 动态加 provider,list 立即看到', () => {
  const r = new LLMRegistry();
  r.init([], []);
  const cfg = makeYamlCfg({ id: 'new' });
  r.add(cfg);
  assert.equal(r.list().length, 1);
  assert.equal(r.get('new')?.type, 'anthropic');
});

test('LLMRegistry — remove(id) 移除 provider', () => {
  const r = new LLMRegistry();
  r.init([makeYamlCfg({ id: 'a' })], []);
  assert.equal(r.size(), 1);
  assert.equal(r.remove('a'), true);
  assert.equal(r.size(), 0);
  assert.equal(r.remove('nonexistent'), false);
});

// ─── apiKey 必填校验(球球 review "完全不要 mock") ──────────────────────────────

test('LLMRegistry — apiKey 为空 抛错(不静默通过)', () => {
  const r = new LLMRegistry();
  // env var 也没设
  delete process.env['PI_LLM_API_KEY_NOKEY'];
  assert.throws(
    () => r.init([{ id: 'nokey', type: 'anthropic', apiKey: '', model: 'x', source: 'yaml' }], []),
    /apiKey 为空/,
  );
});
