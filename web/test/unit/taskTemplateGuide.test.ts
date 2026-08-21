import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkflowTaskTemplate } from '../../src/api/client.js';
import {
  addGuidedTaskItem,
  applyGuidedTaskConfig,
  buildTaskPrompt,
  guidedConfigFor,
  toggleTaskDependency,
} from '../../src/features/workflows/taskTemplateGuide.js';

function template(
  patch: Partial<WorkflowTaskTemplate> = {},
): WorkflowTaskTemplate {
  return {
    phase: '开发',
    department: 'dev',
    assigneeHint: 'frontend-worker',
    title: '实现前端页面',
    promptTemplate: '',
    dependsOn: [],
    ...patch,
  };
}

test('添加自定义交付物会忽略空白和重复内容', () => {
  const guided = guidedConfigFor(template());

  const added = addGuidedTaskItem(guided, 'deliverables', '  提供变更说明  ');
  const duplicate = addGuidedTaskItem(added, 'deliverables', '提供变更说明');
  const blank = addGuidedTaskItem(duplicate, 'deliverables', '   ');

  assert.deepEqual(blank.deliverables, [
    ...guided.deliverables,
    '提供变更说明',
  ]);
});

test('引导配置为空时生成可读的待补充提示', () => {
  const current = template();
  const guided = {
    ...guidedConfigFor(current),
    deliverables: [],
    acceptanceCriteria: [],
  };

  const prompt = buildTaskPrompt(current, guided);

  assert.match(prompt, /交付物：\n- 暂未指定/);
  assert.match(prompt, /验收标准：\n- 暂未指定/);
});

test('旧模板不会仅因部门名称被隐式推断为前端任务', () => {
  const guided = guidedConfigFor(template({
    title: '清理历史数据',
    department: 'dev',
  }));

  assert.equal(guided.taskType, 'custom');
});

test('输入来源始终用阶段标识保存和切换', () => {
  const current = template({ dependsOn: ['design'] });

  const removed = toggleTaskDependency(current, 'design');
  const restored = toggleTaskDependency(removed, 'design');

  assert.deepEqual(removed.dependsOn, []);
  assert.deepEqual(restored.dependsOn, ['design']);
});

test('结构化配置变更不覆盖手写任务说明', () => {
  const current = template({
    promptTemplate: '请优先处理导航栏在窄屏下的溢出问题。',
  });
  const guided = {
    ...guidedConfigFor(current),
    deliverables: ['修改前端代码', '补充页面测试', '提供变更说明'],
  };

  const next = applyGuidedTaskConfig(current, guided);

  assert.equal(next.promptTemplate, current.promptTemplate);
  assert.deepEqual(next.guided, guided);
});

test('明确标记为手写的自动说明文本也不会被覆盖', () => {
  const base = template();
  const guided = {
    ...guidedConfigFor(base),
    promptMode: 'custom' as const,
  };
  const current = {
    ...base,
    guided,
    promptTemplate: buildTaskPrompt(base, guided),
  };
  const next = applyGuidedTaskConfig(current, {
    ...guided,
    deliverables: [...guided.deliverables, '提供变更说明'],
  });

  assert.equal(next.promptTemplate, current.promptTemplate);
});
