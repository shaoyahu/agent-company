/**
 * CLI Executor — agent 接到任务时直接 spawn 本地 CLI(claude code / trae cli)
 *
 * 与 LLM executor 的区别:
 *   - LLM executor: 走 chat loop,LLM 自主调工具,可以 streaming
 *   - CLI executor: 一次调用,把 task.prompt 灌进 CLI,等结束(后续做 streaming)
 *
 * 用法:
 *   - AgentConfig.executor === 'cli' 时 runtime 调本模块
 *   - agent.cliTool 引用 custom_tools 表里 type='cli' 的工具
 *   - tool.config: { command, argsTemplate, defaultModel, timeoutMs, env }
 *
 * argsTemplate 用 {{key}} 占位:
 *   - {{prompt}} → task.prompt
 *   - {{model}}  → 优先 input.model,否则 defaultModel
 *   - {{cwd}}    → 项目目录；组织架构对话等无项目会话为空串
 *   - {{name}}   → agent.name
 */

import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, realpathSync } from 'node:fs';
import { CustomToolRepo, type CliToolConfig, type StoredCustomTool } from '../store/customTools.js';
import type { AgentConfig, Task } from '../types/company.js';

export interface CliRunInput {
  agent: AgentConfig;
  task: Task;
  /** 项目任务传真实目录；组织架构对话不传,表示无文件夹会话 */
  projectDir?: string;
  /** 可选 override,比如用户在 UI 上临时改 model */
  modelOverride?: string;
  /** 可选 override,比如 input 里传 "task": "commit these changes" */
  promptOverride?: string;
}

export interface CliRunResult {
  success: boolean;
  /** CLI 进程的 stdout */
  output: string;
  /** CLI 退出码 */
  exitCode: number | null;
  /** 实际 spawn 的命令(调试用) */
  command: string;
  args: string[];
  /** ms 耗时 */
  durationMs: number;
  /**
   * 球球 review 2026-08-16:spawn 期间如果 stdout/stderr 出现 http(s):// 链接
   * (典型 OAuth / SSO / device flow 提示),抓出来给前端弹 toast 让用户能点。
   * - 第一次出现的 URL 保留(后续覆盖也没意义)
   * - 适用于 traecli / claude code / gh / 任何 CLI 走 OAuth
   */
  oauthUrl?: string;
}

/** 在 chunk 里检测第一个 http(s):// 链接(忽略 ANSI 颜色码) */
const URL_RE = /https?:\/\/[^\s\x1b]+/;
function extractUrlFromChunk(chunk: string): string | undefined {
  const m = chunk.match(URL_RE);
  return m?.[0];
}

/** 替换 {{key}} 或 {key} 占位 — 两种都支持,跟用户输入习惯兼容
 * 球球 review 2026-08-16:加 `{key:q}` quoting 后缀 — prompt 含空格会被 clap 等
 * 严格 parser 当成多个 argv token 拆开("unexpected argument")。`:q` 把值
 * 用单引号包,tokenize 看到 `'…'` 会当成单 token。
 *   - `{prompt}`      → "hello world"        → tokenize 拆 2 个
 *   - `{prompt:q}`    → "'hello world'"      → tokenize 单 token
 *   - `{prompt:quote}`→ 同上
 * 内部单引号 escape 成 `'\''`,shell-style 拼接。
 */
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{\{\s*([a-zA-Z0-9_]+)(?::(?:q|quote))?\s*\}\}/g, (_m, key: string, offset: number, full: string) => {
      // 看后缀是 :q / :quote
      // 简单办法:从 full 中取 token 块判断。但 ts regex replace 不易做。
      // 退化:双 brace 暂不支持 quoting(目前用法是单 brace),保持空替换。
      return vars[key] ?? '';
    })
    .replace(/\{([a-zA-Z0-9_]+)(?::(q|quote))?\}/g, (_m, key: string, quoteFlag) => {
      const v = vars[key] ?? `{${key}}`;
      if (!quoteFlag) return v;
      // 单引号 escape: ' → '\''
      const escaped = v.replace(/'/g, "'\\''");
      return `'${escaped}'`;
    });
}

/** 解析 argsTemplate 里的 token 化(支持简单引号,模仿 shell 行为)
 * 球球 review 2026-08-16:之前只 quote 内识别 `\` escape — quote 外 `\` 当字面。
 * 这跟 shell 行为不一致,导致 `{prompt:q}` escape 后的 `'\''`(shell-style
 * 单引号转义)在 quote 外看到 `\` 直接当字符,丢掉单引号。
 * 修:quote 内外都把 `\` 当 escape(取下一个字符字面)。
 */
