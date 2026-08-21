/**
 * Phase 任务模板系统
 *
 * 关键想法:每个 phase 不需要老板手动指定任务列表。
 * Orchestrator 根据项目类型 + 部门能力,自动从 phase template 生成任务。
 *
 * 例如:dev phase 拆成 frontend + backend 两个并行任务
 *      qa phase 拆成 功能测试 + 验收 任务
 */

import type { CompanyConfig, AgentConfig, WorkflowDefinition } from '../types/company.js';
import { linearWorkflowToGraph } from '../workflows/graph.js';

export interface TaskTemplate {
  phase: string;
  department: string;
  /** 默认 assignee agent id(可被动态解析覆盖) */
  assigneeHint: string; // 'frontend-worker' / 'qa-head' / '@first-dev' 等
  title: string;
  promptTemplate: string; // 支持 {{title}} {{prd}} {{design}} 等占位符
  dependsOn: string[]; // 依赖的 phase
  /** 是否并行(同 phase 多任务) */
  parallel?: boolean;
}

/**
 * 默认工作流模板 - 6 phase
 * 每个 phase 的任务模板
 */
export const PHASE_TEMPLATES: Record<string, TaskTemplate[]> = {
  // ─── PRD ───
  prd: [
    {
      phase: 'prd',
      department: 'product',
      assigneeHint: 'product-head',
      title: '写产品需求文档',
      promptTemplate:
        `为项目"{{title}}"写一份 PRD,保存到 prd.md。\n` +
        `\n` +
        `PRD 包含:\n` +
        `1. 目标用户(具体画像,不要空话)\n` +
        `2. 核心功能(3-5 个,每个 1-2 句说明)\n` +
        `3. 关键页面 / 用户流程\n` +
        `4. 验收标准(可量化)\n` +
        `\n` +
        `项目描述: {{description}}`,
      dependsOn: [],
    },
  ],

  // ─── 设计 ───
  design: [
    {
      phase: 'design',
      department: 'design',
      assigneeHint: 'design-head',
      title: '出视觉方案',
      promptTemplate:
        `读 prd.md,出 2-3 个视觉方向方案,写到 design/proposal.md。\n` +
        `每个方案包含:配色、字体、风格关键词、参考案例、关键页面草图描述。\n` +
        `\n` +
        `输出末尾用 [SUMMARY] 标签给出你的推荐方案:\n` +
        `[SUMMARY]\n` +
        `推荐方案:<方案名>\n` +
        `理由:<一句话>\n` +
        `[/SUMMARY]`,
      dependsOn: ['prd'],
    },
  ],

  // ─── 研发 ───
  dev: [
    {
      phase: 'dev',
      department: 'dev',
      assigneeHint: 'frontend-worker',
      title: '前端实现',
      promptTemplate:
        `基于 prd.md + design/proposal.md 写前端代码。\n` +
        `\n` +
        `技术栈:React + Vite + TailwindCSS + TypeScript\n` +
        `项目目录:src/\n` +
        `\n` +
        `要求:\n` +
        `1. 组件化、复用\n` +
        `2. TypeScript 类型完整\n` +
        `3. 移动端优先\n` +
        `4. 关键交互加动画\n` +
        `\n` +
        `写完跑一下 npm run build 确认能过。\n` +
        `\n` +
        `完成后用 [SUMMARY] 写一行做了什么。`,
      dependsOn: ['design'],
      parallel: true,
    },
    {
      phase: 'dev',
      department: 'dev',
      assigneeHint: 'backend-worker',
      title: '后端实现',
      promptTemplate:
        `基于 prd.md 写后端 API。\n` +
        `\n` +
        `技术栈:Node.js + Fastify + SQLite\n` +
        `项目目录:server/\n` +
        `\n` +
        `要求:\n` +
        `1. RESTful API\n` +
        `2. 输入校验(zod)\n` +
        `3. 错误处理\n` +
        `4. 写 README 解释启动方式\n` +
        `\n` +
        `完成后用 [SUMMARY] 写一行做了什么。`,
      dependsOn: ['design'],
      parallel: true,
    },
  ],

  // ─── QA ───
  qa: [
    {
      phase: 'qa',
      department: 'qa',
      assigneeHint: 'qa-head',
      title: '功能测试',
      promptTemplate:
        `基于 prd.md 写测试用例并跑测试。\n` +
        `\n` +
        `输出 test-report.md,格式:\n` +
        `## 测试结果\n` +
        `✅ 通过项:<列表>\n` +
        `❌ 失败项:<列表,具体复现步骤>\n` +
        `## 建议改进\n` +
        `<列表>\n` +
        `\n` +
        `## 验收决定\n` +
        `**STATUS**: APPROVE 或 REJECT\n` +
        `**理由**: <一句话>\n` +
        `\n` +
        `REJECT 时,具体指出哪个文件的哪部分需要改。`,
      dependsOn: ['dev'],
    },
  ],

  // ─── 交付 ───
  delivery: [
    {
      phase: 'delivery',
      department: 'ops',
      assigneeHint: 'ops-head',
      title: '写文档 + 交付包',
      promptTemplate:
        `整理项目交付物:\n` +
        `1. 写 README.md(项目说明 + 启动方式 + 截图)\n` +
        `2. 检查所有文件齐全\n` +
        `3. 输出 DELIVERY.md 清单\n` +
        `\n` +
        `完成后用 [SUMMARY] 写交付了什么。`,
      dependsOn: ['qa'],
    },
  ],
};

