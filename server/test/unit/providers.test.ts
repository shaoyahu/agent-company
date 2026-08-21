// ProviderRepo 单测 — CRUD + 边界 + 不依赖 server fixture
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRepo, type StoredProvider } from '../../src/store/providers.js';
import { freshDB, cleanupDB, truncateAll } from '../helpers/db.js';

let dir: string, path: string;

before(() => { ({ dir, path } = freshDB()); });
after(() => { cleanupDB(dir, path); });

before(() => truncateAll());
// 注意:beforeEach 顺序 — node:test 中多个 before 会按注册顺序跑
// 用单独的 before + 在每个 test 里 truncate 简单些

function make(id: string, over: Partial<StoredProvider> = {}): StoredProvider {
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

test('ProviderRepo.list 空表返 []', () => {
  truncateAll();
  assert.deepEqual(new ProviderRepo().list(), []);
});

test('ProviderRepo.upsert 插入新 provider,get 拿得到', () => {
  truncateAll();
  const repo = new ProviderRepo();
  repo.upsert(make('a'));
  const got = repo.get('a')!;
  assert.equal(got.id, 'a');
  assert.equal(got.model, 'claude-test');
  assert.equal(got.enabled, true);
});

test('ProviderRepo.upsert 同一 id 二次 → 更新(不新建)', () => {
  truncateAll();
  const repo = new ProviderRepo();
  repo.upsert(make('a', { model: 'old-model' }));
  repo.upsert(make('a', { model: 'new-model' }));
  const all = repo.list();
  assert.equal(all.length, 1, '同 id 二次 upsert 不应新增');
  assert.equal(all[0].model, 'new-model');
});

test('ProviderRepo.get 不存在的 id 返 null', () => {
  truncateAll();
  assert.equal(new ProviderRepo().get('nope'), null);
});

test('ProviderRepo.delete 返 true/false', () => {
  truncateAll();
  const repo = new ProviderRepo();
  repo.upsert(make('a'));
  assert.equal(repo.delete('a'), true);
  assert.equal(repo.get('a'), null);
  assert.equal(repo.delete('nope'), false);
});

test('ProviderRepo.setEnabled 切换 enabled', () => {
  truncateAll();
  const repo = new ProviderRepo();
  repo.upsert(make('a'));
  repo.setEnabled('a', false);
  assert.equal(repo.get('a')!.enabled, false);
  repo.setEnabled('a', true);
  assert.equal(repo.get('a')!.enabled, true);
});

test('ProviderRepo.upsert 边界:apiKey 空字符串仍能存(server 端会拒,但 repo 层不校验)', () => {
  truncateAll();
  const repo = new ProviderRepo();
  // repo 层只管存,校验在 endpoint — 不在这里测
  repo.upsert(make('empty', { apiKey: '' }));
  assert.equal(repo.get('empty')!.apiKey, '');
});

test('ProviderRepo.upsert 不带 endpoint 也能存(undefined)', () => {
  truncateAll();
  const repo = new ProviderRepo();
  repo.upsert({ ...make('no-ep'), endpoint: undefined });
  const got = repo.get('no-ep')!;
  assert.equal(got.endpoint, undefined);
});
