/**
 * 自定义工具(User-defined tools in Web → 设置 → Tools)
 *
 * 三种类型:
 * - http:   把 input 当作请求体 / query,调用远端 HTTP endpoint
 * - shell:  执行 shell 命令模板,{{paramName}} 占位
 * - prompt: 拼一段 prompt 文本(其实是 skill 的弱化版,但作为 LLM-callable tool 暴露)
 *
 * 启动时由 server/src/index.ts 调 loadCustomTools() 注册到 ToolRegistry
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { tools, type ToolContext, type ToolResult } from './tools.js';
import type { ToolDefinition } from '../llm/types.js';
import { safeFetch } from '../utils/safeFetch.js';
import {
  CustomToolRepo,
  type StoredCustomTool,
  type CustomToolType,
  type HttpToolConfig,
  type ShellToolConfig,
  type PromptToolConfig,
} from '../store/customTools.js';

const execAsync = promisify(exec);

/**
 * 模板替换:把 {{name}} 占位替换成 input.name(string | number)
 */
function renderTemplate(tpl: string, input: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = input[key];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

/**
 * 从 input 提取所有 {{xxx}} 占位的 key
 */
function extractParams(tpl: string): string[] {
  const out = new Set<string>();
  for (const m of tpl.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (m[1]) out.add(m[1]);
  }
  return Array.from(out);
}

// ─── http executor ─────────────────────────────────────
async function executeHttp(
  cfg: HttpToolConfig,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const method = (cfg.method ?? 'POST').toUpperCase();
  const bodyMode = cfg.bodyMode ?? 'json';
  const timeout = cfg.timeoutMs ?? 30000;

  let url = cfg.url;
  const headers: Record<string, string> = { ...(cfg.headers ?? {}) };
  if (cfg.bearerToken) headers['Authorization'] = `Bearer ${cfg.bearerToken}`;

  let body: string | undefined;
  const init: RequestInit = { method, headers };

  if (method === 'GET' || method === 'DELETE') {
    // 全部塞到 query string
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(input)) {
      qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    if (Array.from(qs.keys()).length > 0) {
      url += (url.includes('?') ? '&' : '?') + qs.toString();
    }
  } else {
    if (bodyMode === 'query') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(input)) {
        qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      url += (url.includes('?') ? '&' : '?') + qs.toString();
    } else if (bodyMode === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(input)) {
        qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      body = qs.toString();
    } else {
      // json
      headers['Content-Type'] ??= 'application/json';
      body = JSON.stringify(input);
    }
  }

  if (body !== undefined) init.body = body;

  try {
    // 球球 review C4: HTTP custom tool 接受 user-configured URL,必须 SSRF deny-list
    // (User 在 Web UI 配的 URL,可能是任意公网也可能是内网;内网全部拒)
    const res = await safeFetch(url, init, { timeoutMs: timeout });
    const text = await res.text();
    const ok = res.ok;
    return {
      success: ok,
      output: ok
        ? text.slice(0, 50000)
        : `HTTP ${res.status}\n${text.slice(0, 5000)}`,
    };
  } catch (e: any) {
    return { success: false, output: e.message ?? String(e) };
  }
}

// ─── shell executor ────────────────────────────────────
async function executeShell(
  cfg: ShellToolConfig,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  void cfg;
  void input;
  void ctx;
  return {
    success: false,
    output: '自定义 Shell 工具已禁用：无法在非沙箱环境中安全执行由模型或模板生成的命令。',
  };
  /*
  // 校验必填参数
  for (const p of cfg.params) {
    if (input[p] === undefined || input[p] === null || input[p] === '') {
      return { success: false, output: `Missing required param: ${p}` };
    }
  }
  const command = renderTemplate(cfg.command, input);
  const timeout = cfg.timeoutMs ?? 60000;
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: ctx.cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const output = [stdout, stderr].filter(Boolean).join('\n');
    return { success: true, output: output.slice(0, 50000) };
  } catch (e: any) {
    return {
      success: false,
      output: `STDOUT: ${e.stdout ?? ''}\nSTDERR: ${e.stderr ?? e.message}`,
    };
  }
  */
}

// ─── prompt executor ───────────────────────────────────
function executePrompt(cfg: PromptToolConfig, input: Record<string, unknown>): ToolResult {
  const text = renderTemplate(cfg.template, input);
  return { success: true, output: text };
}

// ─── definition builders ───────────────────────────────
function buildHttpDefinition(t: StoredCustomTool): ToolDefinition {
  const cfg = t.config as HttpToolConfig;
  return {
    name: t.name,
    description: t.description || `HTTP ${cfg.method ?? 'POST'} ${cfg.url}`,
    inputSchema: {
      type: 'object',
      properties: {}, // 任意输入
      // 不写 required — 任意字段都会塞进 body/query
    },
  };
}

