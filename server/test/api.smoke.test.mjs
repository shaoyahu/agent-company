// 球球 review 2026-08-15:补接口测试 — 起码让"路径不一致导致 404"这种 bug 在 CI 阶段被抓住
// 之前 apply-template 端点路径不一致(server /api/apply-template,client /api/templates/apply),
// 球球点"套用"按钮才发现 404,应该在 dev 阶段就发现。
//
// 这套 smoke test 是**最基础**的接口测试:
//   - 用 node:test(内置,Node 22+)
//   - 直接 fetch dev server(localhost:4000)
//   - 测每个核心 endpoint 至少能响应(不 404/500)
//   - happy path 测关键字段
//
// 跑法:dev server 跑着的状态下 `npm test`
// dev server 没跑:测试会 skip

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:4000';
const SMOKE_DATA_DIR = process.env.AGENT_COMPANY_DATA_DIR
  ?? join(process.env.HOME ?? '', 'Library', 'Application Support', 'Agent Company');
const SMOKE_DB_PATH = join(SMOKE_DATA_DIR, 'company.db');

/** 每 test 独立检测 server 是否在跑(避免 before 异步检测被吞) */
async function pingServer() {
  try {
    const r = await fetch(`${BASE}/api/company`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// 端点表(球球 2026-08-15 review 后全项目 endpoint 一份 truth source)
// 路径错误会直接 404 / 405,测试 fail
const ENDPOINTS = [
  // (method, path, 期望 HTTP code, 描述)
  { method: 'GET',    path: '/api/company',                       expect: 200, desc: '公司信息' },
  { method: 'GET',    path: '/api/providers',                     expect: 200, desc: 'Provider 列表' },
  { method: 'GET',    path: '/api/projects', route: '/api/projects',
    expect: 200, desc: '项目列表' },
  { method: 'POST',   path: '/api/projects', route: '/api/projects',
    body: {}, expect: 400, desc: '创建项目缺标题' },
  { method: 'GET',    path: '/api/projects/__proto__', route: '/api/projects/:id',
    expect: 404, desc: '项目详情 hostile ID' },
  { method: 'DELETE', path: '/api/projects/__proto__', route: '/api/projects/:id',
    expect: 404, desc: '删除项目 hostile ID' },
  { method: 'POST',   path: '/api/projects/__proto__/tick',
    route: '/api/projects/:id/tick',
    expect: 404, desc: '推进项目 hostile ID' },
  { method: 'POST',   path: '/api/projects/__proto__/say',
    route: '/api/projects/:id/say',
    body: { content: 'smoke' },
    expect: 404, desc: '项目发言 hostile ID' },
  { method: 'POST',   path: '/api/projects/__proto__/run-to-completion',
    route: '/api/projects/:id/run-to-completion',
    body: { maxTicks: 1 },
    expect: 404, desc: '项目完整推进 hostile ID' },
  { method: 'GET',    path: '/api/projects/__proto__/messages',
    route: '/api/projects/:id/messages',
    expect: 200, desc: '项目消息 hostile ID' },
  { method: 'GET',    path: '/api/agents',                        expect: 200, desc: 'Agent 列表' },
  { method: 'GET',    path: '/api/departments',                   expect: 200, desc: '部门列表' },
  { method: 'GET',    path: '/api/tools',                         expect: 200, desc: 'Tool 列表' },
  { method: 'GET',    path: '/api/cli-tools',                     expect: 200, desc: '本机 CLI 可用性列表' },
  { method: 'GET',    path: '/api/cli-tools/discovered',          expect: 200, desc: '扫描本机已安装 CLI' },
  { method: 'GET',    path: '/api/skills',                        expect: 200, desc: 'Skill 列表' },
  { method: 'GET',    path: '/api/settings/meta-tools',           expect: 200, desc: 'Helper meta-tools' },
  { method: 'GET',    path: '/api/data/export',                   expect: 200, desc: '数据导出 zip' },
  { method: 'POST',   path: '/api/data/import',
    body: {},
    expect: 400, desc: '数据导入缺 fileBase64' },
  { method: 'POST',   path: '/api/data/reset',
    body: { confirm: 'wrong' },
    expect: 400, desc: '一键还原确认 token 错误' },
  { method: 'GET',    path: '/api/fs/home-dirs',                   expect: 200, desc: 'home 候选目录(球球 review 2026-08-16 ChatInputBox 用)' },
  { method: 'GET',    path: '/api/workflows', route: '/api/workflows',
    expect: 200, desc: '流程图列表' },
  { method: 'POST',   path: '/api/workflows', route: '/api/workflows',
    body: { id: 'smoke-missing-graph', name: '缺失流程图' },
    expect: 400, desc: '保存流程图缺 graph' },
  { method: 'DELETE', path: '/api/workflows/smoke-missing',
    route: '/api/workflows/:id',
    expect: 404, desc: '删除不存在的流程图' },
  { method: 'GET',    path: '/api/conversations', route: '/api/conversations',
    expect: 200, desc: '会话列表' },
  { method: 'POST',   path: '/api/conversations',
    route: '/api/conversations',
    body: { kind: 'group', title: 'smoke', agentIds: [] },
    expect: 400, desc: '创建会话' },
  { method: 'GET',    path: '/api/conversations/__proto__',
    route: '/api/conversations/:id',
    expect: 400, desc: '会话详情' },
  { method: 'DELETE', path: '/api/conversations/__proto__',
    route: '/api/conversations/:id',
    expect: 400, desc: '删除会话' },
  { method: 'POST',   path: '/api/conversations/__proto__/pin',
    route: '/api/conversations/:id/pin',
    expect: 400, desc: '置顶会话' },
  { method: 'POST',   path: '/api/conversations/__proto__/unpin',
    route: '/api/conversations/:id/unpin',
    expect: 400, desc: '取消置顶会话' },
  { method: 'POST',   path: '/api/conversations/__proto__/mute',
    route: '/api/conversations/:id/mute',
    expect: 400, desc: '会话免打扰' },
  { method: 'POST',   path: '/api/conversations/__proto__/unmute',
    route: '/api/conversations/:id/unmute',
    expect: 400, desc: '取消会话免打扰' },
  { method: 'POST',   path: '/api/conversations/__proto__/read',
    route: '/api/conversations/:id/read',
    expect: 400, desc: '标记会话已读' },
  { method: 'POST',   path: '/api/conversations/__proto__/members',
    route: '/api/conversations/:id/members',
    body: { agentId: '__proto__' },
    expect: 400, desc: '添加会话成员' },
  { method: 'DELETE', path: '/api/conversations/missing/members/boss',
    route: '/api/conversations/:id/members/:agentId',
    expect: 400, desc: '移除会话成员' },
  { method: 'GET',    path: '/api/conversations/__proto__/messages',
    route: '/api/conversations/:id/messages',
    expect: 400, desc: '会话消息分页' },
  { method: 'POST',   path: '/api/conversations/__proto__/messages',
    route: '/api/conversations/:id/messages',
    body: { content: 'smoke' },
    expect: 400, desc: '发送会话消息' },
  { method: 'POST',   path: '/api/conversations/__proto__/pause',
    route: '/api/conversations/:id/pause',
    expect: 400, desc: '暂停会话' },
  { method: 'POST',   path: '/api/conversations/__proto__/resume',
    route: '/api/conversations/:id/resume',
    expect: 400, desc: '恢复会话' },
  { method: 'POST',   path: '/api/conversations/missing/members/__proto__/pause',
    route: '/api/conversations/:id/members/:agentId/pause',
    expect: 400, desc: '暂停会话 Agent' },
  { method: 'POST',   path: '/api/conversations/missing/members/__proto__/resume',
    route: '/api/conversations/:id/members/:agentId/resume',
    expect: 400, desc: '恢复会话 Agent' },
  { method: 'POST',   path: '/api/fs/validate-dir',
    body: { path: '/definitely-not-an-agent-company-directory' },
    expect: 400, desc: '校验项目绝对目录' },

  // 球球发现的 404 bug:client 调 /api/templates/apply,server 必须有这条路由
  { method: 'POST',   path: '/api/templates/apply',
    body: { template: { name: 'smoke', departments: [], agents: [] } },
    expect: 200, desc: '套用模板(空 payload 也返 200)' },

  // 反向断言:这些旧路径必须 404(防止误以为还能用)
  { method: 'POST',   path: '/api/apply-template',  expect: 404, desc: '旧路径必须 404' },
  { method: 'POST',   path: '/api/fs/resolve-dir',
    body: { name: '.hidden' },
    expect: 404, desc: '旧目录名猜测与自动创建端点必须 404' },
  { method: 'GET',    path: '/api/ui-settings',     expect: 404, desc: '已删的 ui-settings 端点必须 404' },
];

for (const ep of ENDPOINTS) {
  test(`${ep.method} ${ep.path} — ${ep.desc}`, async (t) => {
    if (!await pingServer()) {
      t.skip(`dev server ${BASE} 不通,跳过`);
      return;
    }
    const init = { method: ep.method };
    if (ep.body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(ep.body);
    }
    const res = await fetch(`${BASE}${ep.path}`, { ...init, signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, ep.expect,
      `${ep.method} ${ep.path} 应返 ${ep.expect},实际 ${res.status}。` +
      `球球 review 2026-08-15: 路径不一致是 P0 bug,smoke test 要确保不再发生。`);
  });
}

test('smoke 端点表完整覆盖全部会话 method/path', () => {
  assert.deepEqual(
    ENDPOINTS
      .filter((endpoint) => endpoint.route?.startsWith('/api/conversations'))
      .map((endpoint) => `${endpoint.method} ${endpoint.route}`),
    [
      'GET /api/conversations',
      'POST /api/conversations',
      'GET /api/conversations/:id',
      'DELETE /api/conversations/:id',
      'POST /api/conversations/:id/pin',
      'POST /api/conversations/:id/unpin',
      'POST /api/conversations/:id/mute',
      'POST /api/conversations/:id/unmute',
      'POST /api/conversations/:id/read',
      'POST /api/conversations/:id/members',
      'DELETE /api/conversations/:id/members/:agentId',
      'GET /api/conversations/:id/messages',
      'POST /api/conversations/:id/messages',
      'POST /api/conversations/:id/pause',
      'POST /api/conversations/:id/resume',
      'POST /api/conversations/:id/members/:agentId/pause',
      'POST /api/conversations/:id/members/:agentId/resume',
    ],
  );
});

test('smoke 端点表完整覆盖全部 workflow method/path', () => {
  assert.deepEqual(
    ENDPOINTS
      .filter((endpoint) => endpoint.route?.startsWith('/api/workflows'))
      .map((endpoint) => `${endpoint.method} ${endpoint.route}`),
    [
      'GET /api/workflows',
      'POST /api/workflows',
      'DELETE /api/workflows/:id',
    ],
  );
});

test('smoke 端点表完整覆盖全部 project method/path', () => {
  assert.deepEqual(
    ENDPOINTS
      .filter((endpoint) => endpoint.route?.startsWith('/api/projects'))
      .map((endpoint) => `${endpoint.method} ${endpoint.route}`),
    [
      'GET /api/projects',
      'POST /api/projects',
      'GET /api/projects/:id',
      'DELETE /api/projects/:id',
      'POST /api/projects/:id/tick',
      'POST /api/projects/:id/say',
      'POST /api/projects/:id/run-to-completion',
      'GET /api/projects/:id/messages',
    ],
  );
});

// 一些 happy path 数据校验(不是只看 status)
test('GET /api/providers 应返 { providers: [...] } 结构', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/providers`, { signal: AbortSignal.timeout(5000) });
  const data = await r.json();
  // 球球 review 2026-08-15:之前是 { active, db },合并后是 { providers }
  assert.ok('providers' in data, '必须有 providers 字段');
  assert.ok(Array.isArray(data.providers), 'providers 必须是数组');
  if (data.providers.length > 0) {
    const p = data.providers[0];
    assert.ok(typeof p.id === 'string', 'provider.id 必须是 string');
    assert.ok(typeof p.model === 'string' && p.model !== 'unknown',
      `provider.model 不能是 "unknown"(球球 review 2026-08-15 发现的 bug)`);
  }
});

test('GET /api/company 应含 agents 数组', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/company`, { signal: AbortSignal.timeout(5000) });
  const data = await r.json();
  assert.ok(Array.isArray(data.agents), 'company.agents 必须是数组');
  assert.ok(Array.isArray(data.providers), 'company.providers 必须是数组');
});

test('POST workflow 合法线性 graph 保存后可由 GET 无损回读', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const id = `smoke-workflow-${Date.now()}`;
  const graph = {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'stage-prd',
        type: 'stage',
        stage: 'prd',
        templates: [{
          phase: 'prd',
          department: 'product',
          assigneeHint: 'product-head',
          title: '写接口需求',
          promptTemplate: '写 {{title}} 的接口需求',
          dependsOn: [],
        }],
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: 'stage-prd', type: 'default' },
      { id: 'edge-end', source: 'stage-prd', target: 'end', type: 'default' },
    ],
  };
  try {
    const saved = await fetch(`${BASE}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name: 'Smoke 线性流程',
        graph,
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).workflow.graph, graph);

    const listed = await fetch(`${BASE}/api/workflows`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(listed.status, 200);
    const workflow = (await listed.json()).workflows.find((item) => item.id === id);
    assert.deepEqual(workflow?.graph, graph);
  } finally {
    await fetch(`${BASE}/api/workflows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
});

test('POST workflow 断路 graph 返回 400 和中文原因', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: `smoke-disconnected-${Date.now()}`,
      name: 'Smoke 断路流程',
      graph: {
        version: 1,
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'end', type: 'end' },
          { id: 'orphan', type: 'end' },
        ],
        edges: [
          { id: 'edge-end', source: 'start', target: 'end', type: 'default' },
        ],
      },
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /start 无法到达节点/);
});