/**
 * 解析 assigneeHint 到具体 agent id
 *
 * 支持的格式:
 * - 'product-head'           → dept=product, role=head
 * - 'qa-head'                → dept=qa, role=head
 * - 'frontend-worker'        → 智能推断到 dept=dev team=frontend role=worker
 * - 'backend-worker'         → 智能推断到 dept=dev team=backend role=worker
 * - 'design-head'            → dept=design, role=head
 * - 'dev-frontend-worker'    → dept=dev, team=frontend, role=worker
 * - 'ops-head'               → dept=ops, role=head
 * - '@agent-id'              → 显式指定
 */
export function resolveAssignee(hint: string, company: CompanyConfig): string | null {
  if (hint.startsWith('@')) {
    return hint.slice(1);
  }

  // 智能推断:把 frontend-worker / backend-worker 映射到 dev 部门
  const teamDeptMap: Record<string, string> = {
    frontend: 'dev',
    backend: 'dev',
    fullstack: 'dev',
    ui: 'design',
    illustration: 'design',
    motion: 'design',
  };

  // 1. 检查是否是 '<team>-<role>' 形式(没有 dept 前缀)
  const teamOnlyMatch = hint.match(/^(\w+)-(head|leader|worker)$/);
  if (teamOnlyMatch) {
    const [, team, role] = teamOnlyMatch;
    const mappedDept = teamDeptMap[team!] ?? team;
    const agent = company.agents.find(
      (a) => a.department === mappedDept && a.team === team && a.role === role,
    );
    if (agent) return agent.id;
  }

  // 2. '<dept>-<role>' 形式
  const parts = hint.split('-');
  const dept = parts[0];
  const role = parts.slice(1).join('-');

  // 直接匹配
  let department = company.departments.find((d) => d.id === dept);

  if (!department) {
    return null;
  }

  if (role === 'head' || role === 'leader') {
    return department.head;
  }

  // '<dept>-<team>-<role>' 形式
  const tripleMatch = role.match(/^(\w+)-(\w+)$/);
  if (tripleMatch) {
    const [, team, r] = tripleMatch;
    const agent = company.agents.find(
      (a) => a.department === dept && a.team === team && a.role === r,
    );
    if (agent) return agent.id;
  }

  // 退化:找部门里第一个 role=worker
  const fallback = company.agents.find((a) => a.department === dept && a.role === 'worker');
  return fallback?.id ?? department.head;
}

/**
 * 给一个 phase 生成任务列表
 */
export function generateTasksForPhase(
  phase: string,
  company: CompanyConfig,
  project: { id: string; title: string; description?: string },
  context: {
    prd?: string;
    design?: string;
    codeSummary?: string;
    testReport?: string;
  } = {},
): Array<{
  phase: string;
  department: string;
  assignee: string;
  title: string;
  prompt: string;
  dependsOn: string[];
}> {
  const templates = PHASE_TEMPLATES[phase];
  return generateTasksFromTemplates(templates, company, project, context);
}

export function generateTasksFromTemplates(
  templates: TaskTemplate[] | undefined,
  company: CompanyConfig,
  project: { id: string; title: string; description?: string },
  context: {
    prd?: string;
    design?: string;
    codeSummary?: string;
    testReport?: string;
  } = {},
): Array<{
  phase: string;
  department: string;
  assignee: string;
  title: string;
  prompt: string;
  dependsOn: string[];
}> {
  if (!templates) return [];

  return templates.map((tpl) => {
    const assignee = resolveAssignee(tpl.assigneeHint, company) ?? tpl.assigneeHint;
    const prompt = fillTemplate(tpl.promptTemplate, {
      title: project.title,
      description: project.description ?? '',
      prd: context.prd ?? '',
      design: context.design ?? '',
      codeSummary: context.codeSummary ?? '',
      testReport: context.testReport ?? '',
    });
    return {
      phase: tpl.phase,
      department: tpl.department,
      assignee,
      title: tpl.title,
      prompt,
      dependsOn: tpl.dependsOn,
    };
  });
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/**
 * 工作流定义
 */
export const STANDARD_WORKFLOW = ['prd', 'design', 'dev', 'qa', 'delivery'];

export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: 'standard',
  name: '标准公司开发流程',
  description: 'PRD → 设计 → 研发 → QA → 交付',
  stages: STANDARD_WORKFLOW,
  templates: PHASE_TEMPLATES,
  graph: linearWorkflowToGraph(STANDARD_WORKFLOW, PHASE_TEMPLATES),
  legacyCompatible: true,
  builtIn: true,
  createdAt: 0,
  updatedAt: 0,
};
