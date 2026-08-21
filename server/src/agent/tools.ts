import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { resolve, dirname, basename, relative, join, sep, isAbsolute } from 'node:path';
import { glob as globFn } from 'node:fs/promises';
import type { ToolDefinition } from '../llm/types.js';
import { safeFetch } from '../utils/safeFetch.js';

const execAsync = promisify(exec);

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  output: string;
  /** 副作用产生的文件(供任务记录) */
  producedFiles?: string[];
}

/**
 * 工具执行器签名
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

/**
 * 工具执行上下文
 */
export interface ToolContext {
  /** 当前工作目录(通常是项目目录) */
  cwd: string;
  /** 公司根目录 */
  companyRoot: string;
  /** agent id */
  agentId: string;
  /** task id */
  taskId: string;
}

class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();
  private definitions = new Map<string, ToolDefinition>();
  /** alias 映射:alias → 正式名 */
  private aliases = new Map<string, string>();

  register(def: ToolDefinition, handler: ToolHandler, aliases: string[] = []): void {
    this.definitions.set(def.name, def);
    this.handlers.set(def.name, handler);
    for (const a of aliases) {
      this.aliases.set(a, def.name);
    }
  }

  /**
   * 注册一个 alias → canonical 的映射(不创建新的 handler)
   * 用于已有别名机制:alias 通过 register 注册了同 handler 的 def,
   * 但 resolveName 需要 alias → canonical 而不是 alias → alias。
   */
  addAlias(alias: string, canonical: string): void {
    this.aliases.set(alias, canonical);
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name) ?? this.handlers.get(this.aliases.get(name) ?? '');
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.definitions.get(name) ?? this.definitions.get(this.aliases.get(name) ?? '');
  }

  /** 把 alias 名解析为正式名 */
  resolveName(name: string): string {
    return this.aliases.get(name) ?? name;
  }

  /**
   * 取所有定义(传给 LLM)
   */
  listDefinitions(): ToolDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * 按名字列表取定义(agent 只能看到分配的工具)
   * 包含 alias 解析
   */
  listForNames(names: string[]): ToolDefinition[] {
    const seen = new Set<string>();
    const result: ToolDefinition[] = [];
    for (const n of names) {
      const resolved = this.resolveName(n);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const def = this.definitions.get(resolved);
      if (def) result.push(def);
    }
    return result;
  }
}

export const tools = new ToolRegistry();

function resolveWorkspacePath(cwd: string, requestedPath: unknown): string {
  const workspace = resolve(cwd);
  const resolved = resolve(workspace, String(requestedPath));
  const rel = relative(workspace, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('路径必须位于当前项目工作目录内');
  }
  return resolved;
}

// ──────────────────────────────────────────────────────
// bash - 执行 shell 命令
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'bash',
    description:
      '执行 shell 命令。返回 stdout + stderr。cwd 是当前项目目录。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        timeout: { type: 'number', description: '超时(毫秒),默认 60000' },
      },
      required: ['command'],
    },
  },
  async (input, ctx) => {
    const command = String(input.command ?? '');
    const timeout = Number(input.timeout ?? 60000);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        // 不将 Provider API key 等宿主进程环境暴露给 Agent 命令。
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: ctx.cwd,
          TMPDIR: process.env.TMPDIR ?? '/tmp',
          FORCE_COLOR: '0',
        },
      });
      const output = [stdout, stderr].filter(Boolean).join('\n');
      return { success: true, output: output.slice(0, 50000) };
    } catch (e: any) {
      return {
        success: false,
        output: `STDOUT: ${e.stdout ?? ''}\nSTDERR: ${e.stderr ?? e.message}`,
      };
    }
  },
);