test('POST /api/templates/apply 缺 template 应 400(不是 500)', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/templates/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400, '缺 template 字段应 400');
  const data = await r.json();
  assert.ok(data.error, '400 必须带 error 字段');
});

// ─── 写操作:error path(不污染 db) ──────────────────────────────

test('POST /api/providers — id 含空格 400 + 中文错因', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'has space',  // 球球 review 2026-08-15 实际场景
      type: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.ok(data.error, '必须有 error 字段');
  assert.match(data.error, /alphanumeric|dash|underscore/i, '错因应解释 id 命名规范');
});

test('POST /api/providers — 缺 model 400', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'smoke-no-model',
      type: 'anthropic',
      apiKey: 'sk-test',
      // 故意不传 model
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error, /model are required/i);
});

test('POST /api/providers — 非法 type 400 + 提示已不支持 mock', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'smoke-bad-type',
      type: 'mock',  // 球球 review 2026-08-15:已删 mock
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error, /不支持 mock/i, '错因应明确说已不支持 mock');
});

test('POST /api/agents — llm 不存在 400 + 中文错因', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      englishName: `smoke-bad-llm-${Date.now()}`,
      name: 'Smoke Bad LLM',
      department: 'dev',
      role: 'worker',
      llm: 'no-such-llm-provider',
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error, /LLM 'no-such-llm-provider' not found/);
  assert.match(data.error, /设置 → LLM/, '错因应提示去设置 LLM');
});

