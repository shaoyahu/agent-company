import type {
  WorkflowTaskTemplate,
  WorkflowTaskTemplateGuidedConfig,
} from '../../api/client';

export type GuidedTaskType = WorkflowTaskTemplateGuidedConfig['taskType'];

export interface TaskTypeDefinition {
  value: GuidedTaskType;
  label: string;
  department: string;
  assigneeHint: string;
  title: string;
  description: string;
  deliverables: string[];
  acceptanceCriteria: string[];
}

export const TASK_TYPE_DEFINITIONS: TaskTypeDefinition[] = [
  {
    value: 'frontend',
    label: '实现前端页面',
    department: 'dev',
    assigneeHint: 'frontend-worker',
    title: '实现前端页面',
    description: '根据需求和设计稿完成界面与交互。',
    deliverables: ['修改前端代码', '补充页面测试'],
    acceptanceCriteria: ['项目可构建', '相关测试通过', '支持移动端'],
  },
  {
    value: 'backend',
    label: '实现后端能力',
    department: 'dev',
    assigneeHint: 'backend-worker',
    title: '实现后端能力',
    description: '完成接口、业务逻辑和必要的数据处理。',
    deliverables: ['修改后端代码', '补充接口测试'],
    acceptanceCriteria: ['接口契约保持兼容', '相关测试通过'],
  },
  {
    value: 'design',
    label: '输出设计方案',
    department: 'design',
    assigneeHint: 'design-worker',
    title: '输出设计方案',
    description: '梳理用户流程、页面结构和视觉规范。',
    deliverables: ['输出设计方案', '更新设计文档'],
    acceptanceCriteria: ['覆盖主要用户流程', '包含可执行的页面说明'],
  },
  {
    value: 'test',
    label: '补齐测试',
    department: 'qa',
    assigneeHint: 'qa-worker',
    title: '补齐测试',
    description: '为现有功能补充自动化测试并验证关键路径。',
    deliverables: ['新增测试用例', '输出测试结论'],
    acceptanceCriteria: ['覆盖关键成功与失败路径', '测试可重复通过'],
  },
  {
    value: 'review',
    label: '代码审查',
    department: 'qa',
    assigneeHint: 'reviewer',
    title: '代码审查',
    description: '检查实现风险、回归问题与测试缺口。',
    deliverables: ['输出审查结论'],
    acceptanceCriteria: ['按严重程度列出问题', '包含文件与行号'],
  },
  {
    value: 'custom',
    label: '自定义任务',
    department: 'general',
    assigneeHint: '',
    title: '执行自定义任务',
    description: '根据项目上下文完成指定工作。',
    deliverables: ['输出任务结果'],
    acceptanceCriteria: ['结果可复核'],
  },
];

export function taskTypeDefinition(taskType: GuidedTaskType): TaskTypeDefinition {
  return TASK_TYPE_DEFINITIONS.find(item => item.value === taskType)
    ?? TASK_TYPE_DEFINITIONS[TASK_TYPE_DEFINITIONS.length - 1]!;
}

export function guidedConfigFor(template: WorkflowTaskTemplate): WorkflowTaskTemplateGuidedConfig {
  if (template.guided) return template.guided;
  const matched = TASK_TYPE_DEFINITIONS.find(
    item => item.title === template.title,
  );
  const definition = matched ?? taskTypeDefinition('custom');
  return {
    taskType: definition.value,
    deliverables: definition.deliverables,
    acceptanceCriteria: definition.acceptanceCriteria,
  };
}

export function addGuidedTaskItem(
  guided: WorkflowTaskTemplateGuidedConfig,
  field: 'deliverables' | 'acceptanceCriteria',
  value: string,
): WorkflowTaskTemplateGuidedConfig {
  const item = value.trim();
  if (!item || guided[field].includes(item)) return guided;
  return { ...guided, [field]: [...guided[field], item] };
}

export function toggleTaskDependency(
  template: WorkflowTaskTemplate,
  stage: string,
): WorkflowTaskTemplate {
  return template.dependsOn.includes(stage)
    ? { ...template, dependsOn: template.dependsOn.filter(item => item !== stage) }
    : { ...template, dependsOn: [...template.dependsOn, stage] };
}

function promptItems(items: string[]): string {
  return items.length > 0
    ? items.map(item => `- ${item}`).join('\n')
    : '- 暂未指定';
}

export function buildTaskPrompt(
  template: WorkflowTaskTemplate,
  guided = guidedConfigFor(template),
): string {
  const definition = taskTypeDefinition(guided.taskType);
  const inputs = template.dependsOn.length > 0
    ? template.dependsOn.map(item => `- ${item}`).join('\n')
    : '- 项目当前上下文';
  const deliverables = promptItems(guided.deliverables);
  const criteria = promptItems(guided.acceptanceCriteria);
  return [
    `目标：${definition.description}`,
    '输入来源：',
    inputs,
    '交付物：',
    deliverables,
    '验收标准：',
    criteria,
    '执行要求：如关键信息缺失，先说明缺口，不要自行编造。',
  ].join('\n');
}

export function applyTaskType(
  template: WorkflowTaskTemplate,
  taskType: GuidedTaskType,
): WorkflowTaskTemplate {
  const definition = taskTypeDefinition(taskType);
  const guided: WorkflowTaskTemplateGuidedConfig = {
    taskType,
    deliverables: definition.deliverables,
    acceptanceCriteria: definition.acceptanceCriteria,
    promptMode: template.guided?.promptMode,
  };
  const next = {
    ...template,
    department: definition.department,
    assigneeHint: definition.assigneeHint,
    title: definition.title,
    guided,
  };
  return applyGuidedTaskConfig(next, guided);
}

export function applyGuidedTaskConfig(
  template: WorkflowTaskTemplate,
  guided: WorkflowTaskTemplateGuidedConfig,
): WorkflowTaskTemplate {
  const currentGuided = guidedConfigFor(template);
  const generatedPrompt = buildTaskPrompt(template, currentGuided);
  const hasCustomPrompt = currentGuided.promptMode === 'custom'
    || (Boolean(template.promptTemplate.trim())
      && template.promptTemplate !== generatedPrompt);
  const next = { ...template, guided };
  return {
    ...next,
    promptTemplate: hasCustomPrompt
      ? template.promptTemplate
      : buildTaskPrompt(next, guided),
  };
}
