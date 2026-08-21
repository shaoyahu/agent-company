/**
 * Settings Helper Agent
 *
 * 一个**隔离的** chat loop,专门服务 Tools/Skills 设置页里的对话框:
 * - 有自己的 6 个 meta-tools(create/update/delete tool, install/uninstall/get skill)
 * - 这些 meta-tools **不**注册到全局 ToolRegistry,普通 agent 看不到
 * - 系统 prompt 包含:身份 + 启用的 meta-skills + 当前 tab 上下文 + 已有的 tools/skills 列表
 *
 * 调用方式:runHelperAgent({tab, messages, llmId, llmRegistry, customTools, skills, customToolsHtml})
 */

import type { LLMRegistry } from '../llm/registry.js';
import type { LLMMessage, ToolCall, ChatResponse } from '../llm/types.js';
import { readFileSync } from 'node:fs';
import { CustomToolRepo, type CustomToolType } from '../store/customTools.js';
import {
  listSkills,
  getSkill,
  installFromContent,
  installFromUrl,
  installFromUpload,
  uninstallSkill,
  type SkillMeta,
} from '../skills/scanner.js';
import { reloadCustomTools } from './customTools.js';

// ─── 6 个 meta-tool 的定义 ────────────────────────────────────────
export const HELPER_TOOL_DEFS: Array<{
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}> = [
  {
    name: 'create_custom_tool',
    description: '创建一个新的自定义 tool。type 必填,config 根据 type 写。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '调用名(小写/下划线/短横线)' },
        type: { type: 'string', enum: ['http', 'shell', 'prompt'], description: '工具类型' },
        description: { type: 'string', description: '给 agent 看的描述' },
        config: { type: 'object', description: '配置 JSON,根据 type 不同' },
        enabled: { type: 'boolean', description: '默认 true' },
      },
      required: ['name', 'type', 'config'],
    },
  },
  {
    name: 'update_custom_tool',
    description: '更新一个已存在的 custom tool(按 name 查)。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要更新的 tool 名' },
        description: { type: 'string' },
        config: { type: 'object' },
        enabled: { type: 'boolean' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_custom_tool',
    description: '删除一个 custom tool。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '要删除的 tool 名' } },
      required: ['name'],
    },
  },
  {
    name: 'install_skill',
    description: '安装一个 skill。最常用 source=content(直接写 SKILL.md)。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['content', 'url', 'upload', 'hub'] },
        name: { type: 'string', description: '可选,留空用 frontmatter 里的' },
        content: { type: 'string', description: 'source=content 时必填,完整的 SKILL.md 文本(含 --- frontmatter ---)' },
        url: { type: 'string', description: 'source=url 时填' },
        fileBase64: { type: 'string', description: 'source=upload 时填' },
        filename: { type: 'string' },
      },
      required: ['source'],
    },
  },
  {
    name: 'uninstall_skill',
    description: '卸载一个 skill。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'skill 名' } },
      required: ['name'],
    },
  },
  {
    name: 'get_skill_content',
    description: '查看一个 skill 的完整 SKILL.md(便于修改/参考)。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'skill 名' } },
      required: ['name'],
    },
  },
];

// ─── 执行器 ────────────────────────────────────────
type ToolResult = { success: boolean; output: string; data?: any };