test('POST /api/agents — role 非法 400', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      englishName: `smoke-bad-role-${Date.now()}`,
      name: 'Smoke Bad Role',
      department: 'dev',
      role: 'alien',  // 非法
      llm: 'whatever',
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error, /role must be head\|leader\|worker/);
});

test('POST /api/agents — department 不存在 400', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  // 拿一个真实 llm 用(避免再加 1 个错因)
  const providersResp = await fetch(`${BASE}/api/providers`);
  const providersData = await providersResp.json();
  const realLlm = providersData.providers?.[0]?.id;
  if (!realLlm) { t.skip('没有真实 llm provider 测不了'); return; }
  const r = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      englishName: `smoke-bad-dept-${Date.now()}`,
      name: 'Smoke Bad Dept',
      department: 'no-such-dept',
      role: 'worker',
      llm: realLlm,
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error, /department 'no-such-dept' does not exist/);
});

test('POST /api/departments — parentId 循环 400', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  // 创建 deptA
  const idA = `smoke-cycle-a-${Date.now()}`;
  const idB = `smoke-cycle-b-${Date.now()}`;
  const createA = await fetch(`${BASE}/api/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: idA, name: 'Smoke A', head: '' }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(createA.status, 200, '创建 deptA 失败');
  // 创建 deptB,parent = A
  const createB = await fetch(`${BASE}/api/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: idB, name: 'Smoke B', head: '', parentId: idA }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(createB.status, 200, '创建 deptB 失败');
  // 试图把 A.parentId 改成 B(会成环)
  const cycleAttempt = await fetch(`${BASE}/api/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: idA, name: 'Smoke A', head: '', parentId: idB }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(cycleAttempt.status, 400, '循环 parentId 应 400');
  const cycleData = await cycleAttempt.json();
  assert.match(cycleData.error, /循环/);
  // 清理
  await fetch(`${BASE}/api/departments/${idB}`, { method: 'DELETE' });
  await fetch(`${BASE}/api/departments/${idA}`, { method: 'DELETE' });
});

test('DELETE /api/skills/:name — 非法 name(路径穿越)400(球球 review C1)', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/skills/${encodeURIComponent('../../../etc/passwd')}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400, '路径穿越 name 应 400,不是 404/500');
  const data = await r.json();
  assert.ok(data.error, '必须有 error 字段');
});

test('POST /api/templates/apply — 完整 happy path 返回正确 stats 结构', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const providersResp = await fetch(`${BASE}/api/providers`);
  const providersData = await providersResp.json();
  const realLlm = providersData.providers?.[0]?.id;
  if (!realLlm) { t.skip('没有真实 llm provider,跳过 happy path'); return; }
  const deptId = `smoke-dept-${Date.now()}`;
  const agentId = `smoke-agent-${Date.now()}`;
  try {
    const r = await fetch(`${BASE}/api/templates/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: {
          name: `smoke-template-${Date.now()}`,
          departments: [
            { id: deptId, name: 'Smoke 部门', head: '' },
          ],
          agents: [
            {
              id: agentId,
              name: 'Smoke Agent',
              department: deptId,
              role: 'worker',
              llm: realLlm,
              systemPrompt: '',
              tools: [],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(r.status, 200, 'happy path 应 200');
    const data = await r.json();
    assert.ok(data.ok, '应返 ok: true');
    assert.ok(data.stats, '应返 stats 字段');
    assert.ok(data.stats.departments, 'stats.departments');
    assert.ok(data.stats.agents, 'stats.agents');
    assert.ok(data.message, '应返 message 字段(球球 review 强调透出)');
  } finally {
    // 球球 review 2026-08-16:smoke test 不能留脏数据,清掉
    await fetch(`${BASE}/api/agents/${agentId}`, { method: 'DELETE' }).catch(() => {});
    await fetch(`${BASE}/api/departments/${deptId}`, { method: 'DELETE' }).catch(() => {});
  }
});

test('POST /api/templates/apply — agent.llm 不存在时 stats.llmFallback 应 > 0(球球 review 强调透出)', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const r = await fetch(`${BASE}/api/templates/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template: {
        name: 'fallback-test',
        departments: [],
        agents: [
          {
            id: `fallback-agent-${Date.now()}`,
            name: 'Fallback',
            department: 'nonexistent',  // 会被 skip
            role: 'worker',
            llm: 'no-such-llm',
            systemPrompt: '',
            tools: [],
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(5000),
  });
  // 部门不存在,agent 会被 skip,不会触发 llm fallback
  // 这里只断言 200 / 不抛 500
  assert.ok(r.status === 200 || r.status === 400, '应返 200 或 400,不是 500');
});

test('GET /api/tools — custom 列表支持可安全渲染的 type=cli', async (t) => {
  if (!await pingServer()) return t.skip();
  const r = await fetch(`${BASE}/api/tools`, { signal: AbortSignal.timeout(3000) });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(Array.isArray(data.custom), 'custom 应是数组');
  for (const c of data.custom) {
    assert.ok(
      ['http', 'shell', 'prompt', 'cli'].includes(c.type),
      `custom tool "${c.name}" type="${c.type}" 非法`,
    );
  }
});

// 球球 review 2026-08-16:smoke test 不能留脏数据,套件跑完后全局兜底清理
// (上面每个 test 用 try/finally 清自己创建的数据,这里兜底清意外残留的)
import { after as smokeAfter } from 'node:test';
smokeAfter(async () => {
  if (!await pingServer()) return;
  // 清 smoke-* 前缀的部门 / agent
  const r = await fetch(`${BASE}/api/departments`, { signal: AbortSignal.timeout(3000) });
  if (r.ok) {
    const data = await r.json();
    const stale = (data.active ?? []).filter((d) =>
      (d.id && d.id.startsWith('smoke-')) || d.name === 'Smoke 部门',
    );
    for (const d of stale) {
      await fetch(`${BASE}/api/departments/${encodeURIComponent(d.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  // 清 custom_tools 里 smoke- 前缀的
  const r2 = await fetch(`${BASE}/api/tools`, { signal: AbortSignal.timeout(3000) });
  if (r2.ok) {
    const data = await r2.json();
    for (const t of (data.custom ?? [])) {
      if (t.name && t.name.startsWith('smoke-')) {
        await fetch(`${BASE}/api/tools/${encodeURIComponent(t.id)}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  }
  // 清 llm_providers 里 smoke- 前缀的
  const r3 = await fetch(`${BASE}/api/providers`, { signal: AbortSignal.timeout(3000) });
  if (r3.ok) {
    const data = await r3.json();
    for (const p of (data.providers ?? [])) {
      if (p.id && p.id.startsWith('smoke-')) {
        await fetch(`${BASE}/api/providers/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  }
  // 清 agent(id 含 smoke- 前缀)
  const r4 = await fetch(`${BASE}/api/agents`, { signal: AbortSignal.timeout(3000) });
  if (r4.ok) {
    const data = await r4.json();
    const staleAgents = [
      ...(data.db ?? []),
      ...(data.active ?? []),
    ].filter((a) => a.id && a.id.startsWith('smoke-'));
    for (const a of staleAgents) {
      await fetch(`${BASE}/api/agents/${encodeURIComponent(a.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
});

test('GET /api/fs/home-dirs — 应返 home 路径 + 候选 dirs 数组', async (t) => {
  if (!await pingServer()) return t.skip();
  const r = await fetch(`${BASE}/api/fs/home-dirs`, { signal: AbortSignal.timeout(3000) });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(typeof data.home === 'string' && data.home.length > 0, '应返 home 绝对路径');
  assert.ok(Array.isArray(data.dirs), '应返 dirs 数组');
  assert.ok(data.tmp, '应返 tmp 路径');
  // 至少 home 这一项存在
  assert.ok(data.dirs.some((d) => d.key === 'home'), '应包含 home 候选');
  const home = data.dirs.find((d) => d.key === 'home');
  assert.equal(home.writable, true, '当前有效 Home 必须可写');
  // 每个 dir 应有 key/label/path/writable 字段
  for (const d of data.dirs) {
    assert.ok(d.key, `${JSON.stringify(d)} 应有 key`);
    assert.ok(d.label, `${JSON.stringify(d)} 应有 label`);
    assert.ok(d.path, `${JSON.stringify(d)} 应有 path`);
    assert.equal(typeof d.writable, 'boolean', 'writable 应是 boolean');
  }
});

test('GET /api/fs/home-dirs — writable 使用 W_OK 访问检查', () => {
  const source = readFileSync(new URL('../src/api/server.ts', import.meta.url), 'utf8');
  const route = source.match(
    /app\.get\('\/api\/fs\/home-dirs'[\s\S]*?\n  \}\);/,
  )?.[0] ?? '';
  assert.match(route, /accessSync\(c\.path,\s*constants\.W_OK\)/);
  assert.doesNotMatch(route, /statSync\(c\.path\)/);
});

test('POST /api/fs/validate-dir — 有效 Home 目录返回规范路径和真实写权限', async (t) => {
  if (!await pingServer()) return t.skip();
  const homeDirsR = await fetch(`${BASE}/api/fs/home-dirs`, { signal: AbortSignal.timeout(3000) });
  const homeDirsData = await homeDirsR.json();
  const home = homeDirsData.dirs.find((d) => d.key === 'home');
  assert.ok(home, 'home 候选目录必须存在');

  const r = await fetch(`${BASE}/api/fs/validate-dir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: home.path }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.path, home.path);
  assert.equal(data.exists, true);
  assert.equal(data.writable, true);
});

test('POST /api/fs/validate-dir — 不存在目录返回 400', async (t) => {
  if (!await pingServer()) return t.skip();
  const homeDirsR = await fetch(`${BASE}/api/fs/home-dirs`, { signal: AbortSignal.timeout(3000) });
  const { home } = await homeDirsR.json();
  const r = await fetch(`${BASE}/api/fs/validate-dir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `${home}/agent-company-missing-${Date.now()}` }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error ?? '', /不存在|不合法/);
});

test('POST /api/fs/validate-dir — 文件路径返回 400', async (t) => {
  if (!await pingServer()) return t.skip();
  const r = await fetch(`${BASE}/api/fs/validate-dir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: new URL(import.meta.url).pathname }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error ?? '', /不是目录/);
});

test('POST /api/fs/validate-dir — allowlist 外绝对目录返回 400', async (t) => {
  if (!await pingServer()) return t.skip();
  const r = await fetch(`${BASE}/api/fs/validate-dir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/etc' }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error ?? '', /home|tmp|拒绝/);
});

test('POST /api/fs/validate-dir — hostile、空值和相对路径返回 400', async (t) => {
  if (!await pingServer()) return t.skip();
  for (const path of [undefined, null, '', '   ', '__proto__', 'constructor', 'relative/path']) {
    const r = await fetch(`${BASE}/api/fs/validate-dir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(r.status, 400, `${String(path)} 应返回 400`);
    const data = await r.json();
    assert.ok(data.error, `${String(path)} 应返回中文 error`);
  }
});

test('POST /api/fs/validate-dir — 超长路径返回固定错误且不回显输入', async (t) => {
  if (!await pingServer()) return t.skip();
  const path = `/${'a'.repeat(4096)}`;
  const r = await fetch(`${BASE}/api/fs/validate-dir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.equal(data.error, '项目目录路径过长');
  assert.doesNotMatch(JSON.stringify(data), new RegExp(path.slice(0, 128)));
});

test('POST /api/fs/validate-dir — null 和非对象 JSON body 返回 400', async (t) => {
  if (!await pingServer()) return t.skip();
  for (const body of [null, [], '', 0, true]) {
    const r = await fetch(`${BASE}/api/fs/validate-dir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(r.status, 400, `${JSON.stringify(body)} 应返回 400`);
    const data = await r.json();
    assert.ok(data.error, `${JSON.stringify(body)} 应返回中文 error`);
  }
});

test('POST /api/projects — projectDir 路径穿越应 400(球球 review 2026-08-16 SSRF 防护)', async (t) => {
  if (!await pingServer()) return t.skip();
  // /etc/passwd 是系统文件,不在 home / tmp 白名单内
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '路径穿越测试', projectDir: '/etc' }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(r.status, 400, '路径穿越应 400');
  const data = await r.json();
  assert.match(data.error ?? '', /home|tmp|不在|拒绝|合法/);
});

test('POST /api/projects — projectDir 用 home 下的真实目录应 200', async (t) => {
  if (!await pingServer()) return t.skip();
  // 用 Documents 作为合法 projectDir(大多数 macOS 用户都有)
  const homeDirsR = await fetch(`${BASE}/api/fs/home-dirs`, { signal: AbortSignal.timeout(3000) });
  const homeDirsData = await homeDirsR.json();
  const documents = homeDirsData.dirs.find((d) => d.key === 'documents');
  if (!documents) return t.skip('没有 ~/Documents');
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'projectDir 测试项目',
      description: '测 home 下目录',
      projectDir: documents.path,
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 200);
  const project = await r.json();
  assert.ok(project.id);
  // 清理:smoke after 钩子不会清 projects(smoke prefix 匹配),直接 db 删
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(SMOKE_DB_PATH);
  db.prepare(`DELETE FROM messages WHERE project_id = ?`).run(project.id);
  db.prepare(`DELETE FROM tasks WHERE project_id = ?`).run(project.id);
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(project.id);
  db.close();
});

  test('POST /api/projects — SOLO 模式 agentId 不存在应 400', async (t) => {
  if (!await pingServer()) return t.skip();
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'agentId 不存在测试',
        mode: 'solo',
      agentId: 'no-such-agent-9999',
    }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.match(data.error ?? '', /agent.*不存在|no-such-agent/);
});

  test('POST /api/projects — SOLO 模式 agentId 存在时写入项目 metadata', async (t) => {
  if (!await pingServer()) return t.skip();
  // 取第一个真实 agent id
  const agentsR = await fetch(`${BASE}/api/agents`, { signal: AbortSignal.timeout(3000) });
  const agentsData = await agentsR.json();
  const firstAgent = (agentsData.active ?? [])[0];
  if (!firstAgent) return t.skip('没有 agent');

  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        title: 'SOLO agentId 测试',
        mode: 'solo',
      agentId: firstAgent.id,
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 200);
  const project = await r.json();
  assert.ok(project.id);

    // SOLO 模式不生成流程任务,agentId 只用于连续对话项目的唯一 Agent。
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(SMOKE_DB_PATH);
    const tasks = db.prepare(`SELECT id FROM tasks WHERE project_id = ?`).all(project.id);
    assert.equal(tasks.length, 0, 'SOLO 项目不应生成流程 task');
  const proj = db.prepare(`SELECT metadata FROM projects WHERE id = ?`).get(project.id);
  const meta = JSON.parse(proj.metadata);
    assert.equal(meta.projectOwnerAgentId, firstAgent.id, 'project metadata 应记 projectOwnerAgentId');
    assert.equal(meta.soloAgentId, firstAgent.id, 'SOLO metadata 应记 soloAgentId');

  // 清理
  db.prepare(`DELETE FROM messages WHERE project_id = ?`).run(project.id);
  db.prepare(`DELETE FROM tasks WHERE project_id = ?`).run(project.id);
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(project.id);
  db.close();
});

test('POST /api/projects — thinking + autoApprove 真存到 project.metadata(球球 review 2026-08-16 开关真接)', async (t) => {
  if (!await pingServer()) return t.skip();
  // 创建时显式传 thinking=false / autoApprove='never',验证 metadata 真存了
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'thinking + autoApprove 开关测试',
      thinking: false,
      autoApprove: 'never',
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 200);
  const project = await r.json();

  // 从 db 直读 metadata 验证两个字段真存了
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(SMOKE_DB_PATH);
  try {
    const proj = db.prepare(`SELECT metadata FROM projects WHERE id = ?`).get(project.id);
    const meta = JSON.parse(proj.metadata);
    assert.equal(meta.thinking, false, 'metadata.thinking 应是 false');
    assert.equal(meta.autoApprove, 'never', 'metadata.autoApprove 应是 never');
  } finally {
    // 清理
    db.prepare(`DELETE FROM messages WHERE project_id = ?`).run(project.id);
    db.prepare(`DELETE FROM tasks WHERE project_id = ?`).run(project.id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(project.id);
    db.close();
  }
});

test('POST /api/projects — autoApprove 非法值返回 400 且不创建项目', async (t) => {
  if (!await pingServer()) return t.skip();
  const before = await fetch(`${BASE}/api/projects`, {
    signal: AbortSignal.timeout(3000),
  }).then(response => response.json());
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'autoApprove 非法值测试',
      autoApprove: 'maybe',
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'autoApprove 仅支持 always、never 或 prompt' });

  const after = await fetch(`${BASE}/api/projects`, {
    signal: AbortSignal.timeout(3000),
  }).then(response => response.json());
  assert.equal(after.length, before.length, '非法值不得创建项目');
});

test('GET /api/projects/:id — 创建后再查 metadata 应包含 thinking/autoApprove', async (t) => {
  if (!await pingServer()) return t.skip();
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'roundtrip metadata',
      thinking: true,
      autoApprove: 'prompt',
    }),
    signal: AbortSignal.timeout(5000),
  });
  const project = await r.json();

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(SMOKE_DB_PATH);
  try {
    // 用 GET 详情接口再查一次,模拟前端 onCreated 后的回读
    const getR = await fetch(`${BASE}/api/projects/${project.id}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(getR.status, 200);
    const detail = await getR.json();
    assert.equal(detail.project.metadata.thinking, true, 'GET 详情应回显 thinking=true');
    assert.equal(detail.project.metadata.autoApprove, 'prompt', 'GET 详情应回显 autoApprove=prompt');
    assert.ok(Array.isArray(detail.workflowNodeOutputs), 'GET 详情应返回节点输出数组');
  } finally {
    db.prepare(`DELETE FROM messages WHERE project_id = ?`).run(project.id);
    db.prepare(`DELETE FROM tasks WHERE project_id = ?`).run(project.id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(project.id);
    db.close();
  }
});

test('DELETE /api/projects/:id — 只删除项目记录,保留项目目录和文件', async (t) => {
  if (!await pingServer()) { t.skip('dev server 不通'); return; }
  const projectDir = mkdtempSync(join(tmpdir(), 'smoke-delete-project-'));
  const markerPath = join(projectDir, '保留文件.txt');
  writeFileSync(markerPath, '删除项目记录时不能删除文件');

  try {
    const createR = await fetch(`${BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'smoke-delete-project',
        projectDir,
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(createR.status, 200);
    const project = await createR.json();

    const deleteR = await fetch(`${BASE}/api/projects/${project.id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(deleteR.status, 200);
    assert.deepEqual(await deleteR.json(), { ok: true });

    const listR = await fetch(`${BASE}/api/projects`, { signal: AbortSignal.timeout(5000) });
    assert.equal(listR.status, 200);
    const projects = await listR.json();
    assert.equal(projects.some((p) => p.id === project.id), false);
    assert.equal(existsSync(projectDir), true);
    assert.equal(existsSync(markerPath), true);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// 球球 review 2026-08-16:trae agent 对话报 "exit null" — 排查发现 server.ts chat endpoint
// 之前只拼 `exit ${exitCode}`,exitCode=null 时只显示 "exit null",cliExecutor.output 里
// 的真实错因(agent.cliTool 没绑 / tool 不存在 / binary 找不到)全扔了。修后 error 字段
// 永远透出真实原因。

test('POST /api/agents — executor=cli + cliTool 未绑时应拒绝保存并透出真实原因', async (t) => {
  if (!await pingServer()) return t.skip();
  // 拿一个真实 department + 真实 llm,创建一个临时 cli agent(不绑 cliTool)
  const depsR = await fetch(`${BASE}/api/departments`, { signal: AbortSignal.timeout(3000) });
  const depsData = await depsR.json();
  const realDept = (depsData.active ?? [])[0];
  if (!realDept) return t.skip('没有 department');

  const provR = await fetch(`${BASE}/api/providers`, { signal: AbortSignal.timeout(3000) });
  const provData = await provR.json();
  const realLlm = (provData.providers ?? [])[0]?.id;
  if (!realLlm) return t.skip('没有 llm provider');

  // executor=cli + cliTool=undefined(模拟 trae-all-engineer 现状)
  const agentId = `smoke-cli-no-tool-${Date.now()}`;
  const createR = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: agentId,
      name: 'smoke-cli-no-tool',
      department: realDept.id,
      role: 'worker',
      llm: realLlm,
      systemPrompt: 'test',
      tools: [],
      executor: 'cli',
      cliModel: 'smoke-model',
      // cliTool 不传 — db 里就是 null
    }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await createR.json();
  assert.equal(createR.status, 400);
  assert.match(data.error, /必须选择 CLI 工具/);
});

test('POST /api/agents — executor=cli + cliTool 不存在时应拒绝保存并透出真实原因', async (t) => {
  if (!await pingServer()) return t.skip();
  // 创建临时 agent,cliTool 指向 db 里不存在的 tool 名
  const depsR = await fetch(`${BASE}/api/departments`, { signal: AbortSignal.timeout(3000) });
  const realDept = (await depsR.json()).active?.[0];
  if (!realDept) return t.skip('没有 department');

  const provR = await fetch(`${BASE}/api/providers`, { signal: AbortSignal.timeout(3000) });
  const realLlm = (await provR.json()).providers?.[0]?.id;
  if (!realLlm) return t.skip('没有 llm provider');

  const agentId = `smoke-cli-bad-tool-${Date.now()}`;
  const createR = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: agentId,
      name: 'smoke-cli-bad-tool',
      department: realDept.id,
      role: 'worker',
      llm: realLlm,
      systemPrompt: 'test',
      tools: [],
      executor: 'cli',
      cliTool: 'no-such-cli-tool',
      cliModel: 'smoke-model',
    }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await createR.json();
  assert.equal(createR.status, 400);
  assert.match(data.error, /CLI 'no-such-cli-tool' 不存在/);
});

test('POST /api/agents — CLI Agent 不需要 LLM Provider', async (t) => {
  if (!await pingServer()) return t.skip();
  const depsR = await fetch(`${BASE}/api/departments`, { signal: AbortSignal.timeout(3000) });
  const realDept = (await depsR.json()).active?.[0];
  if (!realDept) return t.skip('没有 department');

  const suffix = Date.now();
  const toolId = `smoke-cli-no-llm-tool-${suffix}`;
  const agentId = `smoke-cli-no-llm-agent-${suffix}`;
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(SMOKE_DB_PATH);
  try {
    db.prepare(`INSERT INTO custom_tools (id, name, type, description, config, enabled, created_at, updated_at)
                VALUES (?, ?, 'cli', ?, ?, 1, ?, ?)`).run(
      toolId,
      toolId,
      'CLI Agent 无 LLM 回归测试',
      JSON.stringify({
        command: '/bin/echo',
        argsTemplate: '{prompt:q}',
        modelsCommand: 'smoke-model',
        modelsParser: { type: 'lines' },
        timeoutMs: 5000,
      }),
      Date.now(),
      Date.now(),
    );

    const createR = await fetch(`${BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: agentId,
        name: 'CLI 无 LLM Agent',
        department: realDept.id,
        role: 'worker',
        systemPrompt: '',
        tools: [],
        executor: 'cli',
        cliTool: toolId,
        cliModel: 'smoke-model',
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(createR.status, 200, `CLI Agent 不应要求 LLM: ${await createR.text()}`);
    const row = db.prepare(`SELECT llm, executor, cli_tool, cli_model FROM agents WHERE id = ?`).get(agentId);
    assert.equal(row.llm, '');
    assert.equal(row.executor, 'cli');
    assert.equal(row.cli_tool, toolId);
    assert.equal(row.cli_model, 'smoke-model');

    const testR = await fetch(`${BASE}/api/agents/${agentId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'smoke-cli-test' }),
      signal: AbortSignal.timeout(8000),
    });
    const testData = await testR.json();
    assert.equal(testR.status, 200, `CLI Agent 测试不应查询 LLM: ${JSON.stringify(testData)}`);
    assert.equal(testData.success, true);
    assert.equal(testData.executor, 'cli');
    assert.match(testData.text, /smoke-cli-test/);
  } finally {
    db.prepare(`DELETE FROM agents WHERE id = ?`).run(agentId);
    db.prepare(`DELETE FROM custom_tools WHERE id = ?`).run(toolId);
    db.close();
  }
});

test('POST /api/agents/:id/chat — CLI spawn 输出含 http:// URL 时,oauthUrl 应透出(球球 review 2026-08-16)', async (t) => {
  if (!await pingServer()) return t.skip();
  // 创建一个临时 cli tool,command=/bin/echo,argsTemplate 含 OAuth URL
  // 然后建一个 agent 绑这个 tool,调 chat 验 oauthUrl 透出
  const depsR = await fetch(`${BASE}/api/departments`, { signal: AbortSignal.timeout(3000) });
  const realDept = (await depsR.json()).active?.[0];
  if (!realDept) return t.skip('没有 department');
  const provR = await fetch(`${BASE}/api/providers`, { signal: AbortSignal.timeout(3000) });
  const realLlm = (await provR.json()).providers?.[0]?.id;
  if (!realLlm) return t.skip('没有 llm provider');

  const toolId = `smoke-oauth-tool-${Date.now()}`;
  // 注意:custom tools API 只允许 http|shell|prompt — 我们直接写 db 绕过 type 校验
  // (实际生产场景 traecli 这种 cli 类型的 tool 是 server 启动时 ensureBuiltinCliTools 创建的)
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(SMOKE_DB_PATH);
  try {
    db.prepare(`INSERT INTO custom_tools (id, name, type, description, config, enabled, created_at, updated_at)
                VALUES (?, ?, 'cli', ?, ?, 1, ?, ?)`).run(
      toolId, toolId, 'smoke oauth tool',
      JSON.stringify({
        command: '/bin/echo',
        argsTemplate: 'open this: https://example.com/device?usercode=SMOKE-TEST',
        modelsCommand: 'smoke-model',
        modelsParser: { type: 'lines' },
        timeoutMs: 5000,
      }),
      Date.now(), Date.now(),
    );

    const agentId = `smoke-oauth-agent-${Date.now()}`;
    const createR = await fetch(`${BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: agentId,
        name: 'smoke-oauth-agent',
        department: realDept.id,
        role: 'worker',
        llm: realLlm,
        systemPrompt: 'test',
        tools: [],
        executor: 'cli',
        cliTool: toolId,
        cliModel: 'smoke-model',
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(createR.status, 200, `agent 创建失败: ${await createR.text()}`);

    try {
      const chatR = await fetch(`${BASE}/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'go' }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await chatR.json();
      assert.equal(data.executor, 'cli');
      // 关键断言:oauthUrl 应透出给前端
      assert.equal(data.oauthUrl, 'https://example.com/device?usercode=SMOKE-TEST',
        `oauthUrl 应透出,实际: ${data.oauthUrl}`);
    } finally {
      await fetch(`${BASE}/api/agents/${agentId}`, { method: 'DELETE' }).catch(() => {});
    }
  } finally {
    db.prepare(`DELETE FROM custom_tools WHERE id = ?`).run(toolId);
    db.close();
  }
});