export function tokenizeArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) { quote = null; }
      else if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; }
      else { cur += ch; }
    } else {
      if (ch === '"' || ch === "'") { quote = ch; }
      else if (ch === ' ' || ch === '\t') {
        if (cur) { out.push(cur); cur = ''; }
      }
      // 球球 review 2026-08-16:quote 外的 `\` 也当 escape,模拟 shell。
      // 这样 `{prompt:q}` 后的 `'it'\''s a test'` 能正确 tokenize 成
      // ["it's", "a", "test"](第一个 token 含字面单引号)。
      else if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; }
      else { cur += ch; }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 把 argsTemplate + vars 变成 spawn 的 args 数组 */
function buildArgs(argsTemplate: string, vars: Record<string, string>): string[] {
  return tokenizeArgs(renderTemplate(argsTemplate, vars));
}

function normalizeArgs(toolName: string, model: string, args: string[]): string[] {
  if (toolName !== 'trae-cli') return args;

  const normalized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    normalized.push(arg);
  }

  const hasPermissionMode = normalized.some(arg =>
    arg === '--sandbox'
    || arg === '-s'
    || arg.startsWith('--sandbox=')
    || arg === '--permission-mode'
    || arg.startsWith('--permission-mode=')
    || arg === '-y'
    || arg === '--dangerously-bypass-approvals-and-sandbox',
  );
  if (!hasPermissionMode) normalized.push('--sandbox', 'workspace-write');
  return normalized;
}

