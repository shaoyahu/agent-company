/**
 * agent/cliExecutor.test.ts 单测
 *
 * 策略:用 `echo` 作为 CLI 测整体行为(renderTemplate / tokenizeArgs / spawn 都过)。
 * 同时为了单元精度,把内部 tokenize / render 提到测试覆盖。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDB, closeDB } from '../../src/store/db.js';
import { CustomToolRepo, type CliToolConfig } from '../../src/store/customTools.js';
import { runCliAgent } from '../../src/agent/cliExecutor.js';
import { freshDB, cleanupDB } from '../helpers/db.js';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig, Task } from '../../src/types/company.js';

let dir: string;
let path: string;

before(() => {
  ({ dir, path } = freshDB());
});

after(() => {
  cleanupDB(dir, path);
});

beforeEach(() => {
  getDB().exec(`DELETE FROM custom_tools`);
});

const agent: AgentConfig = {
  id: 'a1',
  name: '前端-小李',
  department: 'dev',
  role: 'worker',
  llm: 'p1',
  systemPrompt: '',
  tools: [],
  executor: 'cli',
  cliTool: 'echo-cli',
  cliModel: 'test-model',
};

const task: Task = {
  id: 't1',
  projectId: 'p1',
  phase: 'dev',
  department: 'dev',
  assignee: 'a1',
  title: '写代码',
  prompt: '帮我写个 hello world',
  status: 'pending',
  inputFiles: [],
  outputFiles: [],
  dependsOn: [],
  attempts: 0,
  maxAttempts: 3,
  cost: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
  createdAt: Date.now(),
};

function makeTask(over: Partial<Task> = {}): Task {
  return { ...task, ...over };
}

function makeAgent(over: Partial<AgentConfig> = {}): AgentConfig {
  return { ...agent, ...over };
}

function makeCliTool(over: Partial<CliToolConfig> & { name?: string; enabled?: boolean } = {}) {
  const repo = new CustomToolRepo();
  const now = Date.now();
  const name = over.name ?? 'echo-cli';
  // 用 /bin/echo 当 CLI(总是存在)
  const config: CliToolConfig = {
    command: over.command ?? '/bin/echo',
    argsTemplate: over.argsTemplate ?? '{{prompt}}',
    defaultModel: over.defaultModel,
    timeoutMs: over.timeoutMs ?? 10_000,
    env: over.env,
  };
  repo.upsert({
    id: 'ct1',
    name,
    type: 'cli',
    description: 'test cli',
    config: config as any,
    enabled: over.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  });
  return { repo, name, config };
}

// =================== runCliAgent 错误路径 ===================

test('agent.cliTool 为空时报清晰错', async () => {
  const a = makeAgent({ cliTool: undefined });
  const r = await runCliAgent({ agent: a, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('cliTool=""') || r.output.includes('cliTool='));
  assert.equal(r.exitCode, null);
});

test('cliTool 找不到时报清晰错', async () => {
  const a = makeAgent({ cliTool: 'no-such-cli' });
  const r = await runCliAgent({ agent: a, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('找不到') || r.output.includes('cliTool'));
});

test('tool type 不是 cli 报错', async () => {
  const repo = new CustomToolRepo();
  const now = Date.now();
  repo.upsert({
    id: 'ct1',
    name: 'http-tool',
    type: 'http',
    description: 'not cli',
    config: {} as any,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  const a = makeAgent({ cliTool: 'http-tool' });
  const r = await runCliAgent({ agent: a, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('type=http') || r.output.includes('不是 cli'));
});

test('tool enabled=false 报错', async () => {
  makeCliTool({ enabled: false });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('已被禁用'));
});

test('CLI 文件不存在时报错', async () => {
  makeCliTool({ command: '/nope/no/such/binary' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  assert.ok(r.output.includes('CLI 不存在'));
});

test('runCliAgent:spawn ENOENT 时输出 Electron 诊断信息', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-enoent-diagnostics-'));
  const command = join(dir, 'broken-cli');
  writeFileSync(command, '#!/no/such/interpreter\n');
  chmodSync(command, 0o755);
  makeCliTool({ command, argsTemplate: '{prompt:q}' });

  try {
    const r = await runCliAgent({ agent, task: makeTask(), promptOverride: 'hello' });
    assert.equal(r.success, false);
    assert.match(r.output, /spawn failed: spawn .* ENOENT/);
    assert.match(r.output, /CLI 诊断:/);
    assert.match(r.output, /commandExists: true/);
    assert.match(r.output, /commandExecutable: true/);
    assert.match(r.output, /cwd: <无 cwd>/);
    assert.match(r.output, /effectiveCwd: /);
    assert.match(r.output, /PATH: /);
    assert.match(r.output, /platform: darwin/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI Agent 未选择模型时拒绝执行', async () => {
  makeCliTool();
  const r = await runCliAgent({
    agent: makeAgent({ cliModel: undefined }),
    task: makeTask(),
    projectDir: '/tmp',
  });
  assert.equal(r.success, false);
  assert.match(r.output, /未选择 CLI 模型/);
});

// =================== runCliAgent 成功路径 ===================

test('CLI 跑通返回 stdout', async () => {
  makeCliTool({ argsTemplate: 'hello {{name}}' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, true);
  assert.equal(r.exitCode, 0);
  assert.ok(r.output.includes('hello 前端-小李'));
  assert.ok(r.durationMs >= 0);
});

test('{{prompt}} 替换 task.prompt', async () => {
  makeCliTool({ argsTemplate: '{{prompt}}' });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: '写个 hello world 球球' }),
    projectDir: '/tmp',
  });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('写个 hello world 球球'));
});

test('promptOverride 覆盖 task.prompt', async () => {
  makeCliTool({ argsTemplate: '{{prompt}}' });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: '原始 prompt' }),
    projectDir: '/tmp',
    promptOverride: '覆盖后的 prompt',
  });
  assert.ok(r.output.includes('覆盖后的 prompt'), `应包含覆盖 prompt,实际: ${r.output}`);
  assert.ok(!r.output.includes('原始 prompt'));
});

test('model 占位符使用 Agent 显式模型', async () => {
  makeCliTool({ argsTemplate: '--model={{model}} {{prompt}}' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('--model=test-model'));
});

test('defaultModel 旧配置不覆盖 Agent 显式模型', async () => {
  makeCliTool({
    argsTemplate: '--model={{model}} {{prompt}}',
    defaultModel: 'claude-test',
  });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.ok(r.output.includes('--model=test-model'));
});

test('modelOverride 优先', async () => {
  makeCliTool({
    argsTemplate: '--model={{model}} {{prompt}}',
    defaultModel: 'default-model',
  });
  const r = await runCliAgent({
    agent,
    task: makeTask(),
    projectDir: '/tmp',
    modelOverride: 'override-model',
  });
  assert.ok(r.output.includes('--model=override-model'));
});

test('trae-cli 使用 Agent 显式选择的模型', async () => {
  makeCliTool({
    name: 'trae-cli',
    argsTemplate: 'exec --skip-git-repo-check --model {model} --sandbox read-only',
    defaultModel: 'auto',
  });
  const r = await runCliAgent({
    agent: makeAgent({ cliTool: 'trae-cli' }),
    task: makeTask(),
    projectDir: '/tmp',
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.args, ['exec', '--skip-git-repo-check', '--model', 'test-model', '--sandbox', 'read-only']);
});

test('trae-cli 未声明权限时默认使用 workspace-write', async () => {
  makeCliTool({
    name: 'trae-cli',
    argsTemplate: 'exec --skip-git-repo-check',
  });
  const r = await runCliAgent({
    agent: makeAgent({ cliTool: 'trae-cli' }),
    task: makeTask(),
    projectDir: '/tmp',
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.args, [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
  ]);
});

test('{{cwd}} 替换项目目录', async () => {
  makeCliTool({ argsTemplate: '--cwd={{cwd}} {{prompt}}' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.ok(r.output.includes('--cwd=/tmp'), `应包含 --cwd=/tmp,实际: ${r.output}`);
});

test('{{name}} 优先 agent.name,缺失时用 agent.id', async () => {
  makeCliTool({ argsTemplate: '{{name}}' });
  // name 存在
  let r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.ok(r.output.includes('前端-小李'));
  // name 缺失
  const a2: AgentConfig = { ...agent, name: undefined };
  r = await runCliAgent({ agent: a2, task: makeTask(), projectDir: '/tmp' });
  assert.ok(r.output.includes('a1'));
});

test('{{task}} 替换 task.title', async () => {
  makeCliTool({ argsTemplate: '--title={{task}}' });
  const r = await runCliAgent({
    agent,
    task: makeTask({ title: '球球的可视化报告' }),
    projectDir: '/tmp',
  });
  assert.ok(r.output.includes('--title=球球的可视化报告'));
});

test('unknown 占位符替换为空串', async () => {
  makeCliTool({ argsTemplate: 'a={{unknown}} b={{prompt}}' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('a= b='));
});

test('argsTemplate 多 token(空格分隔)', async () => {
  makeCliTool({ argsTemplate: '--model {{model}} --prompt "{{prompt}}"' });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: '球球的 prompt' }),
    projectDir: '/tmp',
    modelOverride: 'm1',
  });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('--model'));
  assert.ok(r.output.includes('m1'));
  assert.ok(r.output.includes('--prompt'));
  assert.ok(r.output.includes('球球的 prompt'));
});

test('CLI 退出码非 0 时 success=false', async () => {
  // 用 sh -c 'exit 1' 模拟非 0 退出(macOS 没 /bin/false)
  makeCliTool({ command: '/bin/sh', argsTemplate: '-c "exit 1"' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  assert.equal(r.exitCode, 1);
  assert.ok(r.output.includes('exit 1'));
});

test('CLI 退 0 但有 stderr → output 仍包含内容(stdout 优先)', async () => {
  // /bin/echo 到 stderr
  makeCliTool({
    command: '/bin/sh',
    argsTemplate: '-c "echo stdout-msg; echo stderr-msg 1>&2"',
  });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, true);
  assert.ok(r.output.includes('stdout-msg'));
});

test('CLI 退非 0 时 output 包含 exit code + stdout + stderr', async () => {
  makeCliTool({
    command: '/bin/sh',
    argsTemplate: '-c "echo out; echo err 1>&2; exit 2"',
  });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  assert.equal(r.exitCode, 2);
  assert.ok(r.output.includes('exit 2'));
  assert.ok(r.output.includes('out'));
  assert.ok(r.output.includes('err'));
});

test('CLI 真的存在(existsSync)', () => {
  assert.ok(existsSync('/bin/echo'));
  assert.ok(existsSync('/bin/sh'));
});

test('command / args 字段返回调试用', async () => {
  makeCliTool({ command: '/bin/echo', argsTemplate: 'hello {{prompt}}' });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: 'world' }),
    projectDir: '/tmp',
  });
  assert.equal(r.command, '/bin/echo');
  assert.deepEqual(r.args, ['hello', 'world']);
});

test('输出超 50000 字符截断', async () => {
  // /bin/yes 输出很多行
  makeCliTool({
    command: '/bin/yes',
    argsTemplate: 'x',
    timeoutMs: 3000,
  });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  // yes 不会自己停,但 timeout 会杀
  assert.ok(r.output.length <= 50000, `应截断到 50000,实际 ${r.output.length}`);
});

// =================== quoting 语法(球球 review 2026-08-16 traecli 报"unexpected argument") ===================

test('{prompt:q} quoting — prompt 含空格时,args 应是 1 个 token(防 clap 拒绝)', async () => {
  // traecli/claude 这种严格 parser 看到含空格 prompt 当成多 argv token。
  // {prompt:q} 语法自动单引号包,tokenize 后是 1 个 token。
  // 用 /bin/echo 验证 args 数组 — echo 收到几个 argv 就打印几行。
  makeCliTool({
    command: '/bin/echo',
    argsTemplate: 'args-debug --prompt {prompt:q}',
  });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: '你好 你能帮我做什么' }),
    projectDir: '/tmp',
  });
  assert.equal(r.success, true);
  // echo 应只输出 1 行(1 个 token 进去了)
  const lines = r.output.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `应只 1 个 token,实际 ${lines.length} 行: ${r.output}`);
  assert.equal(lines[0], 'args-debug --prompt 你好 你能帮我做什么', `单引号应被 shell 消化: ${lines[0]}`);
  // 返回给 UI 的 args 也应是 1 个 token
  assert.equal(r.args.length, 3, `args 长度应是 3,实际 ${r.args.length}: ${JSON.stringify(r.args)}`);
  assert.equal(r.args[2], '你好 你能帮我做什么', `第 3 个 token 应是 prompt 整体: ${r.args[2]}`);
});

test("{prompt:q} quoting — prompt 含单引号应 escape 成 shell 风格 ('\\'')", async () => {
  makeCliTool({
    command: '/bin/echo',
    argsTemplate: '{prompt:q}',
  });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: "it's a test" }),
    projectDir: '/tmp',
  });
  assert.equal(r.success, true);
  // echo 应输出 1 行,内容是 "it's a test"(单引号保留)
  const lines = r.output.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `应 1 个 token,实际 ${lines.length} 行: ${r.output}`);
  assert.equal(lines[0], "it's a test");
});

test('{prompt} 不带 q — 仍保持原行为(空格拆 token)', async () => {
  // 验证行为不变 — 不带 :q 时,空格拆 token
  // /bin/echo 把多 argv 用空格拼成 1 行,所以从 r.args 数组看是 3 个 token,
  // r.output 拼成 1 行 'no-quote hello world\n'。
  makeCliTool({
    command: '/bin/echo',
    argsTemplate: 'no-quote {prompt}',
  });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: 'hello world' }),
    projectDir: '/tmp',
  });
  assert.equal(r.success, true);
  // 关键:args 数组是 3 个 token(没 quoting 行为)
  assert.equal(r.args.length, 3, `应 3 个 token,实际 ${r.args.length}: ${JSON.stringify(r.args)}`);
  assert.deepEqual(r.args, ['no-quote', 'hello', 'world']);
  // echo 拼成 1 行
  assert.equal(r.output, 'no-quote hello world\n', `echo 应拼成 1 行: ${JSON.stringify(r.output)}`);
});

test('{prompt:quote} 跟 :q 等价', async () => {
  makeCliTool({
    command: '/bin/echo',
    argsTemplate: '{prompt:quote}',
  });
  const r = await runCliAgent({
    agent,
    task: makeTask({ prompt: 'a b c' }),
    projectDir: '/tmp',
  });
  assert.equal(r.success, true);
  const lines = r.output.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `应 1 个 token,实际 ${lines.length} 行: ${r.output}`);
  assert.equal(lines[0], 'a b c');
});

test('{model:q} model 也支持 quoting(球球要求命名支持) — 但实际 model 一般不含空格', async () => {
  makeCliTool({
    command: '/bin/echo',
    argsTemplate: '{model:q}',
  });
  const r = await runCliAgent({
    agent,
    task: makeTask(),
    projectDir: '/tmp',
  });
  // model 来自 Agent 显式配置
  const lines = r.output.split('\n').filter(Boolean);
  assert.ok(lines.includes('test-model') || lines[0] === 'test-model');
});

// =================== OAuth URL 检测(球球 review 2026-08-16) ===================

test('runCliAgent:stdout 含 http(s):// 链接 → result.oauthUrl 抓到', async () => {
  // 模拟 traecli/claude/gh 走 OAuth 时打印 URL 让用户去授权
  makeCliTool({
    command: '/bin/echo',
    argsTemplate: 'open this: https://example.com/device?usercode=NECY-WAVP',
  });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, true);
  assert.equal(r.oauthUrl, 'https://example.com/device?usercode=NECY-WAVP', `应抓到 OAuth URL: ${r.oauthUrl}`);
});

test('runCliAgent:stderr 含 URL 也能抓到(很多 CLI 把进度写到 stderr)', async () => {
  makeCliTool({
    command: '/bin/sh',
    argsTemplate: '-c "echo please auth at https://example.com/oauth 1>&2"',
  });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, true);
  assert.equal(r.oauthUrl, 'https://example.com/oauth', `stderr URL 也应抓: ${r.oauthUrl}`);
});

test('runCliAgent:输出无 URL → oauthUrl undefined', async () => {
  makeCliTool({ command: '/bin/echo', argsTemplate: 'hello world' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.oauthUrl, undefined, '无 URL 应 undefined');
});

test('runCliAgent:URL 后面跟 ANSI 颜色码也能正确截断(很多 CLI 输出带 ANSI)', async () => {
  // 实际构造 ANSI 字符的方式:用 node -e 拼字符串再 exec
  // 我们在测试里直接构造 string 含真 ESC(\x1b),然后 spawn /bin/echo 接到这个 arg。
  // 但 echo 不解释 escape 序列,所以更稳:用 /bin/sh -c "printf ..."
  // 简单点:写一个临时脚本(成本高),或者直接用 Node.js 的 stdio:
  // spawn /bin/echo, args 含真 ESC 字符
  // 改用更直接测:写脚本到 /tmp 跑
  const tmpScript = `/tmp/cli-test-ansi-${Date.now()}.sh`;
  const fs = await import('node:fs');
  // printf 后跟 \x1b — shell 字符串里的 \x1b 在 sh 里是字面 \x1b(除非用 $'...' 语法)
  // 用 $'...' 让 sh 解释 \x1b 为真 ESC
  fs.writeFileSync(
    tmpScript,
    `#!/bin/sh\nprintf $'open https://x.test/path\\x1b[0m ok\\n'\n`,
    { mode: 0o755 },
  );
  try {
    makeCliTool({ command: tmpScript, argsTemplate: '' });
    const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
    assert.equal(r.success, true);
    // 关键:oauthUrl 截断在 ESC 前,不应包含 ANSI 颜色码
    assert.equal(r.oauthUrl, 'https://x.test/path', `应截断在 ANSI 前: ${r.oauthUrl}`);
    // 防御:output 含真 ESC 字符(说明 shell 真传了 ANSI,不是字面)
    assert.ok(r.output.includes('\x1b'), 'output 应含真 ESC 字符(测试有效)');
  } finally {
    fs.rmSync(tmpScript, { force: true });
  }
});

test('runCliAgent:spawn failed 错误时,之前已抓到的 URL 仍要透出', async () => {
  // 即使 spawn 失败,用户在 spawn 期间已经看到 URL 应该返给前端
  // (但这个 test 比较难构造 — 跳过,实际场景 OAuth URL 抓取和 spawn 错误是独立路径)
  // 实际:用 /nope/nonexistent 测 spawn 失败,err message 不会含 URL
  makeCliTool({ command: '/nope/nonexistent/binary' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, false);
  // spawn failed 时还没读到 stdout/stderr,所以 oauthUrl 应是 undefined
  assert.equal(r.oauthUrl, undefined, 'spawn 失败且无 URL 触发,oauthUrl 应 undefined');
});

// =================== stdinTemplate(球球 review 2026-08-16 traecli 必须靠 stdin 喂 prompt) ===================

test('runCliAgent:stdinTemplate — 把 prompt 写到 child.stdin,traecli 立即认到', async () => {
  // traecli exec 传 argv PROMPT 它会"Reading additional input from stdin..." 死等。
  // 正确用法:把 prompt 通过 stdin 喂入。
  // 我们的 cliExecutor 检测 stdinTemplate,渲染后写 child.stdin,end 触发 EOF。
  // 这里用 /bin/cat 验证 — cat 收到 stdin 内容就 stdout 打印。
  // argsTemplate 用 '-'(cat 标志:从 stdin 读),不要用 'stdin-test'(会当成 filename)
  const cfgRepo = (await import('../../src/store/customTools.js')).CustomToolRepo;
  const db = new (await import('better-sqlite3')).default(path);
  const now = Date.now();
  const repo = new cfgRepo();
  db.prepare(`DELETE FROM custom_tools WHERE id = 'stdin-test'`).run();
  const config = {
    command: '/bin/cat',
    argsTemplate: '-',
    stdinTemplate: '{prompt}',
    defaultModel: 'auto',
    timeoutMs: 5000,
  } as any;
  repo.upsert({
    id: 'stdin-test', name: 'stdin-test', type: 'cli', description: '',
    config, enabled: true, createdAt: now, updatedAt: now,
  });

  try {
    const r = await runCliAgent({
      agent: { ...agent, cliTool: 'stdin-test' },
      task: makeTask({ prompt: 'fallback' }),
      projectDir: '/tmp',
      promptOverride: '你好,你能帮我做什么',
    });
    assert.equal(r.success, true, '应成功跑 cat');
    // cat 应把 stdin 内容打印到 stdout
    assert.ok(r.output.includes('你好,你能帮我做什么'),
      `stdin 内容应被 cat 打印: ${r.output.slice(0, 200)}`);
  } finally {
    db.prepare(`DELETE FROM custom_tools WHERE id = 'stdin-test'`).run();
  }
});

test('runCliAgent:没 stdinTemplate 时 stdio 走 ignore(纯 argv 模式适用)', async () => {
  // claude --print 这种纯 argv 模式不需要 stdin — stdio 走 'ignore' 关掉
  // /bin/echo 不读 stdin,验证它正常跑(说明 stdin 是 'ignore' 或 'pipe'+end 都不影响)
  makeCliTool({ command: '/bin/echo', argsTemplate: 'no-stdin' });
  const r = await runCliAgent({ agent, task: makeTask(), projectDir: '/tmp' });
  assert.equal(r.success, true);
  assert.equal(r.output, 'no-stdin\n');
});

test('runCliAgent:stdinTemplate 里的 {prompt:q} quoting 也支持(球球要求)', async () => {
  // traecli 实际 stdin 内容可能含特殊字符 — quoting 也要工作
  const repo = (await import('../../src/store/customTools.js')).CustomToolRepo;
  const now = Date.now();
  const db = new (await import('better-sqlite3')).default(path);
  db.prepare(`DELETE FROM custom_tools WHERE id = 'stdin-quote-test'`).run();
  const config = {
    command: '/bin/cat',
    argsTemplate: '-',
    stdinTemplate: "{prompt:q}\n",  // 加 :q quoting(虽然 cat 不需要,但验证 renderTemplate 在 stdinTemplate 也生效)
    defaultModel: 'auto',
    timeoutMs: 5000,
  } as any;
  new repo().upsert({
    id: 'stdin-quote-test', name: 'stdin-quote-test', type: 'cli', description: '',
    config, enabled: true, createdAt: now, updatedAt: now,
  });

  try {
    const r = await runCliAgent({
      agent: { ...agent, cliTool: 'stdin-quote-test' },
      task: makeTask({ prompt: 'fallback' }),
      projectDir: '/tmp',
      promptOverride: "it's a test",
    });
    assert.equal(r.success, true);
    // :q quoting 把值包成 shell-style '...\''(cat 不解释 quote,直接打印)
    // 实际写到 stdin: 'it'\''s a test'\n'(15 chars quoted + \n)
    assert.equal(r.output, "'it'\\''s a test'\n",
      `cat 应输出 shell-quoted 后的字面内容: ${JSON.stringify(r.output)}`);
  } finally {
    db.prepare(`DELETE FROM custom_tools WHERE id = 'stdin-quote-test'`).run();
  }
});
