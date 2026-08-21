/**
 * web/test/unit/api.test.ts
 *
 * 覆盖:
 * 1. http() helper 各边界(GET 没 body / PUT 有 body / 401/403/404/422)
 * 2. api.* 所有方法的 URL 路径 + method 正确(防止 404 路径 bug 重现)
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { http, api } from '../../src/api/client.js';

let origFetch: typeof globalThis.fetch;
let captured: Array<{ url: string; method: string; init: RequestInit | undefined }> = [];
const clientSource = readFileSync(
  new URL('../../src/api/client.ts', import.meta.url),
  'utf8',
);

beforeEach(() => {
  origFetch = globalThis.fetch;
  captured = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    captured.push({ url: String(url), method: init?.method ?? 'GET', init });
    const body = String(url).includes('/projects/')
      ? { project: null, tasks: [], messages: [], workflowNodeOutputs: [] }
      : { ok: true, data: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

// =================== http() 边界 ===================

test('http GET 没 body 不设 Content-Type', async () => {
  await http('GET', '/test');
  const c = captured[0]!;
  assert.deepEqual(c.init?.headers, {}, 'GET 不应设 Content-Type');
  assert.equal(c.init?.body, undefined);
});

test('http PUT 有 body 设 Content-Type', async () => {
  await http('PUT', '/x/1', { name: 'y' });
  const c = captured[0]!;
  assert.equal((c.init?.headers as any)['Content-Type'], 'application/json');
  assert.equal(c.init?.body, JSON.stringify({ name: 'y' }));
});

test('http PATCH 跟 POST 一样处理 body', async () => {
  await http('PATCH', '/x/1', { a: 1 });
  const c = captured[0]!;
  assert.equal((c.init?.headers as any)['Content-Type'], 'application/json');
});

test('http body=undefined 不设 Content-Type', async () => {
  await http('POST', '/x', undefined);
  const c = captured[0]!;
  assert.equal(c.init?.body, undefined);
  assert.deepEqual(c.init?.headers, {});
});

test('http body=0 也算有 body(Fastify 接受 0)', async () => {
  await http('POST', '/x', 0);
  const c = captured[0]!;
  assert.equal(c.init?.body, '0');
  assert.equal((c.init?.headers as any)['Content-Type'], 'application/json');
});

test('http body="" 算有 body', async () => {
  await http('POST', '/x', '');
  const c = captured[0]!;
  assert.equal(c.init?.body, '""');
});

test('http 401 抛错,err.status=401', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })) as any;
  await assert.rejects(http('GET', '/x'), (e: any) => e.status === 401 && e.message === 'unauthorized');
});

test('http 403 透出后端 message', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })) as any;
  await assert.rejects(http('GET', '/x'), (e: any) => e.status === 403 && e.message === 'forbidden');
});

test('http 404 透出后端 error', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })) as any;
  await assert.rejects(http('GET', '/x'), (e: any) => e.status === 404 && e.message === 'not found');
});

test('http 422 透出后端 error', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid input' }), { status: 422, headers: { 'Content-Type': 'application/json' } })) as any;
  await assert.rejects(http('POST', '/x', {}), (e: any) => e.status === 422 && e.message === 'invalid input');
});

test('http BASE 前缀是 /api', async () => {
  await http('GET', '/company');
  assert.equal(captured[0]!.url, '/api/company');
});

test('http err.body 在成功响应时不被 set', async () => {
  const data = await http('GET', '/x');
  assert.deepEqual(data, { ok: true, data: null });
  // err.body 不存在(成功路径不抛)
});

// =================== api 路径 + method 正确性 ===================

test('api.company → GET /api/company', async () => {
  await api.company();
  assert.equal(captured[0]!.url, '/api/company');
  assert.equal(captured[0]!.method, 'GET');
});

test('api.projects → GET /api/projects', async () => {
  await api.projects();
  assert.equal(captured[0]!.url, '/api/projects');
});

test('api.project(id) → GET /api/projects/:id', async () => {
  await api.project('abc');
  assert.equal(captured[0]!.url, '/api/projects/abc');
});

test('api.project 返回项目节点输出类型', async () => {
  const detail = await api.project('abc');
  const outputs = detail.workflowNodeOutputs;
  assert.ok(Array.isArray(outputs));
});

test('项目 API 对 hostile 和路径字符 ID 统一 URL 编码', async () => {
  const id = '__proto__/项目 name';
  const encoded = '__proto__%2F%E9%A1%B9%E7%9B%AE%20name';

  await api.project(id);
  await api.deleteProject(id);
  await api.tick(id);
  await api.say(id, '继续');

  assert.deepEqual(
    captured.map((item) => [item.method, item.url]),
    [
      ['GET', `/api/projects/${encoded}`],
      ['DELETE', `/api/projects/${encoded}`],
      ['POST', `/api/projects/${encoded}/tick`],
      ['POST', `/api/projects/${encoded}/say`],
    ],
  );
});

test('api.createProject → POST /api/projects + body', async () => {
  await api.createProject({
    title: '球球的项目',
    description: 'x',
    mode: 'solo',
    workflowId: 'standard',
    attachments: [
      { name: '需求.txt', size: 3, contentBase64: 'eHl6' },
    ],
  });
  const c = captured[0]!;
  assert.equal(c.url, '/api/projects');
  assert.equal(c.method, 'POST');
  assert.ok(c.init?.body?.includes('球球的项目'));
  assert.ok(c.init?.body?.includes('solo'));
  assert.ok(c.init?.body?.includes('standard'));
  assert.ok(c.init?.body?.includes('需求.txt'));
  assert.ok(c.init?.body?.includes('contentBase64'));
});

test('api.workflows → GET /api/workflows', async () => {
  await api.workflows();
  assert.equal(captured[0]!.url, '/api/workflows');
  assert.equal(captured[0]!.method, 'GET');
});

test('WorkflowDefinition 和写入类型强制 graph，写入类型不包含旧字段', () => {
  assert.match(clientSource, /export interface WorkflowGraph\s*{/);
  assert.match(
    clientSource,
    /export interface WorkflowDefinition\s*{[\s\S]*?\bgraph:\s*WorkflowGraph;/,
  );
  const writeInput = clientSource.match(
    /export interface WorkflowWriteInput\s*{([\s\S]*?)\n}/,
  )?.[1] ?? '';
  assert.match(writeInput, /\bgraph:\s*WorkflowGraph;/);
  assert.doesNotMatch(writeInput, /\bstages[?:]/);
  assert.doesNotMatch(writeInput, /\btemplates[?:]/);
});

test('api.upsertWorkflow → POST /api/workflows 且 body 精确使用新 graph 合约', async () => {
  const graph = {
    version: 1 as const,
    nodes: [
      { id: 'start', type: 'start' as const },
      { id: 'end', type: 'end' as const },
    ],
    edges: [
      { id: 'edge-0', source: 'start', target: 'end', type: 'default' as const },
    ],
  };
  await api.upsertWorkflow({
    id: 'landing-flow',
    name: '落地页流程',
    description: '只跑落地页',
    graph,
    stages: ['prd'],
    templates: {
      prd: [{
        phase: 'prd',
        department: 'product',
        assigneeHint: 'product-head',
        title: '写需求',
        promptTemplate: '写需求',
        dependsOn: [],
      }],
    },
    builtIn: true,
    createdAt: 1,
    updatedAt: 2,
    hostile: '__proto__',
  } as any);
  const c = captured[0]!;
  assert.equal(c.url, '/api/workflows');
  assert.equal(c.method, 'POST');
  assert.deepEqual(JSON.parse(String(c.init?.body)), {
    id: 'landing-flow',
    name: '落地页流程',
    description: '只跑落地页',
    graph,
  });
});

test('api.deleteWorkflow → DELETE /api/workflows/:id', async () => {
  await api.deleteWorkflow('landing-flow');
  assert.equal(captured[0]!.url, '/api/workflows/landing-flow');
  assert.equal(captured[0]!.method, 'DELETE');
});

test('api.deleteProject → DELETE /api/projects/:id(无 body)', async () => {
  await api.deleteProject('p1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/projects/p1');
  assert.equal(c.method, 'DELETE');
  assert.equal(c.init?.body, undefined, 'DELETE 不应设 body');
  assert.deepEqual(c.init?.headers, {});
});

test('api.homeDirs → GET /api/fs/home-dirs', async () => {
  await api.homeDirs();
  const c = captured[0]!;
  assert.equal(c.url, '/api/fs/home-dirs');
  assert.equal(c.method, 'GET');
  assert.equal(c.init?.body, undefined);
});

test('api.validateDir → POST /api/fs/validate-dir + body', async () => {
  await api.validateDir({ path: '/Users/test/project' });
  const c = captured[0]!;
  assert.equal(c.url, '/api/fs/validate-dir');
  assert.equal(c.method, 'POST');
  assert.equal(c.init?.body, JSON.stringify({ path: '/Users/test/project' }));
});

test('api.tick(id) → POST /api/projects/:id/tick', async () => {
  await api.tick('p1');
  assert.equal(captured[0]!.url, '/api/projects/p1/tick');
  assert.equal(captured[0]!.method, 'POST');
});

test('api.say(id, content, attachments) → POST /api/projects/:id/say + body', async () => {
  await api.say('p1', '你好球球', {
    attachments: [
      {
        name: '截图.png',
        size: 4,
        contentBase64: 'AAEC/w==',
      },
    ],
  });
  const c = captured[0]!;
  assert.equal(c.url, '/api/projects/p1/say');
  assert.equal(c.method, 'POST');
  assert.equal(c.init?.body, JSON.stringify({
    content: '你好球球',
    attachments: [
      {
        name: '截图.png',
        size: 4,
        contentBase64: 'AAEC/w==',
      },
    ],
  }));
});

test('api.agentStatuses → GET /api/agents/status', async () => {
  await api.agentStatuses();
  assert.equal(captured[0]!.url, '/api/agents/status');
});

test('api.providers → GET /api/providers', async () => {
  await api.providers();
  assert.equal(captured[0]!.url, '/api/providers');
});

test('api.upsertProvider → POST /api/providers + body', async () => {
  await api.upsertProvider({ id: 'p1', type: 'openai', model: 'm1' });
  const c = captured[0]!;
  assert.equal(c.url, '/api/providers');
  assert.equal(c.method, 'POST');
});

test('api.deleteProvider → DELETE /api/providers/:id(无 body)', async () => {
  await api.deleteProvider('p1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/providers/p1');
  assert.equal(c.method, 'DELETE');
  assert.equal(c.init?.body, undefined, 'DELETE 不应设 body');
  assert.deepEqual(c.init?.headers, {});
});

test('api.testProvider → POST /api/providers/:id/test + 空 body', async () => {
  await api.testProvider('p1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/providers/p1/test');
  assert.equal(c.method, 'POST');
  // body 是空 object
  assert.equal(c.init?.body, '{}');
});

test('api.departments → GET /api/departments', async () => {
  await api.departments();
  assert.equal(captured[0]!.url, '/api/departments');
});

test('api.agents → GET /api/agents', async () => {
  await api.agents();
  assert.equal(captured[0]!.url, '/api/agents');
});

test('api.tools → GET /api/tools', async () => {
  await api.tools();
  assert.equal(captured[0]!.url, '/api/tools');
});

test('api.upsertTool → POST /api/tools', async () => {
  await api.upsertTool({ name: 't1', type: 'http', config: {} });
  assert.equal(captured[0]!.url, '/api/tools');
  assert.equal(captured[0]!.method, 'POST');
});

test('api.deleteTool(id) → DELETE /api/tools/:id', async () => {
  await api.deleteTool('t1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/tools/t1');
  assert.equal(c.method, 'DELETE');
});

test('api.testTool → POST /api/tools/test', async () => {
  await api.testTool({ type: 'http', config: {}, input: {} });
  assert.equal(captured[0]!.url, '/api/tools/test');
  assert.equal(captured[0]!.method, 'POST');
});

test('api.skills → GET /api/skills', async () => {
  await api.skills();
  assert.equal(captured[0]!.url, '/api/skills');
});

test('api.skill(name) → GET /api/skills/:name(URL 编码)', async () => {
  await api.skill('tool-builder');
  assert.equal(captured[0]!.url, '/api/skills/tool-builder');
});

test('api.skill 含特殊字符时 URL 编码', async () => {
  await api.skill('my/skill name');
  assert.equal(captured[0]!.url, '/api/skills/my%2Fskill%20name');
});

test('api.installSkill → POST /api/skills/install', async () => {
  await api.installSkill({ source: 'content', content: 'x' });
  assert.equal(captured[0]!.url, '/api/skills/install');
  assert.equal(captured[0]!.method, 'POST');
});

test('api.uninstallSkill → DELETE /api/skills/:name', async () => {
  await api.uninstallSkill('tool-builder');
  const c = captured[0]!;
  assert.equal(c.url, '/api/skills/tool-builder');
  assert.equal(c.method, 'DELETE');
});

test('api.upsertAgent → POST /api/agents', async () => {
  await api.upsertAgent({ id: 'a1', department: 'dev', role: 'worker', llm: 'p1' });
  assert.equal(captured[0]!.url, '/api/agents');
  assert.equal(captured[0]!.method, 'POST');
});

test('api.deleteAgent → DELETE /api/agents/:id', async () => {
  await api.deleteAgent('a1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/agents/a1');
  assert.equal(c.method, 'DELETE');
});

test('api.chatAgent → POST /api/agents/:id/chat', async () => {
  await api.chatAgent('a1', { messages: [{ role: 'user', content: 'hi' }] });
  const c = captured[0]!;
  assert.equal(c.url, '/api/agents/a1/chat');
  assert.equal(c.method, 'POST');
});

test('api.cliTools → GET /api/cli-tools', async () => {
  await api.cliTools();
  assert.equal(captured[0]!.url, '/api/cli-tools');
  assert.equal(captured[0]!.method, 'GET');
});

test('api.discoveredCliTools → GET /api/cli-tools/discovered', async () => {
  await api.discoveredCliTools();
  assert.equal(captured[0]!.url, '/api/cli-tools/discovered');
  assert.equal(captured[0]!.method, 'GET');
});

test('api.cliModels → POST /api/cli-tools/:name/models', async () => {
  await api.cliModels('trae-cli', { refresh: true });
  const c = captured[0]!;
  assert.equal(c.url, '/api/cli-tools/trae-cli/models');
  assert.equal(c.method, 'POST');
  assert.equal(c.init?.body, JSON.stringify({ refresh: true }));
});

test('api.upsertDepartment → POST /api/departments', async () => {
  await api.upsertDepartment({ id: 'd1', name: '研发', head: 'a1' });
  assert.equal(captured[0]!.url, '/api/departments');
  assert.equal(captured[0]!.method, 'POST');
});

test('api.deleteDepartment → DELETE /api/departments/:id', async () => {
  await api.deleteDepartment('d1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/departments/d1');
  assert.equal(c.method, 'DELETE');
});

test('api.applyTemplate → POST /api/templates/apply', async () => {
  // 球球 review:之前是 /api/apply-template(404),已修
  await api.applyTemplate({ template: { name: 'x' } });
  const c = captured[0]!;
  assert.equal(c.url, '/api/templates/apply', '路径必须 /api/templates/apply 避免 404');
  assert.equal(c.method, 'POST');
});

test('api.settingsMetaTools → GET /api/settings/meta-tools', async () => {
  await api.settingsMetaTools();
  assert.equal(captured[0]!.url, '/api/settings/meta-tools');
});

test('api.settingsChat → POST /api/settings/chat', async () => {
  await api.settingsChat({ tab: 'tools', messages: [{ role: 'user', content: 'hi' }], llmId: 'p1' });
  const c = captured[0]!;
  assert.equal(c.url, '/api/settings/chat');
  assert.equal(c.method, 'POST');
});

test('api.conversations → GET /api/conversations', async () => {
  await api.conversations();
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations');
  assert.equal(c.method, 'GET');
});

test('api.createConversation → POST /api/conversations + body', async () => {
  const input = {
    kind: 'group' as const,
    title: '架构讨论',
    agentIds: ['a1', 'a2'],
    schedulerMode: 'llm' as const,
    schedulerLlm: 'llm-main',
  };
  await api.createConversation(input);
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations');
  assert.equal(c.method, 'POST');
  assert.equal(c.init?.body, JSON.stringify(input));
});

test('api.conversation → GET /api/conversations/:id 并编码路径参数', async () => {
  await api.conversation('c/1 name');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1%20name');
  assert.equal(c.method, 'GET');
});

test('api.updateConversationProfile → PATCH /api/conversations/:id + body', async () => {
  const input = { title: '新版标题', avatar: '研' };
  await api.updateConversationProfile('c/1', input);
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1');
  assert.equal(c.method, 'PATCH');
  assert.equal(c.init?.body, JSON.stringify(input));
});

test('api.deleteConversation → DELETE /api/conversations/:id', async () => {
  await api.deleteConversation('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1');
  assert.equal(c.method, 'DELETE');
  assert.equal(c.init?.body, undefined);
});

test('api.pinConversation → POST /api/conversations/:id/pin', async () => {
  await api.pinConversation('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/pin');
  assert.equal(c.method, 'POST');
});

test('api.unpinConversation → POST /api/conversations/:id/unpin', async () => {
  await api.unpinConversation('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/unpin');
  assert.equal(c.method, 'POST');
});

test('api.muteConversation → POST /api/conversations/:id/mute', async () => {
  await api.muteConversation('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/mute');
  assert.equal(c.method, 'POST');
});

test('api.unmuteConversation → POST /api/conversations/:id/unmute', async () => {
  await api.unmuteConversation('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/unmute');
  assert.equal(c.method, 'POST');
});

test('api.markConversationRead → POST /api/conversations/:id/read', async () => {
  await api.markConversationRead('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/read');
  assert.equal(c.method, 'POST');
});

test('api.addConversationMember → POST /api/conversations/:id/members + body', async () => {
  await api.addConversationMember('c/1', 'agent/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/members');
  assert.equal(c.method, 'POST');
  assert.equal(c.init?.body, JSON.stringify({ agentId: 'agent/1' }));
});

test('api.removeConversationMember → DELETE /api/conversations/:id/members/:agentId', async () => {
  await api.removeConversationMember('c/1', 'agent/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/members/agent%2F1');
  assert.equal(c.method, 'DELETE');
});

test('api.conversationMessages → GET /api/conversations/:id/messages', async () => {
  await api.conversationMessages('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/messages');
  assert.equal(c.method, 'GET');
});

test('api.conversationMessages 编码分页参数', async () => {
  await api.conversationMessages('c1', { beforeSequence: 20, limit: 50 });
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c1/messages?beforeSequence=20&limit=50');
  assert.equal(c.method, 'GET');
});

test('api.sendConversationMessage → POST /api/conversations/:id/messages + body', async () => {
  await api.sendConversationMessage('c/1', '你好');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/messages');
  assert.equal(c.method, 'POST');
  assert.equal(c.init?.body, JSON.stringify({ content: '你好' }));
});

test('api.pauseConversation → POST /api/conversations/:id/pause', async () => {
  await api.pauseConversation('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/pause');
  assert.equal(c.method, 'POST');
});

test('api.resumeConversation → POST /api/conversations/:id/resume', async () => {
  await api.resumeConversation('c/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/resume');
  assert.equal(c.method, 'POST');
});

test('api.pauseConversationAgent → POST /api/conversations/:id/members/:agentId/pause', async () => {
  await api.pauseConversationAgent('c/1', 'agent/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/members/agent%2F1/pause');
  assert.equal(c.method, 'POST');
});

test('api.resumeConversationAgent → POST /api/conversations/:id/members/:agentId/resume', async () => {
  await api.resumeConversationAgent('c/1', 'agent/1');
  const c = captured[0]!;
  assert.equal(c.url, '/api/conversations/c%2F1/members/agent%2F1/resume');
  assert.equal(c.method, 'POST');
});

test('api.exportData → GET /api/data/export 并返回 Blob', async () => {
  globalThis.fetch = (async (url: any, init?: any) => {
    captured.push({ url: String(url), method: init?.method ?? 'GET', init });
    return new Response('zip-data', { status: 200, headers: { 'Content-Type': 'application/zip' } });
  }) as typeof globalThis.fetch;

  const blob = await api.exportData();
  assert.equal(captured[0]!.url, '/api/data/export');
  assert.equal(captured[0]!.method, 'GET');
  assert.equal(await blob.text(), 'zip-data');
});

test('api.importData → POST /api/data/import', async () => {
  await api.importData({ fileBase64: 'eA==', filename: 'backup.zip' });
  const c = captured[0]!;
  assert.equal(c.url, '/api/data/import');
  assert.equal(c.method, 'POST');
  assert.ok(String(c.init?.body).includes('fileBase64'));
});

test('api.resetData → POST /api/data/reset + 确认 token', async () => {
  await api.resetData();
  const c = captured[0]!;
  assert.equal(c.url, '/api/data/reset');
  assert.equal(c.method, 'POST');
  assert.ok(String(c.init?.body).includes('RESET_AGENT_COMPANY'));
});