// ──────────────────────────────────────────────────────
// read - 读取文件
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'read',
    description: '读取文件内容。路径相对于 cwd。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        start: { type: 'number', description: '起始行(0-indexed)' },
        end: { type: 'number', description: '结束行(0-indexed,不包含)' },
      },
      required: ['path'],
    },
  },
  async (input, ctx) => {
    const p = resolveWorkspacePath(ctx.cwd, input.path);
    if (!existsSync(p)) {
      return { success: false, output: `File not found: ${p}` };
    }
    try {
      const stat = statSync(p);
      if (stat.isDirectory()) {
        const files = readdirSync(p);
        return { success: true, output: `Directory contents:\n${files.join('\n')}` };
      }
      const content = readFileSync(p, 'utf-8');
      const lines = content.split('\n');
      const start = Number(input.start ?? 0);
      const end = Number(input.end ?? lines.length);
      const slice = lines.slice(start, end).map((l, i) => `${start + i + 1}\t${l}`).join('\n');
      return {
        success: true,
        output: slice,
        producedFiles: [p],
      };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  },
);

// ──────────────────────────────────────────────────────
// write - 写文件
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'write',
    description:
      '写入文件(覆盖)。如果父目录不存在会自动创建。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径(相对 cwd)' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  async (input, ctx) => {
    const p = resolveWorkspacePath(ctx.cwd, input.path);
    const content = String(input.content ?? '');
    try {
      const dir = dirname(p);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(p, content, 'utf-8');
      return {
        success: true,
        output: `Written ${content.length} bytes to ${p}`,
        producedFiles: [p],
      };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  },
);

// ──────────────────────────────────────────────────────
// edit - 精确编辑(基于字符串替换)
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'edit',
    description:
      '精确字符串替换编辑。old_string 必须唯一,否则报错。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: '要替换的字符串(必须唯一)' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean', description: '是否替换所有出现' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  async (input, ctx) => {
    const p = resolveWorkspacePath(ctx.cwd, input.path);
    if (!existsSync(p)) return { success: false, output: `File not found: ${p}` };
    const oldString = String(input.old_string);
    const newString = String(input.new_string);
    const replaceAll = Boolean(input.replace_all);
    try {
      const original = readFileSync(p, 'utf-8');
      let count = 0;
      let next = original;
      if (replaceAll) {
        next = original.split(oldString).join(newString);
        count = (original.match(new RegExp(oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
      } else {
        const idx = original.indexOf(oldString);
        if (idx === -1) {
          return {
            success: false,
            output: `old_string not found in ${p}`,
          };
        }
        const second = original.indexOf(oldString, idx + oldString.length);
        if (second !== -1) {
          return {
            success: false,
            output: `old_string occurs multiple times in ${p}. Use replace_all=true or be more specific.`,
          };
        }
        next = original.slice(0, idx) + newString + original.slice(idx + oldString.length);
        count = 1;
      }
      writeFileSync(p, next, 'utf-8');
      return {
        success: true,
        output: `Replaced ${count} occurrence(s) in ${p}`,
        producedFiles: [p],
      };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  },
);

// ──────────────────────────────────────────────────────
// glob - 文件匹配
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'glob',
    description: '按 glob 模式找文件。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式,例如 **/*.ts' },
      },
      required: ['pattern'],
    },
  },
  async (input, ctx) => {
    const pattern = String(input.pattern);
    try {
      const matches: string[] = [];
      for await (const m of globFn(pattern, { cwd: ctx.cwd })) {
        matches.push(m);
        if (matches.length >= 200) break;
      }
      return {
        success: true,
        output: matches.length > 0 ? matches.join('\n') : '(no matches)',
      };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  },
);

// ──────────────────────────────────────────────────────
// grep - 内容搜索
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'grep',
    description: '在文件中搜索文本。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '要搜索的正则' },
        path: { type: 'string', description: '搜索目录,默认 cwd' },
        include: { type: 'string', description: 'glob filter,例如 *.ts' },
      },
      required: ['pattern'],
    },
  },
  async (input, ctx) => {
    const pattern = String(input.pattern);
    const basePath = String(input.path ?? '.');
    const include = input.include ? String(input.include) : undefined;
    try {
      const { stdout } = await execAsync(
        `grep -rn ${include ? `--include="${include}" ` : ''}"${pattern.replace(/"/g, '\\"')}" ${basePath} 2>/dev/null | head -100`,
        { cwd: ctx.cwd, maxBuffer: 1024 * 1024 },
      );
      return {
        success: true,
        output: stdout || '(no matches)',
      };
    } catch (e: any) {
      return { success: true, output: e.stdout || '(no matches)' };
    }
  },
);