async function execCreateTool(input: Record<string, unknown>): Promise<ToolResult> {
  const name = String(input.name ?? '').trim();
  const type = String(input.type ?? '') as CustomToolType;
  if (!name || !['http', 'shell', 'prompt'].includes(type)) {
    return { success: false, output: 'name/type 必填且 type 必须是 http/shell/prompt' };
  }
  if (!/^[a-z0-9_-]+$/i.test(name)) {
    return { success: false, output: `name "${name}" 不合法,只能字母/数字/下划线/短横线` };
  }
  const repo = new CustomToolRepo();
  if (repo.getByName(name)) {
    return { success: false, output: `已存在同名 tool "${name}",换名字或者用 update_custom_tool` };
  }
  const config = (input.config && typeof input.config === 'object' ? input.config : {}) as any;
  try {
    const saved = repo.upsert({
      id: name,
      name,
      type,
      description: String(input.description ?? ''),
      config,
      enabled: input.enabled !== false,
    });
    const stats = reloadCustomTools();
    return {
      success: true,
      output: `✓ 已创建 tool "${saved.name}" (type=${saved.type}),reload=${stats.loaded}`,
      data: { id: saved.id, name: saved.name, type: saved.type, description: saved.description, config: saved.config, enabled: saved.enabled },
    };
  } catch (e: any) {
    return { success: false, output: `保存失败: ${e.message}` };
  }
}

async function execUpdateTool(input: Record<string, unknown>): Promise<ToolResult> {
  const name = String(input.name ?? '');
  const repo = new CustomToolRepo();
  const existing = repo.getByName(name);
  if (!existing) return { success: false, output: `tool "${name}" 不存在` };
  const newConfig = input.config !== undefined
    ? (typeof input.config === 'object' && input.config !== null ? input.config : existing.config)
    : existing.config;
  try {
    const saved = repo.upsert({
      ...existing,
      description: input.description !== undefined ? String(input.description) : existing.description,
      config: newConfig as any,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled,
    });
    reloadCustomTools();
    return { success: true, output: `✓ 已更新 tool "${saved.name}"`, data: saved };
  } catch (e: any) {
    return { success: false, output: `更新失败: ${e.message}` };
  }
}

async function execDeleteTool(input: Record<string, unknown>): Promise<ToolResult> {
  const name = String(input.name ?? '');
  const repo = new CustomToolRepo();
  const existing = repo.getByName(name);
  if (!existing) return { success: false, output: `tool "${name}" 不存在` };
  repo.delete(existing.id);
  reloadCustomTools();
  return { success: true, output: `✓ 已删除 tool "${name}"` };
}

async function execInstallSkill(input: Record<string, unknown>): Promise<ToolResult> {
  const source = String(input.source ?? '');
  try {
    if (source === 'content') {
      if (!input.content) return { success: false, output: 'source=content 必须填 content' };
      const r = await installFromContent(String(input.content), input.name ? String(input.name) : undefined);
      return { success: true, output: `✓ 已装 skill "${r.name}"(source=${r.source})`, data: r };
    }
    if (source === 'url') {
      if (!input.url) return { success: false, output: 'source=url 必须填 url' };
      const r = await installFromUrl(String(input.url), input.name ? String(input.name) : undefined);
      return { success: true, output: `✓ 已装 skill "${r.name}"(source=${r.source})`, data: r };
    }
    if (source === 'upload') {
      if (!input.fileBase64) return { success: false, output: 'source=upload 必须填 fileBase64' };
      const r = await installFromUpload(String(input.fileBase64), String(input.filename ?? 'skill.zip'), input.name ? String(input.name) : undefined);
      return { success: true, output: `✓ 已装 skill "${r.name}"(source=${r.source})`, data: r };
    }
    if (source === 'hub') {
      return { success: false, output: 'helper 暂不支持 hub 安装(走 url 路径即可)' };
    }
    return { success: false, output: `未知 source: ${source}` };
  } catch (e: any) {
    return { success: false, output: `安装失败: ${e.message}` };
  }
}

async function execUninstallSkill(
  input: Record<string, unknown>,
  companyRoot: string,
): Promise<ToolResult> {
  const name = String(input.name ?? '');
  try {
    const r = uninstallSkill(companyRoot, name);
    return { success: true, output: `✓ 已卸载 skill "${name}"`, data: r };
  } catch (e: any) {
    return { success: false, output: `卸载失败: ${e.message}` };
  }
}

