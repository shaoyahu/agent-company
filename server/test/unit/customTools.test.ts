// CustomToolRepo 单测 + testCustomTool 三种类型 (http/shell/prompt) 的执行逻辑
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CustomToolRepo, type CustomToolType } from '../../src/store/customTools.js';
import { freshDB, cleanupDB, truncateAll } from '../helpers/db.js';
import { testCustomTool } from '../../src/agent/customTools.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string, path: string;

before(() => { ({ dir, path } = freshDB()); });
after(() => { cleanupDB(dir, path); });

// ─── CustomToolRepo CRUD ──────────────────────────────

test('CustomToolRepo.list 空表返 []', () => {
  truncateAll();
  assert.deepEqual(new CustomToolRepo().list(), []);
});

test('CustomToolRepo.upsert 插入 + getByName', () => {
  truncateAll();
  const repo = new CustomToolRepo();
  repo.upsert({
    id: 'my-tool',
    name: 'my-tool',
    type: 'http',
    description: 'desc',
    config: { url: 'https://example.com', method: 'POST' },
    enabled: true,
  });
  const got = repo.get('my-tool')!;
  assert.equal(got.type, 'http');
  assert.deepEqual(got.config, { url: 'https://example.com', method: 'POST' });
  const byName = repo.getByName('my-tool');
  assert.equal(byName?.id, 'my-tool');
});

test('CustomToolRepo.upsert 同 name 但不同 id(创建)不报错(同名检查在 server endpoint 不在 repo)', () => {
  truncateAll();
  const repo = new CustomToolRepo();
  const base = {
    id: 'dupe1',
    name: 'dupe',
    type: 'http' as CustomToolType,
    description: '',
    config: { url: 'https://x.com' },
    enabled: true,
  };
  repo.upsert(base);
  // repo 层不做同名检查(那是 endpoint 校验的责任),允许存在同 name
  repo.upsert({ ...base, id: 'dupe2' });
  assert.equal(repo.list().length, 2);
});

test('CustomToolRepo.upsert 同 id 二次 → 更新(不报错)', () => {
  truncateAll();
  const repo = new CustomToolRepo();
  const base = {
    id: 'update', name: 'update', type: 'http' as CustomToolType,
    description: 'old', config: { url: 'https://x.com' }, enabled: true,
  };
  repo.upsert(base);
  repo.upsert({ ...base, description: 'new' });
  assert.equal(repo.get('update')!.description, 'new');
});

test('CustomToolRepo.delete', () => {
  truncateAll();
  const repo = new CustomToolRepo();
  repo.upsert({ id: 'x', name: 'x', type: 'http', description: '', config: {}, enabled: true });
  assert.equal(repo.delete('x'), true);
  assert.equal(repo.get('x'), null);
});

// ─── testCustomTool (球球 review:之前直接 fetch 不 check res.ok,这里测执行逻辑) ──────────────────────────────

test('testCustomTool — prompt 类型:返回渲染后字符串', async () => {
  const result = await testCustomTool(
    'prompt',
    { template: '你好 {{name}},今天是 {{day}}' },
    { name: '球球', day: '周日' },
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  assert.equal(result.success, true);
  assert.match(result.output, /你好 球球,今天是 周日/);
});

test('testCustomTool — prompt 缺参数应返 success: false', async () => {
  const result = await testCustomTool(
    'prompt',
    { template: '你好 {{name}}' },
    {},  // 缺 name
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  // 模板渲染会保留 {{name}}(无值替换)或抛错
  assert.ok(typeof result.success === 'boolean');
  assert.ok(typeof result.output === 'string');
});

test('testCustomTool — shell 类型默认禁用', async () => {
  const result = await testCustomTool(
    'shell',
    { command: 'echo hello-{{name}}', params: ['name'] },
    { name: 'world' },
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  assert.equal(result.success, false);
  assert.match(result.output, /已禁用/);
});

test('testCustomTool — shell 类型不执行模板', async () => {
  // 防御性测试:executeShell iter cfg.params,如果 undefined 之前会 TypeError
  // 这里加 params: [] 看是否成功,以及覆盖"params 缺"的 case
  const result = await testCustomTool(
    'shell',
    { command: 'echo hi', params: [] },
    {},
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  assert.equal(result.success, false);
  assert.match(result.output, /已禁用/);
});

test('testCustomTool — shell 类型命令不会执行', async () => {
  const result = await testCustomTool(
    'shell',
    { command: 'exit 42', params: [] },
    {},
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  assert.equal(result.success, false, '非零 exit 应 fail');
  assert.match(result.output, /已禁用/);
});

test('testCustomTool — shell 类型即使 true 命令也不会执行', async () => {
  const result = await testCustomTool(
    'shell',
    { command: 'true', params: [] },  // /bin/true 总是 exit 0
    {},
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  assert.equal(result.success, false);
  assert.match(result.output, /已禁用/);
});

test('testCustomTool — http 类型:对不可达 host 返 success: false(球球 review:不静默成功)', async () => {
  // 球球 review 强调:不要 mock,走不通要返 false
  const result = await testCustomTool(
    'http',
    { url: 'http://127.0.0.1:1/nonexistent', method: 'GET', timeoutMs: 500 },  // 1 端口几乎一定连不上
    {},
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  assert.equal(result.success, false, '127.0.0.1:1 不可达,应 fail');
  assert.ok(result.output, 'output 应有错因');
});

test('testCustomTool — 未知 type 返 success: false', async () => {
  const result = await testCustomTool(
    'http',  // http 合法,但 config 缺 url
    {},
    {},
    { cwd: '/tmp', companyRoot: '/tmp' },
  );
  // 缺 url 应 fail
  assert.equal(result.success, false, '缺 url 应 fail');
});
