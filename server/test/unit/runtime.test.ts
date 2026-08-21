/**
 * agent/runtime.test.ts 单测
 *
 * 关键:mock LLMProvider + LLMRegistry 隔离真实 LLM 调用
 *       临时 HOME + project dir 隔离文件系统
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getDB, closeDB } from '../../src/store/db.js';
import { freshDB, cleanupDB } from '../helpers/db.js';
import { AgentRuntime, type AgentEvent } from '../../src/agent/runtime.js';
import { tools } from '../../src/agent/tools.js';
import { installFromContent } from '../../src/skills/scanner.js';
import type { LLMRegistry, LLMMessage, ChatResponse, ToolCall } from '../../src/llm/types.js';
import type { AgentConfig, Task } from '../../src/types/company.js';
import { ProjectRepo, TaskRepo, MessageRepo, AgentStatusRepo, DeliverableRepo } from '../../src/store/repository.js';

let dir: string;
let path: string;
let fakeHome: string;
let projectDir: string;
let origHome: string | undefined;
let origCwd: string;

before(() => {
  ({ dir, path } = freshDB());
  fakeHome = mkdtempSync(join(tmpdir(), 'runtime-test-'));
  projectDir = mkdtempSync(join(tmpdir(), 'runtime-proj-'));
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
  rmSync(projectDir, { recursive: true, force: true });
  cleanupDB(dir, path);
});

beforeEach(() => {
  // 清表 + seed project + task(给外键用)
  const db = new Database(path);
  for (const t of ['messages', 'agent_status', 'deliverables', 'tasks', 'projects', 'custom_tools']) {
    db.exec(`DELETE FROM ${t}`);
  }
  new ProjectRepo().create({
    id: 'p1',
    title: '球球的项目',
    boss: '球球',
    status: 'idea',
    phase: 'idea',
    metadata: {},
  });
  new TaskRepo().create(makeTask());
});

function makeAgent(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'a1',
    name: '前端-小李',
    department: 'dev',
    role: 'worker',
    llm: 'p1',
    systemPrompt: '你是球球的助手',
    tools: ['bash', 'read', 'write'],
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    phase: 'dev',
    workflowIteration: 0,
    department: 'dev',
    assignee: 'a1',
    title: '写代码',
    prompt: '写个 hello world',
    status: 'pending',
    inputFiles: [],
    outputFiles: [],
    dependsOn: [],
    attempts: 0,
    maxAttempts: 3,
    cost: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
    createdAt: Date.now(),
    ...over,
  };
}

class FakeProvider {
  responses: ChatResponse[];
  chatCalls: LLMMessage[][] = [];
  constructor(responses: ChatResponse[]) { this.responses = [...responses]; }
  async chat(req: any): Promise<ChatResponse> {
    this.chatCalls.push(req.messages);
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

// =================== subscribe ===================

test('subscribe 后 emit 触发 handler + unsubscribe 返函数', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([{ text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }]));
  const rt = new AgentRuntime(reg as any);
  let count = 0;
  const unsub = rt.subscribe(() => count++);
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.ok(count > 0, '应触发至少 1 次(emit done)');
  const before = count;
  unsub();
  await rt.runTask(makeTask({ id: 't2' }), makeAgent(), projectDir);
  assert.equal(count, before, 'unsub 后不应增加');
});

// =================== runTask 找不到 LLM ===================

test('runTask:agent.llm 找不到 provider 抛错', async () => {
  const reg = new FakeRegistry();  // 不注册
  const rt = new AgentRuntime(reg as any);
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });
  assert.equal(result.success, false);
  assert.ok(result.error?.includes('不可用的 LLM'));
  assert.ok(result.error?.includes('"p1"'));
});

// =================== runTask llm executor — 直接 text 结束 ===================

test('runTask:LLM 返 text 无 tool call → success + summary', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    { text: '球球的 hello world 已写好', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  const events: AgentEvent[] = [];
  rt.subscribe((e) => events.push(e));
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.equal(result.success, true);
  assert.ok(result.outputSummary.includes('球球的 hello world'));
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 5);
  // emit 至少 text + done
  assert.ok(events.some((e) => e.type === 'text'));
  assert.ok(events.some((e) => e.type === 'done'));
});

test('runTask:[SUMMARY] 标签提取为 summary', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    { text: '我做了很多事 [SUMMARY]\n球球的项目已交付\n[/SUMMARY]', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.equal(result.outputSummary, '球球的项目已交付');
});

// =================== runTask llm executor — tool call 循环 ===================

test('runTask:工具 call → 反馈 → 下一轮 LLM 拿到结果', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    // 第 1 轮:写文件
    {
      text: '',
      toolCalls: [{ id: 'tc1', name: 'write', input: { path: 'hello.txt', content: '球球的 hello' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 10 },
    },
    // 第 2 轮:看到工具结果,总结
    {
      text: '已写 hello.txt [SUMMARY]\n写完了\n[/SUMMARY]',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 200, outputTokens: 20 },
    },
  ]));
  const rt = new AgentRuntime(reg as any);
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });
  assert.equal(result.success, true);
  // 文件应真写到了 projectDir
  assert.ok(existsSync(join(projectDir, 'hello.txt')));
  assert.equal(result.outputSummary, '写完了');
  // 交付物
  assert.ok(result.outputFiles.includes(join(projectDir, 'hello.txt')));
  // token 累加
  assert.equal(result.inputTokens, 300);
  assert.equal(result.outputTokens, 30);
});

test('runTask:unknown tool 返成功 result 但 success=false 的 tool result', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    {
      text: '',
      toolCalls: [{ id: 'tc1', name: 'no-such-tool', input: {} }],
      stopReason: 'tool_use',
      usage: { inputTokens: 0, outputTokens: 0 },
    },
    { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.equal(result.success, true);
});

test('runTask:tool handler 抛错被 catch 包成失败 tool result', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    {
      text: '',
      toolCalls: [{ id: 'tc1', name: 'read', input: { path: '/nope' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 0, outputTokens: 0 },
    },
    { text: '处理完了', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  // /nope 找不到文件,read 返 success=false,不会抛
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.equal(result.success, true);
});

test('runTask:LLM 抛错返 success=false + error 包含原因', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', {
    async chat(): Promise<ChatResponse> {
      throw new Error('network fail');
    },
  });
  const rt = new AgentRuntime(reg as any);
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.equal(result.success, false);
  assert.ok(result.error?.includes('LLM call failed'));
  assert.ok(result.error?.includes('network fail'));
});

// =================== runTask cli executor ===================

test('runTask:executor=cli 调 runCliAgent', async () => {
  // 装一个 CLI tool
  const db = new Database(path);
  db.prepare(
    `INSERT INTO custom_tools (id, name, type, description, config, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('ct1', 'echo-cli', 'cli', 'echo', JSON.stringify({
    command: '/bin/echo',
    argsTemplate: '{{prompt}}',
    modelsCommand: 'test-model',
    modelsParser: { type: 'lines' },
  }), 1, Date.now(), Date.now());

  const reg = new FakeRegistry();
  // cli executor 不调 LLM,注册了也不用
  const rt = new AgentRuntime(reg as any);
  const result = await rt.runTask(
    makeTask(),
    makeAgent({ executor: 'cli', cliTool: 'echo-cli', cliModel: 'test-model' }),
    projectDir,
  );
  assert.equal(result.success, true);
  // 看到 echo 输出
  assert.ok(result.outputSummary.includes('写个 hello world'));
});

test('runTask:executor=cli 但 cliTool 不存在 → 失败 + 清晰错', async () => {
  const reg = new FakeRegistry();
  const rt = new AgentRuntime(reg as any);
  const result = await rt.runTask(
    makeTask(),
    makeAgent({ executor: 'cli', cliTool: 'no-such-cli', cliModel: 'test-model' }),
    projectDir,
  );
  assert.equal(result.success, false);
  assert.ok(result.error?.includes('不存在'));
});

// =================== 副作用:状态 / 消息 / 交付物 ===================

test('runTask:status busy → idle', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([{ text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }]));
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });
  const statusRepo = new AgentStatusRepo();
  const all = statusRepo.getAll();
  const a1 = all.find((s) => s.agentId === 'a1');
  assert.equal(a1?.status, 'idle');
});

test('runTask:写"开始"和"完成"消息到 messageRepo', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([{ text: '球球做完', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }]));
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });
  const msgs = new MessageRepo().listByProject('p1');
  // 至少:开始 + 完成
  assert.ok(msgs.length >= 2);
  const systemMsgs = msgs.filter((m) => m.type === 'system');
  assert.ok(systemMsgs.some((m) => m.content.includes('开始任务')));
  assert.ok(systemMsgs.some((m) => m.content.includes('完成')));
});

test('runTask:tool call 消息也写到 messageRepo', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    { text: '', toolCalls: [{ id: 'tc1', name: 'bash', input: { command: 'echo hi' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    { text: 'done', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  const msgs = new MessageRepo().listByProject('p1');
  const toolMsgs = msgs.filter((m) => m.type === 'tool');
  assert.ok(toolMsgs.length > 0, '应有 tool 消息');
  assert.ok(toolMsgs.some((m) => m.toolName === 'bash'));
});

test('runTask:交付物写入 deliverableRepo', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    { text: '', toolCalls: [{ id: 'tc1', name: 'write', input: { path: 'app.ts', content: 'code' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });
  const dels = new DeliverableRepo().listByProject('p1');
  assert.ok(dels.length > 0, '应有交付物');
  assert.ok(dels.some((d) => d.path.endsWith('app.ts')));
});

test('runTask:taskRepo.recordResult 写状态 done', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([{ text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }]));
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  const t = new TaskRepo().get('t1');
  assert.equal(t?.status, 'done', `t1 status 应为 done,实际: ${t?.status}`);
});

test('runTask:taskRepo.recordResult 失败时 status=failed', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', {
    async chat(): Promise<ChatResponse> {
      throw new Error('net');
    },
  });
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  const t = new TaskRepo().get('t1');
  assert.equal(t?.status, 'failed');
  assert.ok(t?.error?.includes('LLM call failed'));
});

// =================== emit 事件类型完整 ===================

test('runTask:emit 至少 text + done(LLM 直接 text 路径)', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([{ text: '球球的 reply', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }]));
  const rt = new AgentRuntime(reg as any);
  const types = new Set<string>();
  rt.subscribe((e) => types.add(e.type));
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.ok(types.has('text'));
  assert.ok(types.has('done'));
});

test('runTask:emit tool_call + tool_result(工具路径)', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    { text: '', toolCalls: [{ id: 'tc1', name: 'bash', input: { command: 'echo' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  const types = new Set<string>();
  rt.subscribe((e) => types.add(e.type));
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.ok(types.has('tool_call'));
  assert.ok(types.has('tool_result'));
  assert.ok(types.has('done'));
});

test('runTask:LLM 抛错时仍 emit done(result.success=false)', async () => {
  // runtime.ts:chatLoop 内 catch LLM 错误返 result,外层 try 成功走 emit 'done'
  // (注意:外层 try 的 catch 是给更外层错误用的,chatLoop 自己处理 LLM 错误)
  const reg = new FakeRegistry();
  reg.set('p1', {
    async chat(): Promise<ChatResponse> {
      throw new Error('boom');
    },
  });
  const rt = new AgentRuntime(reg as any);
  const dones: AgentEvent[] = [];
  rt.subscribe((e) => { if (e.type === 'done') dones.push(e); });
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.equal(dones.length, 1);
  const r = (dones[0] as any).result;
  assert.equal(r.success, false);
  assert.ok(r.error?.includes('LLM call failed'));
});

// =================== maxIterations ===================

test('runTask:maxIterations 30 — 持续 tool call 会被截断', async () => {
  const responses: ChatResponse[] = [];
  for (let i = 0; i < 35; i++) {
    responses.push({
      text: '',
      toolCalls: [{ id: `tc${i}`, name: 'bash', input: { command: 'true' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  }
  // 第 31 轮应该 break,LLM 不会再调
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider(responses));
  const rt = new AgentRuntime(reg as any);
  // bash 跑 true 没问题
  const result = await rt.runTask(makeTask(), makeAgent(), projectDir);
  // 30 轮 + 最后返回 success=true
  assert.equal(result.success, true);
});

// =================== Skills 注入 ===================

test('runTask:agent.skills 注入到 system prompt', async () => {
  // 装一个 skill
  await installFromContent(
    `---
name: test-skill
description: 球球的测试 skill
---

# Test Skill Content`,
    'test-skill',
  );
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent({ skills: ['test-skill'] }), projectDir);
  assert.ok(capturedSystem.includes('test-skill'), 'system prompt 应包含 skill 名');
  assert.ok(capturedSystem.includes('Test Skill Content'), '应包含 skill body');
});

test('runTask:显式 companyRoot 为外部项目加载项目级 skill', async () => {
  const explicitCompanyRoot = mkdtempSync(join(tmpdir(), 'runtime-company-root-'));
  const externalProjectDir = mkdtempSync(join(tmpdir(), 'runtime-external-project-'));
  const skillDir = join(explicitCompanyRoot, '.minimax', 'skills', 'company-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: company-skill\ndescription: 公司级技能\n---\n\n真实 companyRoot skill',
  );

  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  try {
    const rt = new AgentRuntime(reg as any, explicitCompanyRoot);
    await rt.runTask(
      makeTask(),
      makeAgent({ skills: ['company-skill'] }),
      externalProjectDir,
    );
    assert.match(capturedSystem, /真实 companyRoot skill/);
  } finally {
    rmSync(explicitCompanyRoot, { recursive: true, force: true });
    rmSync(externalProjectDir, { recursive: true, force: true });
  }
});

test('runTask:显式 companyRoot 进入外部项目工具上下文', async () => {
  const explicitCompanyRoot = mkdtempSync(join(tmpdir(), 'runtime-tool-root-'));
  const externalProjectDir = mkdtempSync(join(tmpdir(), 'runtime-tool-project-'));
  let receivedCompanyRoot = '';
  tools.register(
    {
      name: 'capture_company_root',
      description: '捕获 companyRoot',
      inputSchema: { type: 'object', properties: {} },
    },
    async (_input, ctx) => {
      receivedCompanyRoot = ctx.companyRoot;
      return { success: true, output: ctx.companyRoot };
    },
  );
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    {
      text: '',
      toolCalls: [{ id: 'capture-root', name: 'capture_company_root', input: {} }],
      stopReason: 'tool_use',
      usage: { inputTokens: 0, outputTokens: 0 },
    },
    { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  try {
    const rt = new AgentRuntime(reg as any, explicitCompanyRoot);
    await rt.runTask(
      makeTask(),
      makeAgent({ tools: ['capture_company_root'] }),
      externalProjectDir,
    );
    assert.equal(receivedCompanyRoot, explicitCompanyRoot);
  } finally {
    rmSync(explicitCompanyRoot, { recursive: true, force: true });
    rmSync(externalProjectDir, { recursive: true, force: true });
  }
});

test('runTask:直接调用未传 companyRoot 时兼容默认项目目录布局', async () => {
  const fallbackRoot = mkdtempSync(join(tmpdir(), 'runtime-fallback-root-'));
  const fallbackProject = join(fallbackRoot, 'projects', 'p1');
  const skillDir = join(fallbackRoot, '.minimax', 'skills', 'fallback-skill');
  mkdirSync(fallbackProject, { recursive: true });
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: fallback-skill\ndescription: fallback\n---\n\n兼容 fallback skill',
  );

  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  try {
    const rt = new AgentRuntime(reg as any);
    await rt.runTask(
      makeTask(),
      makeAgent({ skills: ['fallback-skill'] }),
      fallbackProject,
    );
    assert.match(capturedSystem, /兼容 fallback skill/);
  } finally {
    rmSync(fallbackRoot, { recursive: true, force: true });
  }
});

test('runTask:agent.skills 空时不注入 skills 段', async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir);
  assert.ok(!capturedSystem.includes('启用的 Skills'));
});

// =================== inferDeliverableType ===================

test('runTask:交付物 type 推断 .ts → code', async () => {
  const reg = new FakeRegistry();
  reg.set('p1', new FakeProvider([
    { text: '', toolCalls: [{ id: 'tc1', name: 'write', input: { path: 'app.ts', content: 'x' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });
  const dels = new DeliverableRepo().listByProject('p1');
  const tsFile = dels.find((d) => d.path.endsWith('app.ts'));
  assert.equal(tsFile?.type, 'code');
});

// =================== autoApprove='never' 拦截危险工具(球球 review 2026-08-16 真接) ===================

test("runTask:autoApprove='never' 拦截 bash 危险工具,直接返'老板拒绝' tool result", async () => {
  const reg = new FakeRegistry();
  const capturedToolResults: string[] = [];
  // 自定义 FakeProvider 子类:既当 queue,又捕获 tool role 消息
  class CapturingProvider extends FakeProvider {
    async chat(req: any): Promise<ChatResponse> {
      const lastToolMsg = [...req.messages].reverse().find((m: any) => m.role === 'tool');
      if (lastToolMsg) capturedToolResults.push(lastToolMsg.content);
      if (this.responses.length > 0) return this.responses.shift()!;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    }
  }
  reg.set('p1', new CapturingProvider([
    { text: '', toolCalls: [{ id: 'tc1', name: 'bash', input: { command: 'echo danger' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));

  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'never' });

  // 危险工具应被拦截,tool result 含"老板"和"拒绝"
  assert.equal(capturedToolResults.length, 1, '应有 1 个 tool result');
  assert.ok(capturedToolResults[0]!.includes('老板'), `tool result 应提到"老板": ${capturedToolResults[0]}`);
  assert.ok(capturedToolResults[0]!.includes('拒绝'), `tool result 应提到"拒绝": ${capturedToolResults[0]}`);
  assert.ok(capturedToolResults[0]!.includes('bash'), '应提到被拦截的工具名 bash');
});

test("runTask:autoApprove='prompt' 在没有确认通道时拦截危险工具", async () => {
  const reg = new FakeRegistry();
  let captured = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      const toolMessage = [...req.messages].reverse().find((m: any) => m.role === 'tool');
      if (toolMessage) captured = toolMessage.content;
      return toolMessage
        ? { text: '已说明', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
        : { text: '', toolCalls: [{ id: 'tc1', name: 'bash', input: { command: 'echo danger' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  await new AgentRuntime(reg as any).runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'prompt' });
  assert.match(captured, /无法处理逐次确认/);
});

test("runTask:autoApprove='never' 拦截 write/edit/web_fetch 全部 3 个危险工具", async () => {
  for (const dangerous of ['write', 'edit', 'web_fetch']) {
    // 每个工具一个 task,beforeEach 已经 seed 了 project 'p1' — 我们只重置 tasks
    // 关键:不能 delete projects(会触发 UNIQUE 约束 if beforeEach 之后再 create)
    // beforeEach 会 reset 整个表 + recreate p1 — 但这个 test 是子循环,
    // beforeEach 只在 test 入口跑一次。我们手动清 task 然后重 seed。
    const db = new Database(path);
    db.exec(`DELETE FROM tasks`);
    new TaskRepo().create(makeTask({ id: `t-${dangerous}` }));

    const reg = new FakeRegistry();
    let captured = '';
    class CapturingProvider extends FakeProvider {
      async chat(req: any): Promise<ChatResponse> {
        const lastToolMsg = [...req.messages].reverse().find((m: any) => m.role === 'tool');
        if (lastToolMsg) captured = lastToolMsg.content;
        if (this.responses.length > 0) return this.responses.shift()!;
        return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
      }
    }
    const input = dangerous === 'web_fetch' ? { url: 'https://x' } : { path: 'x', content: 'y' };
    reg.set('p1', new CapturingProvider([
      { text: '', toolCalls: [{ id: 'tc1', name: dangerous, input }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]));

    const rt = new AgentRuntime(reg as any);
    await rt.runTask(makeTask({ id: `t-${dangerous}` }), makeAgent(), projectDir, 'general', { autoApprove: 'never' });

    assert.ok(captured.includes('老板'), `${dangerous} 应被拦截,提到"老板": ${captured}`);
    assert.ok(captured.includes('拒绝'), `${dangerous} 应被拦截,提到"拒绝": ${captured}`);
  }
});

test("runTask:autoApprove='always' 不拦截危险工具,正常跑", async () => {
  const reg = new FakeRegistry();
  const capturedToolResults: string[] = [];
  class CapturingProvider extends FakeProvider {
    async chat(req: any): Promise<ChatResponse> {
      const lastToolMsg = [...req.messages].reverse().find((m: any) => m.role === 'tool');
      if (lastToolMsg) capturedToolResults.push(lastToolMsg.content);
      if (this.responses.length > 0) return this.responses.shift()!;
      return { text: 'done', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    }
  }
  reg.set('p1', new CapturingProvider([
    { text: '', toolCalls: [{ id: 'tc1', name: 'bash', input: { command: 'echo hello' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));

  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });

  // 'always' 不拦截,tool result 应是 echo 的输出
  assert.equal(capturedToolResults.length, 1);
  assert.ok(!capturedToolResults[0]!.includes('拒绝'), `"always" 不应拦截: ${capturedToolResults[0]}`);
  assert.ok(capturedToolResults[0]!.includes('hello'), `bash 应正常跑: ${capturedToolResults[0]}`);
});

test("runTask:autoApprove='never' 不挡只读工具 read", async () => {
  // 只读工具(read)不应被 'never' 拦截 — tool result 应是 handler 返的(失败内容),
  // 不应含"老板拒绝"
  // beforeEach 已经 seed project 'p1' — 我们只重置 task
  const db = new Database(path);
  db.exec(`DELETE FROM tasks`);
  new TaskRepo().create(makeTask({ id: 't-read' }));

  const reg = new FakeRegistry();
  let captured = '';
  class CapturingProvider extends FakeProvider {
    async chat(req: any): Promise<ChatResponse> {
      const lastToolMsg = [...req.messages].reverse().find((m: any) => m.role === 'tool');
      if (lastToolMsg) captured = lastToolMsg.content;
      if (this.responses.length > 0) return this.responses.shift()!;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    }
  }
  reg.set('p1', new CapturingProvider([
    { text: '', toolCalls: [{ id: 'tc1', name: 'read', input: { path: '/nope' } }], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
  ]));

  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask({ id: 't-read' }), makeAgent(), projectDir, 'general', { autoApprove: 'never' });

  assert.ok(!captured.includes('老板拒绝'), `read 不应被'never'拦截: ${captured}`);
});

// =================== thinking 注入 system prompt(球球 review 2026-08-16 真接) ===================

test('runTask:opts.thinking=true(默认)system prompt 注入"思考模式"', async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { thinking: true });
  assert.ok(capturedSystem.includes('思考模式'), '开思考应注入"思考模式"段');
  assert.ok(capturedSystem.includes('分步骤思考'), '应提到分步骤思考');
  assert.ok(!capturedSystem.includes('直答模式'), '不应有"直答模式"段');
});

test('runTask:opts.thinking=false system prompt 注入"直答模式"', async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { thinking: false });
  assert.ok(capturedSystem.includes('直答模式'), '关思考应注入"直答模式"段');
  assert.ok(capturedSystem.includes('不要思考'), '应提到不要思考');
  assert.ok(!capturedSystem.includes('# 思考模式\n'), '不应有"思考模式"独立段');
});

test("runTask:opts.autoApprove='never' system prompt 注入'绝不执行'段", async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'never' });
  assert.ok(capturedSystem.includes('绝不执行'), 'never 模式应注入"绝不执行"段');
  assert.ok(capturedSystem.includes('从不授权'), '应提到"从不授权"');
});

test("runTask:opts.autoApprove='always' 不注入额外授权段(保持简洁)", async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  const rt = new AgentRuntime(reg as any);
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general', { autoApprove: 'always' });
  // always 模式不额外注入
  assert.ok(!capturedSystem.includes('绝不执行'), 'always 模式不应注入"绝不执行"段');
  assert.ok(!capturedSystem.includes('每次询问'), 'always 模式不应注入"每次询问"段');
});

test('runTask:不传 opts 时 thinking 默认 true + autoApprove 默认 never', async () => {
  const reg = new FakeRegistry();
  let capturedSystem = '';
  reg.set('p1', {
    async chat(req: any): Promise<ChatResponse> {
      capturedSystem = req.messages[0].content;
      return { text: 'ok', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  });
  const rt = new AgentRuntime(reg as any);
  // 不传 opts,完全用默认
  await rt.runTask(makeTask(), makeAgent(), projectDir, 'general');
  assert.ok(capturedSystem.includes('思考模式'), '默认 thinking=true 应有"思考模式"段');
  assert.ok(capturedSystem.includes('绝不执行'), '默认 autoApprove=never 应有"绝不执行"段');
});