async function execGetSkillContent(
  input: Record<string, unknown>,
  companyRoot: string,
): Promise<ToolResult> {
  const name = String(input.name ?? '');
  const detail = getSkill(companyRoot, name);
  if (!detail) return { success: false, output: `skill "${name}" 不存在` };
  return { success: true, output: detail.body, data: { name: detail.name, description: detail.description } };
}

/** @internal - exported for testing only */
export async function execMetaTool(
  name: string,
  input: Record<string, unknown>,
  companyRoot = process.cwd(),
): Promise<ToolResult> {
  switch (name) {
    case 'create_custom_tool': return execCreateTool(input);
    case 'update_custom_tool': return execUpdateTool(input);
    case 'delete_custom_tool': return execDeleteTool(input);
    case 'install_skill':      return execInstallSkill(input);
    case 'uninstall_skill':   return execUninstallSkill(input, companyRoot);
    case 'get_skill_content': return execGetSkillContent(input, companyRoot);
    default: return { success: false, output: `unknown meta-tool: ${name}` };
  }
}

// ─── chat loop ────────────────────────────────────────
export interface HelperRunInput {
  tab: 'tools' | 'skills';
  messages: LLMMessage[];
  llmId: string;
  llmRegistry: LLMRegistry;
  companyRoot?: string;
}

export interface HelperRunOutput {
  /** 最终 assistant 回复内容(可能为空如果最后一轮全是 tool calls) */
  reply: string;
  /** 这一轮里调过哪些 tool,及每个结果 */
  toolCalls: Array<{ name: string; input: any; result: ToolResult }>;
  /** 用了多少 token(粗略统计) */
  usage: { inputTokens: number; outputTokens: number };
}

/** 构造 system prompt */
function buildSystemPrompt(tab: 'tools' | 'skills', companyRoot: string): string {
  // 当前已有的 tools/skills 列表
  const customTools = new CustomToolRepo().list();
  const installedSkills = listSkills(companyRoot);
  const meta = getMetaSkillBodies(companyRoot);

  const tabContext = tab === 'tools'
    ? `用户当前在 **Tools** 设置页,目的是配置/创建自定义 tool(给 agent 用)。`
    : `用户当前在 **Skills** 设置页,目的是配置/创建 skill(给 agent 注入知识)。`;

  const toolsList = customTools.length === 0
    ? '  (暂无)'
    : customTools.map(t => `  - ${t.name} (${t.type})${t.enabled ? '' : ' [已禁用]'} — ${t.description || '(无描述)'}`).join('\n');
  const skillsList = installedSkills.length === 0
    ? '  (暂无)'
    : installedSkills.map(s => `  - ${s.name} [${s.source}] — ${s.description || '(无描述)'}`).join('\n');

  const toolBuilderBody = meta.toolBuilder
    ? `\n---\n\n# 启用的 meta-skill: tool-builder\n\n${meta.toolBuilder.length > 4000 ? meta.toolBuilder.slice(0, 4000) + '\n\n...(已截断)' : meta.toolBuilder}\n`
    : '\n(注意: tool-builder meta-skill 未装,创建 tool 时请遵循通用规范)\n';
  const skillBuilderBody = meta.skillBuilder
    ? `\n---\n\n# 启用的 meta-skill: skill-builder\n\n${meta.skillBuilder.length > 4000 ? meta.skillBuilder.slice(0, 4000) + '\n\n...(已截断)' : meta.skillBuilder}\n`
    : '\n(注意: skill-builder meta-skill 未装,创建 skill 时请遵循通用规范)\n';

  return `你是 **Settings Helper** — 一个在 Agent Company「设置」页里帮用户创建/修改 Tool 和 Skill 的 agent。

${tabContext}

## 你的能力
你有 6 个 meta-tool 可以直接调,所有改动会立即生效:
- \`create_custom_tool\` / \`update_custom_tool\` / \`delete_custom_tool\`
- \`install_skill\`(支持 source: content | url | upload)/ \`uninstall_skill\` / \`get_skill_content\`

## 当前已有的 custom tools
${toolsList}

## 当前已装的 skills
${skillsList}

## 工作原则
1. **先理解再动手** — 调 create_custom_tool / install_skill 之前,用一两句话复述你的理解,让用户确认
2. **命名规范** — tool: 小写下划线/短横线;skill: 小写短横线
3. **不复述太长的样板** — 调完直接说"已创建 xxx"即可
4. **遇到不确定就问** — 别瞎猜
5. **不要试图改 LLM providers 或 agent** — 你只负责 tools 和 skills

## 输出语言
中文,简洁,像同事在 Slack 里回复。
${toolBuilderBody}${skillBuilderBody}`;
}