// ──────────────────────────────────────────────────────
// list_files - 列出目录
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'list_files',
    description: '列出目录内容,包含文件大小。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径,默认 cwd' },
        recursive: { type: 'boolean', description: '是否递归' },
        maxDepth: { type: 'number', description: '递归最大深度' },
      },
    },
  },
  async (input, ctx) => {
    const p = resolveWorkspacePath(ctx.cwd, input.path ?? '.');
    if (!existsSync(p)) return { success: false, output: 'Directory not found' };
    const recursive = Boolean(input.recursive);
    const maxDepth = Number(input.maxDepth ?? 3);
    try {
      const lines: string[] = [];
      const walk = (dir: string, depth: number) => {
        if (depth > maxDepth) return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const full = join(dir, e.name);
          const rel = relative(ctx.cwd, full);
          if (e.isDirectory()) {
            lines.push(`📁 ${rel}/`);
            if (recursive) walk(full, depth + 1);
          } else {
            const stat = statSync(full);
            lines.push(`📄 ${rel} (${stat.size}B)`);
          }
        }
      };
      walk(p, 0);
      return { success: true, output: lines.join('\n') || '(empty)' };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  },
);

// ──────────────────────────────────────────────────────
// web_fetch - 抓取网页
// ──────────────────────────────────────────────────────
tools.register(
  {
    name: 'web_fetch',
    description: '抓取网页内容(纯文本)。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标 URL(http/https 公网,内网地址会被拒)' },
        maxLength: { type: 'number', description: '最大返回字符数,默认 5000' },
      },
      required: ['url'],
    },
  },
  async (input) => {
    const url = String(input.url);
    const maxLength = Number(input.maxLength ?? 5000);
    try {
      // 球球 review C4: web_fetch 接受 user-supplied URL,必须 SSRF deny-list
      const res = await safeFetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 AgentCompany/0.1' },
      }, { timeoutMs: 15000 });
      if (!res.ok) return { success: false, output: `HTTP ${res.status}` };
      const text = await res.text();
      const stripped = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        success: true,
        output: stripped.slice(0, maxLength),
      };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  },
);

// ──────────────────────────────────────────────────────
// 工具名列表(供 company.yaml / agent 配置引用)
// 兼容球球 yaml 里的旧命名
// ──────────────────────────────────────────────────────
export const BUILTIN_TOOL_NAMES = [
  'bash',
  'read', 'read_file',     // read_file 别名
  'write', 'write_file',   // write_file 别名
  'edit', 'edit_file',      // edit_file 别名
  'glob', 'find',           // find 别名
  'grep', 'search',         // search 别名
  'list_files', 'ls', 'list_dir',  // list_dir 别名
  'web_fetch', 'web_search', 'fetch',  // web_search/fetch 别名
];

// ──────────────────────────────────────────────────────
// 注册工具别名映射(让 yaml 里的 read_file 等能解析到 read handler)
// ──────────────────────────────────────────────────────
const TOOL_ALIASES: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  edit_file: 'edit',
  find: 'glob',
  search: 'grep',
  ls: 'list_files',
  list_dir: 'list_files',
  web_search: 'web_fetch',
  fetch: 'web_fetch',
};
for (const [alias, canonical] of Object.entries(TOOL_ALIASES)) {
  const def = tools.getDefinition(canonical);
  if (def) {
    tools.register(
      { ...def, name: alias },
      (input, ctx) => tools.get(canonical)!(input, ctx),
    );
    // 显式登记 alias → canonical(override register 里 alias→alias 的默认行为)
    tools.addAlias(alias, canonical);
  }
}