function buildShellDefinition(t: StoredCustomTool): ToolDefinition {
  const cfg = t.config as ShellToolConfig;
  const properties: Record<string, unknown> = {};
  for (const p of cfg.params) {
    properties[p] = { type: 'string', description: `参数 ${p}` };
  }
  // 自动补全 template 里的占位
  for (const p of extractParams(cfg.command)) {
    if (!properties[p]) properties[p] = { type: 'string', description: `参数 ${p}` };
  }
  return {
    name: t.name,
    description: t.description || `Shell: ${cfg.command}`,
    inputSchema: {
      type: 'object',
      properties,
      required: cfg.params,
    },
  };
}

function buildPromptDefinition(t: StoredCustomTool): ToolDefinition {
  const cfg = t.config as PromptToolConfig;
  const properties: Record<string, unknown> = {};
  for (const p of extractParams(cfg.template)) {
    properties[p] = { type: 'string', description: `参数 ${p}` };
  }
  return {
    name: t.name,
    description: t.description || `Prompt template: ${cfg.template.slice(0, 40)}`,
    inputSchema: {
      type: 'object',
      properties,
    },
  };
}

// ─── registry wiring ───────────────────────────────────
const REGISTERED_NAMES = new Set<string>();

/**
 * 把一条 custom tool 注册到 ToolRegistry
 */
function registerOne(t: StoredCustomTool): void {
  if (!t.enabled) return;
  if (REGISTERED_NAMES.has(t.name)) {
    // 重名(应该被 unique 约束阻止,但防一手) — 跳过
    return;
  }
  const def =
    t.type === 'http'
      ? buildHttpDefinition(t)
      : t.type === 'shell'
      ? buildShellDefinition(t)
      : buildPromptDefinition(t);

  const handler = async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    if (t.type === 'http') return executeHttp(t.config as HttpToolConfig, input);
    if (t.type === 'shell') return executeShell(t.config as ShellToolConfig, input, ctx);
    return executePrompt(t.config as PromptToolConfig, input);
  };

  tools.register(def, handler);
  REGISTERED_NAMES.add(t.name);
}

function unregisterOne(name: string): void {
  if (!REGISTERED_NAMES.has(name)) return;
  // ToolRegistry 没有提供 unregister,所以我们用 reload 整体重建;
  // 暴露 reloadCustomTools() 给外部在增删改后调用即可
  REGISTERED_NAMES.delete(name);
}

/**
 * 重新从 DB 加载所有 custom tools(启动时 + 增删改后调用)
 */
export function reloadCustomTools(): { loaded: number; skipped: number } {
  // 先清掉已注册的(通过反射清空 registry 的内部 map)
  // 由于 ToolRegistry 没暴露 clear,我们用一个折中:让新名字生效,旧名字在被覆盖前仍然存在
  // — 但这会泄漏。比较干净的做法是在 ToolRegistry 上加 clear(),这里用类型 hack 调用私有字段
  const registry = tools as unknown as {
    handlers: Map<string, unknown>;
    definitions: Map<string, unknown>;
    aliases: Map<string, unknown>;
  };
  for (const name of REGISTERED_NAMES) {
    registry.handlers.delete(name);
    registry.definitions.delete(name);
  }
  REGISTERED_NAMES.clear();

  const repo = new CustomToolRepo();
  const all = repo.list();
  let loaded = 0;
  let skipped = 0;
  for (const t of all) {
    if (!t.enabled) {
      skipped++;
      continue;
    }
    try {
      registerOne(t);
      loaded++;
    } catch (e) {
      // 名字冲突 / 非法,跳过
      skipped++;
    }
  }
  return { loaded, skipped };
}

/**
 * 列出所有可被 agent 调用的 tool(builtin + custom)
 */
export function listAllToolDefinitions(): {
  builtin: ToolDefinition[];
  custom: ToolDefinition[];
} {
  const defs = tools.listDefinitions();
  const builtin: ToolDefinition[] = [];
  const custom: ToolDefinition[] = [];
  for (const d of defs) {
    if (REGISTERED_NAMES.has(d.name)) custom.push(d);
    else builtin.push(d);
  }
  return { builtin, custom };
}

/**
 * 测试一个 custom tool(不真正注册到 agent,直接执行)
 * 用于"测试"按钮
 */
export async function testCustomTool(
  type: CustomToolType,
  config: HttpToolConfig | ShellToolConfig | PromptToolConfig,
  input: Record<string, unknown>,
  ctx: { cwd: string; companyRoot: string },
): Promise<ToolResult> {
  const toolCtx: ToolContext = {
    cwd: ctx.cwd,
    companyRoot: ctx.companyRoot,
    agentId: 'test',
    taskId: 'test',
  };
  if (type === 'http') return executeHttp(config as HttpToolConfig, input);
  if (type === 'shell') return executeShell(config as ShellToolConfig, input, toolCtx);
  if (type === 'prompt') return executePrompt(config as PromptToolConfig, input);
  return { success: false, output: `不支持的 type: ${type} — 如果是 cli 工具,直接在 Agent 上配 executor=cli,不要作为 LLM-callable tool` };
}
