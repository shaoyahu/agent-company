/**
 * agent/helperAgent.ts 单测
 *
 * 隔离:跟 scanner.test.ts 一样,临时 HOME + chdir,避免污染用户家目录
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDB, closeDB } from '../../src/store/db.js';
import { freshDB, cleanupDB } from '../helpers/db.js';
import {
  HELPER_TOOL_DEFS,
  execMetaTool,
  runHelperAgent,
  listMetaTools,
  getMetaSkillBodies,
} from '../../src/agent/helperAgent.js';
import { installFromContent, uninstallSkill } from '../../src/skills/scanner.js';
import type { LLMRegistry, LLMMessage, ChatResponse } from '../../src/llm/types.js';

let dir: string;
let path: string;
let fakeHome: string;
let origHome: string | undefined;
let origCwd: string;

before(() => {
  ({ dir, path } = freshDB());
  // 隔离 helperAgent 用的 process.cwd() 和 homedir()
  fakeHome = mkdtempSync(join(tmpdir(), 'helper-test-'));
  origHome = process.env.HOME;
  origCwd = process.cwd();
  process.env.HOME = fakeHome;
  process.chdir(fakeHome);
});

after(() => {
  process.chdir(origCwd);
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(fakeHome, { recursive: true, force: true });
  cleanupDB(dir, path);
});

beforeEach(() => {
  // 清表
  getDB().exec(`DELETE FROM custom_tools`);
  // 装一个测试 skill(scanner 用 ~/.minimax/skills/)
  const skillsDir = join(fakeHome, '.minimax', 'skills', 'tool-builder');
  if (existsSync(skillsDir)) rmSync(skillsDir, { recursive: true, force: true });
  const skillBuilderDir = join(fakeHome, '.minimax', 'skills', 'skill-builder');
  if (existsSync(skillBuilderDir)) rmSync(skillBuilderDir, { recursive: true, force: true });
});

// =================== HELPER_TOOL_DEFS ===================

test('HELPER_TOOL_DEFS 6 个 meta-tool', () => {
  const names = HELPER_TOOL_DEFS.map((t) => t.name);
  assert.equal(names.length, 6);
  for (const n of ['create_custom_tool', 'update_custom_tool', 'delete_custom_tool',
                   'install_skill', 'uninstall_skill', 'get_skill_content']) {
    assert.ok(names.includes(n), `缺 ${n}`);
  }
});

test('每个 tool 都有 description + inputSchema', () => {
  for (const t of HELPER_TOOL_DEFS) {
    assert.ok(t.description, `${t.name} 缺 description`);
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.inputSchema.properties, `${t.name} 缺 properties`);
  }
});

// =================== listMetaTools ===================

test('listMetaTools 返 name + description', () => {
  const list = listMetaTools();
  assert.equal(list.length, 6);
  for (const t of list) {
    assert.ok(t.name);
    assert.ok(t.description);
  }
});

// =================== getMetaSkillBodies ===================

test('getMetaSkillBodies:没装 meta-skill 时返空串', () => {
  const m = getMetaSkillBodies();
  assert.equal(m.toolBuilder, '');
  assert.equal(m.skillBuilder, '');
});

test('getMetaSkillBodies:装了 tool-builder 返 body', async () => {
  const content = `---
name: tool-builder
description: 教 helper 怎么写 tool
---

# Tool Builder
写 tool 的规范...`;
  await installFromContent(content, 'tool-builder');
  const m = getMetaSkillBodies();
  assert.ok(m.toolBuilder.includes('Tool Builder'));
  assert.equal(m.skillBuilder, '');
});

// =================== execCreateTool ===================

test('execCreateTool:合法 http tool 创建成功', async () => {
  const r = await execMetaTool('create_custom_tool', {
    name: 'my-http-tool',
    type: 'http',
    description: '球球的 http 工具',
    config: { url: 'https://api.example.com' },
  });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('已创建 tool "my-http-tool"'));
  assert.equal(r.data.type, 'http');
});

test('execCreateTool:缺 name 报错', async () => {
  const r = await execMetaTool('create_custom_tool', {
    type: 'http',
    config: {},
  });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('name/type 必填'));
});

test('execCreateTool:无效 type 报错', async () => {
  const r = await execMetaTool('create_custom_tool', {
    name: 'foo',
    type: 'invalid',
    config: {},
  });
  assert.equal(r.success, false);
});

test('execCreateTool:name 非法字符报错', async () => {
  const r = await execMetaTool('create_custom_tool', {
    name: 'with space',
    type: 'http',
    config: {},
  });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('不合法'));
});

test('execCreateTool:同名已存在报错', async () => {
  await execMetaTool('create_custom_tool', {
    name: 'dupe',
    type: 'http',
    config: {},
  });
  const r = await execMetaTool('create_custom_tool', {
    name: 'dupe',
    type: 'http',
    config: {},
  });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('已存在'));
});

// =================== execUpdateTool ===================

test('execUpdateTool:更新存在的 tool', async () => {
  await execMetaTool('create_custom_tool', {
    name: 'upd',
    type: 'http',
    description: '原始',
    config: { url: 'https://a' },
  });
  const r = await execMetaTool('update_custom_tool', {
    name: 'upd',
    description: '更新后',
    config: { url: 'https://b' },
  });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('已更新 tool "upd"'));
});

test('execUpdateTool:不存在的 tool 报错', async () => {
  const r = await execMetaTool('update_custom_tool', { name: 'nope' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('不存在'));
});

test('execUpdateTool:不传 config 时保留原 config', async () => {
  await execMetaTool('create_custom_tool', {
    name: 'keep-cfg',
    type: 'http',
    config: { url: 'https://original' },
  });
  const r = await execMetaTool('update_custom_tool', {
    name: 'keep-cfg',
    description: '只改 description',
  });
  assert.equal(r.success, true);
  // config 应保留
  const repo = new (await import('../../src/store/customTools.js')).CustomToolRepo();
  const t = repo.getByName('keep-cfg');
  assert.deepEqual(t!.config, { url: 'https://original' });
});

// =================== execDeleteTool ===================

test('execDeleteTool:删除存在的 tool', async () => {
  await execMetaTool('create_custom_tool', {
    name: 'del',
    type: 'shell',
    config: { command: 'echo' },
  });
  const r = await execMetaTool('delete_custom_tool', { name: 'del' });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('已删除'));
});

test('execDeleteTool:不存在的 tool 报错', async () => {
  const r = await execMetaTool('delete_custom_tool', { name: 'nope' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('不存在'));
});

// =================== execInstallSkill ===================

test('execInstallSkill:source=content', async () => {
  const r = await execMetaTool('install_skill', {
    source: 'content',
    name: 'test-skill-a',
    content: `---
name: test-skill-a
description: 测试
---

# Body`,
  });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('已装 skill'));
  assert.equal(r.data.name, 'test-skill-a');
});

test('execInstallSkill:source=content 缺 content 报错', async () => {
  const r = await execMetaTool('install_skill', { source: 'content' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('必须填 content'));
});

test('execInstallSkill:source=url 缺 url 报错', async () => {
  const r = await execMetaTool('install_skill', { source: 'url' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('必须填 url'));
});

test('execInstallSkill:source=upload 缺 fileBase64 报错', async () => {
  const r = await execMetaTool('install_skill', { source: 'upload' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('必须填 fileBase64'));
});

test('execInstallSkill:source=hub 暂不支持', async () => {
  const r = await execMetaTool('install_skill', { source: 'hub' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('hub'));
});

test('execInstallSkill:未知 source 报错', async () => {
  const r = await execMetaTool('install_skill', { source: 'unknown' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('未知 source'));
});

// =================== execUninstallSkill ===================

test('execUninstallSkill:卸载存在的 skill', async () => {
  // 先装一个
  await installFromContent(`---\nname: uninst\ndescription: x\n---\n\nbody`, 'uninst');
  const r = await execMetaTool('uninstall_skill', { name: 'uninst' });
  assert.equal(r.success, true);
});

test('execUninstallSkill:不存在的 skill 抛错', async () => {
  const r = await execMetaTool('uninstall_skill', { name: 'nope-skill' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('卸载失败') || r.output.includes('不存在'));
});

// =================== execGetSkillContent ===================

test('execGetSkillContent:查看存在的 skill', async () => {
  await installFromContent(
    `---
name: get-me
description: 球球的 get 测试
---

# Body content here`,
    'get-me',
  );
  const r = await execMetaTool('get_skill_content', { name: 'get-me' });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('Body content here'));
  assert.equal(r.data.name, 'get-me');
});

test('execGetSkillContent:不存在的 skill 报错', async () => {
  const r = await execMetaTool('get_skill_content', { name: 'nope' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('不存在'));
});

test('execGetSkillContent:使用显式 companyRoot 读取项目级 skill', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'helper-company-root-'));
  const skillDir = join(companyRoot, '.minimax', 'skills', 'project-helper');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: project-helper\ndescription: 项目 helper\n---\n\n显式根目录内容',
  );

  try {
    const r = await execMetaTool(
      'get_skill_content',
      { name: 'project-helper' },
      companyRoot,
    );
    assert.equal(r.success, true);
    assert.match(r.output, /显式根目录内容/);
  } finally {
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

// =================== execMetaTool dispatch ===================

test('execMetaTool:未知 tool name 报错', async () => {
  const r = await execMetaTool('not-a-real-tool', {});
  assert.equal(r.success, false);
  assert.ok(r.output.includes('unknown meta-tool'));
});

// =================== runHelperAgent ===================

class FakeProvider {
  constructor(public responses: ChatResponse[]) {}
  async chat(_req: any): Promise<ChatResponse> {
    const r = this.responses.shift();
    if (!r) throw new Error('FakeProvider: no more responses');
    return r;
  }
}

class FakeRegistry {
  providers = new Map<string, FakeProvider>();
  set(id: string, p: FakeProvider) { this.providers.set(id, p); }
  get(id: string) { return this.providers.get(id); }
}

test('runHelperAgent:无 tool call 直接返 text', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([{ text: '好嘞', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } }]));
  const out = await runHelperAgent({
    tab: 'tools',
    messages: [{ role: 'user', content: '你好' }],
    llmId: 'p1',
    llmRegistry: reg as any,
  });
  assert.equal(out.reply, '好嘞');
  assert.equal(out.toolCalls.length, 0);
  assert.equal(out.usage.inputTokens, 10);
  assert.equal(out.usage.outputTokens, 5);
});

test('runHelperAgent:tool call → 执行 → 下一轮 LLM 拿到结果', async () => {
  // 第 1 轮:LLM 返 tool call
  // 第 2 轮:LLM 看到 tool result,返 text
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    {
      text: '',
      toolCalls: [{ id: 'tc1', name: 'create_custom_tool', input: { name: 'helper-tool', type: 'http', config: { url: 'https://x' } } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 20 },
    },
    {
      text: '已创建 helper-tool',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 200, outputTokens: 30 },
    },
  ]));
  const out = await runHelperAgent({
    tab: 'tools',
    messages: [{ role: 'user', content: '建个 tool' }],
    llmId: 'p1',
    llmRegistry: reg as any,
  });
  assert.equal(out.reply, '已创建 helper-tool');
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'create_custom_tool');
  assert.equal(out.toolCalls[0].result.success, true);
  // token 累加
  assert.equal(out.usage.inputTokens, 300);
  assert.equal(out.usage.outputTokens, 50);
});

test('runHelperAgent:LLM provider 找不到抛错', async () => {
  const reg = new FakeRegistry();
  // 不注册
  await assert.rejects(
    runHelperAgent({
      tab: 'tools',
      messages: [],
      llmId: 'no-such',
      llmRegistry: reg as any,
    }),
    /LLM provider "no-such" not found/,
  );
});

test('runHelperAgent:tools tab 注入 system prompt', async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any) {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  await runHelperAgent({
    tab: 'tools',
    messages: [{ role: 'user', content: 'hi' }],
    llmId: 'p1',
    llmRegistry: reg as any,
  });
  assert.ok(capturedSystem.includes('Tools'));
  assert.ok(capturedSystem.includes('Settings Helper'));
});

test('runHelperAgent:skills tab 注入 system prompt', async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any) {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  await runHelperAgent({
    tab: 'skills',
    messages: [{ role: 'user', content: 'hi' }],
    llmId: 'p1',
    llmRegistry: reg as any,
  });
  assert.ok(capturedSystem.includes('Skills'));
});

test('runHelperAgent:显式 companyRoot 的项目级 skill 进入 system prompt', async () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'helper-run-root-'));
  const skillDir = join(companyRoot, '.minimax', 'skills', 'root-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: root-skill\ndescription: 稳定根目录 skill\n---\n\nroot body',
  );
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.providers.set('p1', {
    async chat(req: any) {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  } as any);

  try {
    await runHelperAgent({
      tab: 'skills',
      messages: [],
      llmId: 'p1',
      llmRegistry: reg as any,
      companyRoot,
    });
    assert.match(capturedSystem, /root-skill/);
  } finally {
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('runHelperAgent:system prompt 包含已有 tools 列表', async () => {
  // 先建一个 tool
  await execMetaTool('create_custom_tool', {
    name: 'listed-tool',
    type: 'http',
    config: { url: 'https://x' },
  });
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any) {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  await runHelperAgent({
    tab: 'tools',
    messages: [],
    llmId: 'p1',
    llmRegistry: reg as any,
  });
  assert.ok(capturedSystem.includes('listed-tool'), 'system prompt 应包含已建 tool 名');
});

test('runHelperAgent:maxIter 8 限制 — LLM 一直返 tool call 会被截断', async () => {
  const reg = new FakeRegistry();
  // 给 9 个 tool_call responses(超过 8 限制),测不会无限循环
  const responses: ChatResponse[] = [];
  for (let i = 0; i < 9; i++) {
    responses.push({
      text: '',
      toolCalls: [{ id: `tc${i}`, name: 'get_skill_content', input: { name: 'nope' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  }
  reg.set('p1', new FakeProvider(responses));
  const out = await runHelperAgent({
    tab: 'tools',
    messages: [],
    llmId: 'p1',
    llmRegistry: reg as any,
  });
  // 8 轮 maxIter,即使有 9 个 response 也只跑 8 次
  assert.equal(out.toolCalls.length, 8, '应限制 8 轮');
  // reply 应该是空(最后一轮也是 tool_call)
  assert.equal(out.reply, '');
});

test('runHelperAgent:tool result 失败时把 ERROR: 标记写入 tool 消息', async () => {
  const reg = new FakeRegistry();
  const responses: ChatResponse[] = [
    {
      text: '',
      toolCalls: [{ id: 'tc1', name: 'get_skill_content', input: { name: 'no-such' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 0, outputTokens: 0 },
    },
    {
      text: '我知道了',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    },
  ];
  reg.set('p1', new FakeProvider(responses));
  let lastMessages: any[] = [];
  reg.providers.set('p1', {
    async chat(req: any) {
      lastMessages = req.messages;
      const r = responses.shift()!;
      return r;
    },
  });
  await runHelperAgent({
    tab: 'skills',
    messages: [],
    llmId: 'p1',
    llmRegistry: reg as any,
  });
  // 找 tool 消息
  const toolMsg = lastMessages.find((m) => m.role === 'tool');
  assert.ok(toolMsg);
  assert.ok(toolMsg.content.startsWith('ERROR:'), `tool 消息应以 ERROR: 开头,实际: ${toolMsg.content}`);
});