function inspectPath(path: string) {
  try {
    const stat = lstatSync(path);
    return {
      exists: true,
      isSymlink: stat.isSymbolicLink(),
      mode: `0${(stat.mode & 0o777).toString(8)}`,
      realpath: realpathSync(path),
      statError: '',
    };
  } catch (error) {
    return {
      exists: false,
      isSymlink: false,
      mode: '',
      realpath: '',
      statError: error instanceof Error ? error.message : String(error),
    };
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function formatSpawnDiagnostics(input: {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  error?: NodeJS.ErrnoException;
}): string {
  const commandInfo = inspectPath(input.command);
  const cwdInfo = input.cwd ? inspectPath(input.cwd) : null;
  const spawnError = input.error as (NodeJS.ErrnoException & { spawnargs?: string[] }) | undefined;
  const lines = [
    'CLI 诊断:',
    `command: ${input.command}`,
    `commandExists: ${commandInfo.exists}`,
    `commandExecutable: ${isExecutable(input.command)}`,
    `commandIsSymlink: ${commandInfo.isSymlink}`,
    `commandMode: ${commandInfo.mode || '<unknown>'}`,
    `commandRealpath: ${commandInfo.realpath || '<unresolved>'}`,
    `commandStatError: ${commandInfo.statError || '<none>'}`,
    `argsCount: ${input.args.length}`,
    `cwd: ${input.cwd ?? '<无 cwd>'}`,
    `cwdExists: ${cwdInfo ? cwdInfo.exists : '<not-applicable>'}`,
    `effectiveCwd: ${input.cwd ?? process.cwd()}`,
    `PATH: ${input.env.PATH ?? ''}`,
    `HOME: ${input.env.HOME ?? ''}`,
    `SHELL: ${input.env.SHELL ?? ''}`,
    `platform: ${process.platform}`,
    `arch: ${process.arch}`,
    `execPath: ${process.execPath}`,
  ];
  if (spawnError) {
    lines.push(
      `errorName: ${spawnError.name}`,
      `errorCode: ${spawnError.code ?? '<none>'}`,
      `errorErrno: ${spawnError.errno ?? '<none>'}`,
      `errorSyscall: ${spawnError.syscall ?? '<none>'}`,
      `errorPath: ${spawnError.path ?? '<none>'}`,
      `errorSpawnargs: ${JSON.stringify(spawnError.spawnargs ?? [])}`,
    );
  }
  return lines.join('\n');
}

/**
 * 跑一次 CLI,返回结果(MVP: 等结束一次性返回,不做 streaming)
 */
export function runCliAgent(input: CliRunInput): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const start = Date.now();

    // 找 CLI tool
    const repo = new CustomToolRepo();
    const tool: StoredCustomTool | null = input.agent.cliTool ? repo.getByName(input.agent.cliTool) : null;
    if (!tool) {
      resolve({
        success: false,
        output: `agent.cliTool="${input.agent.cliTool ?? ''}" 找不到对应的 CLI tool(去「设置 → Tools」加一个 type=cli 的)`,
        exitCode: null,
        command: '',
        args: [],
        durationMs: 0,
      });
      return;
    }
    if (tool.type !== 'cli') {
      resolve({
        success: false,
        output: `tool "${tool.name}" 是 type=${tool.type},不是 cli`,
        exitCode: null,
        command: '',
        args: [],
        durationMs: 0,
      });
      return;
    }
    if (!tool.enabled) {
      resolve({
        success: false,
        output: `tool "${tool.name}" 已被禁用`,
        exitCode: null,
        command: '',
        args: [],
        durationMs: 0,
      });
      return;
    }
    const cfg = tool.config as CliToolConfig;
    if (!cfg.command || !existsSync(cfg.command)) {
      resolve({
        success: false,
        output: `CLI 不存在: ${cfg.command}`,
        exitCode: null,
        command: cfg.command,
        args: [],
        durationMs: 0,
      });
      return;
    }

    // 拼参数
    const model = input.modelOverride ?? input.agent.cliModel;
    if (!model?.trim()) {
      resolve({
        success: false,
        output: `Agent '${input.agent.id}' 未选择 CLI 模型`,
        exitCode: null,
        command: cfg.command,
        args: [],
        durationMs: Date.now() - start,
      });
      return;
    }
    const prompt = input.promptOverride || input.task.prompt;
    const vars: Record<string, string> = {
      prompt,
      model,
      cwd: input.projectDir ?? '',
      name: input.agent.name ?? input.agent.id,
      id: input.agent.id,
      task: input.task.title,
    };
    const args = normalizeArgs(tool.name, model, buildArgs(cfg.argsTemplate, vars));

    // spawn
    // 球球 review 2026-08-16:traecli 这种 CLI 必须靠 stdin 喂 prompt
    // (传 argv 它仍说 "Reading additional input from stdin..." 等 EOF),
    // 而 claude --print 这种纯 argv 模式不需要 stdin。
    // 修法:tool config 加可选 stdinTemplate — 如果有,改成 pipe stdin,
    // 渲染后内容写到 child.stdin 然后 end(EOF),traecli 立即处理。
    // 没有 stdinTemplate 时,stdio 'ignore' 关 stdin(适用于纯 argv 模式)。
    const hasStdinTemplate = !!cfg.stdinTemplate;
    const spawnEnv = { ...process.env, ...(cfg.env ?? {}) };
    const child = spawn(cfg.command, args, {
      ...(input.projectDir ? { cwd: input.projectDir } : {}),
      env: spawnEnv,
      timeout: cfg.timeoutMs ?? 600_000,
      stdio: hasStdinTemplate ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    if (hasStdinTemplate) {
      // 渲染 + 写到 stdin + EOF
      const stdinText = renderTemplate(cfg.stdinTemplate!, vars);
      child.stdin?.end(stdinText);
    }

    let stdout = '';
    let stderr = '';
    let oauthUrl: string | undefined;
    child.stdout?.on('data', (chunk) => {
      const s = chunk.toString('utf-8');
      stdout += s;
      // 球球 review 2026-08-16:spawn 期间检测 OAuth URL — traecli / claude / gh
      // 等 CLI 走 SSO / device flow 会打印 https://... 让用户去浏览器授权。
      // 第一次抓到的 URL 保留(后续 chunk 不覆盖),close 时透出给前端。
      if (!oauthUrl) {
        const url = extractUrlFromChunk(s);
        if (url) oauthUrl = url;
      }
    });
    child.stderr?.on('data', (chunk) => {
      const s = chunk.toString('utf-8');
      stderr += s;
      if (!oauthUrl) {
        const url = extractUrlFromChunk(s);
        if (url) oauthUrl = url;
      }
    });

    child.on('error', (err) => {
      const diagnostics = formatSpawnDiagnostics({
        command: cfg.command,
        args,
        cwd: input.projectDir,
        env: spawnEnv,
        error: err as NodeJS.ErrnoException,
      });
      console.error(`[cliExecutor] spawn failed\n${diagnostics}`);
      resolve({
        success: false,
        output: `spawn failed: ${err.message}\n\n${diagnostics}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
        exitCode: null,
        command: cfg.command,
        args,
        durationMs: Date.now() - start,
        oauthUrl,
      });
    });

    child.on('close', (code) => {
      const ok = code === 0;
      // 输出优先级: stdout(成功时)/ stderr(失败时) — 拼一起给 UI
      const output = ok
        ? (stdout || stderr)
        : `exit ${code}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`;
      resolve({
        success: ok,
        output: output.slice(0, 50000),
        exitCode: code,
        command: cfg.command,
        args,
        durationMs: Date.now() - start,
        oauthUrl,
      });
    });
  });
}