export async function runHelperAgent(input: HelperRunInput): Promise<HelperRunOutput> {
  const { tab, messages, llmId, llmRegistry } = input;
  const companyRoot = input.companyRoot ?? process.cwd();

  const systemPrompt = buildSystemPrompt(tab, companyRoot);
  const llmMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const toolCalls: HelperRunOutput['toolCalls'] = [];
  let totalIn = 0, totalOut = 0;
  let reply = '';

  const maxIter = 8;
  for (let i = 0; i < maxIter; i++) {
    // 球球之前反馈"helper agent 选了 LLM 也是 mock"——根本原因:
    // 之前的 `|| llmRegistry.getOrMock(llmId)` 会悄悄 fallback 到 mock,
    // 即使前端传了 llmId,后端 addWithSource 也可能在没 apiKey 时创建 mock 替代品。
    // 现在改成显式:拿不到就抛错,前端能立刻看到真错因。
    const provider = llmRegistry.get(llmId);
    if (!provider) {
      throw new Error(`LLM provider "${llmId}" not found. 请在「设置 → LLM」配置后重试。`);
    }
    const response: ChatResponse = await provider.chat({
      messages: llmMessages,
      tools: HELPER_TOOL_DEFS,
    });
    totalIn += response.usage?.inputTokens ?? 0;
    totalOut += response.usage?.outputTokens ?? 0;

    if (!response.toolCalls || response.toolCalls.length === 0) {
      reply = response.text ?? '';
      break;
    }

    // 追加 assistant 消息(含 tool calls)
    llmMessages.push({
      role: 'assistant',
      content: response.text || '',
      toolCalls: response.toolCalls,
    } as any);

    // 执行 tool calls
    const toolResults: Array<{ id: string; name: string; result: ToolResult }> = [];
    for (const tc of response.toolCalls) {
      const result = await execMetaTool(tc.name, tc.input, companyRoot);
      toolCalls.push({ name: tc.name, input: tc.input, result });
      toolResults.push({ id: tc.id, name: tc.name, result });
    }

    // 追加 tool 结果
    for (const tr of toolResults) {
      llmMessages.push({
        role: 'tool',
        content: tr.result.success ? tr.result.output : `ERROR: ${tr.result.output}`,
        toolCallId: tr.id,
        toolName: tr.name,
      } as any);
    }
  }

  return { reply, toolCalls, usage: { inputTokens: totalIn, outputTokens: totalOut } };
}

// 工具集 list(给前端展示)
export function listMetaTools() {
  return HELPER_TOOL_DEFS.map(t => ({ name: t.name, description: t.description }));
}

// ─── 启动时检查 meta-skill 是否装上 ────────────────────────
/** 把 2 个 meta-skill 内容(不写到磁盘,仅返回)用于 system prompt 注入 */
export function getMetaSkillBodies(
  companyRoot = process.cwd(),
): { toolBuilder: string; skillBuilder: string } {
  // 找磁盘上装的 meta-skill
  const all = listSkills(companyRoot);
  const find = (name: string): string | null => {
    const s = all.find(x => x.name === name);
    if (!s) return null;
    try {
      return readFileSync(s.path, 'utf-8');
    } catch { return null; }
  };
  return {
    toolBuilder: find('tool-builder') ?? '',
    skillBuilder: find('skill-builder') ?? '',
  };
}
