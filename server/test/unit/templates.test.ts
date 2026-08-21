/**
 * orchestrator/templates.ts 单测
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE_TEMPLATES,
  STANDARD_WORKFLOW,
  resolveAssignee,
  generateTasksForPhase,
  TaskTemplate,
} from '../../src/orchestrator/templates.js';
import type { CompanyConfig } from '../../src/types/company.js';

function makeCompany(over: Partial<CompanyConfig> = {}): CompanyConfig {
  return {
    name: '球球的 AI 公司',
    boss: '球球',
    description: '',
    departments: [
      { id: 'product', name: '产品', head: 'a-product-head' },
      { id: 'design', name: '设计', head: 'a-design-head' },
      { id: 'dev', name: '研发', head: 'a-dev-head' },
      { id: 'qa', name: 'QA', head: 'a-qa-head' },
      { id: 'ops', name: '运维', head: 'a-ops-head' },
    ],
    agents: [
      { id: 'a-product-head', name: '产品总监', department: 'product', role: 'head', llm: 'p1', systemPrompt: '', tools: [] },
      { id: 'a-design-head', name: '设计总监', department: 'design', role: 'head', llm: 'p1', systemPrompt: '', tools: [] },
      { id: 'a-dev-head', name: '研发总监', department: 'dev', role: 'head', llm: 'p1', systemPrompt: '', tools: [] },
      { id: 'a-frontend', name: '前端小李', department: 'dev', team: 'frontend', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] },
      { id: 'a-backend', name: '后端老王', department: 'dev', team: 'backend', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] },
      { id: 'a-qa-head', name: 'QA 头', department: 'qa', role: 'head', llm: 'p1', systemPrompt: '', tools: [] },
      { id: 'a-qa-worker', name: 'QA 员', department: 'qa', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] },
      { id: 'a-ops-head', name: '运维头', department: 'ops', role: 'head', llm: 'p1', systemPrompt: '', tools: [] },
    ],
    llm_providers: [],
    ...over,
  };
}

// =================== 常量 ===================

test('PHASE_TEMPLATES 包含 5 个标准 phase', () => {
  for (const p of ['prd', 'design', 'dev', 'qa', 'delivery']) {
    assert.ok(Array.isArray(PHASE_TEMPLATES[p]), `phase ${p} 应存在`);
    assert.ok(PHASE_TEMPLATES[p].length > 0, `phase ${p} 至少 1 模板`);
  }
});

test('STANDARD_WORKFLOW 顺序正确', () => {
  assert.deepEqual(STANDARD_WORKFLOW, ['prd', 'design', 'dev', 'qa', 'delivery']);
});

test('每个 phase 模板字段完整', () => {
  for (const [phase, tpls] of Object.entries(PHASE_TEMPLATES)) {
    for (const t of tpls) {
      assert.equal(t.phase, phase, 'phase 字段一致');
      assert.ok(t.department, 'department 必填');
      assert.ok(t.assigneeHint, 'assigneeHint 必填');
      assert.ok(t.title, 'title 必填');
      assert.ok(t.promptTemplate, 'promptTemplate 必填');
      assert.ok(Array.isArray(t.dependsOn), 'dependsOn 是数组');
    }
  }
});

test('dev phase 模板有 parallel=true 标记', () => {
  const devTpls = PHASE_TEMPLATES.dev;
  assert.equal(devTpls.length, 2);
  assert.equal(devTpls[0].parallel, true);
  assert.equal(devTpls[1].parallel, true);
  assert.equal(devTpls[0].department, 'dev');
  assert.equal(devTpls[1].department, 'dev');
});

// =================== resolveAssignee ===================

test('resolveAssignee:@xxx 直接返 agent id(剥掉 @)', () => {
  const c = makeCompany();
  assert.equal(resolveAssignee('@a-frontend', c), 'a-frontend');
});

test('resolveAssignee:product-head 返 product 部门 head', () => {
  const c = makeCompany();
  assert.equal(resolveAssignee('product-head', c), 'a-product-head');
});

test('resolveAssignee:qa-head 返 qa 部门 head', () => {
  const c = makeCompany();
  assert.equal(resolveAssignee('qa-head', c), 'a-qa-head');
});

test('resolveAssignee:frontend-worker 智能映射到 dev 部门 team=frontend', () => {
  const c = makeCompany();
  assert.equal(resolveAssignee('frontend-worker', c), 'a-frontend');
});

test('resolveAssignee:backend-worker 智能映射到 dev 部门 team=backend', () => {
  const c = makeCompany();
  assert.equal(resolveAssignee('backend-worker', c), 'a-backend');
});

test('resolveAssignee:dev-frontend-worker 三段式匹配', () => {
  const c = makeCompany();
  assert.equal(resolveAssignee('dev-frontend-worker', c), 'a-frontend');
});

test('resolveAssignee:department 不存在返 null', () => {
  const c = makeCompany();
  assert.equal(resolveAssignee('nonexistent-head', c), null);
});

test('resolveAssignee:dept 存在但 role 退化到第一个 worker', () => {
  const c = makeCompany({
    agents: [
      ...makeCompany().agents,
      // 移走产品部的 head,加 worker
    ],
  });
  // 改:把 product-head 换成 product-worker
  const c2: CompanyConfig = {
    ...c,
    agents: c.agents.filter((a) => a.id !== 'a-product-head').concat([
      { id: 'a-product-w1', name: '产品1', department: 'product', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] },
    ]),
  };
  // 部门 head 字段还是 a-product-head(已删除),resolveAssignee 找 worker
  const r = resolveAssignee('product-unknown', c2);
  assert.equal(r, 'a-product-w1', '无匹配 role 时退化到 worker');
});

test('resolveAssignee:dept 存在但完全无 worker 退化到 department.head', () => {
  const c: CompanyConfig = {
    ...makeCompany(),
    agents: makeCompany().agents.filter((a) => a.department !== 'ops'),
  };
  const r = resolveAssignee('ops-anything', c);
  // ops 部门 head='a-ops-head',agent 里没有 ops 部门
  // 退化:找 worker → 没有 → 返 department.head
  assert.equal(r, 'a-ops-head');
});

test('resolveAssignee:team dept 映射不识别时原样 team=team', () => {
  // 假设有个未在 teamDeptMap 里的 team,例如 'unknown-team-worker'
  const c: CompanyConfig = {
    ...makeCompany(),
    agents: [
      ...makeCompany().agents,
      { id: 'a-x', name: 'x', department: 'unknown', team: 'unknown', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] },
    ],
  };
  // unknown-worker:team 模式匹配,mappedDept = unknown → 找 agent dept=unknown team=unknown role=worker
  // 找到了 a-x
  assert.equal(resolveAssignee('unknown-worker', c), 'a-x');
});

test('resolveAssignee:team-only 形式未匹配,部门也不存在 → null', () => {
  // 没匹配,且 hint 拆出来的 dept 也不在 departments 里
  const c: CompanyConfig = {
    ...makeCompany(),
    agents: [
      { id: 'a-x', name: 'x', department: 'design', team: 'unknown', role: 'worker', llm: 'p1', systemPrompt: '', tools: [] },
    ],
  };
  // 'unknown-worker' → teamOnlyMatch.team='unknown' mappedDept=teamDeptMap['unknown'] ?? 'unknown' = 'unknown'
  // 找 agent dept=unknown team=unknown role=worker → 没
  // 走到 '<dept>-<role>':dept='unknown',role='worker'
  // department = find('unknown') → null → 返 null
  assert.equal(resolveAssignee('unknown-worker', c), null);
});

// =================== generateTasksForPhase ===================

test('generateTasksForPhase:prd 生成 1 个 product 任务', () => {
  const c = makeCompany();
  const tasks = generateTasksForPhase('prd', c, { id: 'p1', title: '球球的项目' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].phase, 'prd');
  assert.equal(tasks[0].department, 'product');
  assert.equal(tasks[0].assignee, 'a-product-head');
  assert.equal(tasks[0].title, '写产品需求文档');
  assert.ok(tasks[0].prompt.includes('球球的项目'), 'prompt 应替换 {{title}}');
  assert.deepEqual(tasks[0].dependsOn, []);
});

test('generateTasksForPhase:dev 生成 2 个并行任务', () => {
  const c = makeCompany();
  const tasks = generateTasksForPhase('dev', c, { id: 'p1', title: 'X' });
  assert.equal(tasks.length, 2);
  // 都依赖 design
  assert.deepEqual(tasks[0].dependsOn, ['design']);
  assert.deepEqual(tasks[1].dependsOn, ['design']);
  // 前端 + 后端
  const assignees = tasks.map((t) => t.assignee).sort();
  assert.deepEqual(assignees, ['a-backend', 'a-frontend']);
});

test('generateTasksForPhase:qa 返 1 任务 depends dev', () => {
  const c = makeCompany();
  const tasks = generateTasksForPhase('qa', c, { id: 'p1', title: 'X' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].department, 'qa');
  assert.deepEqual(tasks[0].dependsOn, ['dev']);
});

test('generateTasksForPhase:delivery 返 1 任务 depends qa', () => {
  const c = makeCompany();
  const tasks = generateTasksForPhase('delivery', c, { id: 'p1', title: 'X' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].department, 'ops');
  assert.deepEqual(tasks[0].dependsOn, ['qa']);
});

test('generateTasksForPhase:未知 phase 返空', () => {
  const c = makeCompany();
  assert.deepEqual(generateTasksForPhase('unknown-phase', c, { id: 'p1', title: 'X' }), []);
});

test('generateTasksForPhase:context.prd 替换 {{prd}}', () => {
  const c = makeCompany();
  // 用一个自定义模板来测 fillTemplate
  // 借用 prd 模板,但加个占位
  const original = PHASE_TEMPLATES.prd[0]!.promptTemplate;
  PHASE_TEMPLATES.prd[0] = {
    ...(PHASE_TEMPLATES.prd[0] as TaskTemplate),
    promptTemplate: '读 {{prd}} 出方案',
  };
  try {
    const tasks = generateTasksForPhase(
      'prd',
      c,
      { id: 'p1', title: 'X' },
      { prd: '球球的 PRD 内容' },
    );
    assert.equal(tasks[0].prompt, '读 球球的 PRD 内容 出方案');
  } finally {
    PHASE_TEMPLATES.prd[0] = { ...(PHASE_TEMPLATES.prd[0] as TaskTemplate), promptTemplate: original };
  }
});

test('generateTasksForPhase:context 缺失时占位符替换为空串', () => {
  const c = makeCompany();
  const original = PHASE_TEMPLATES.prd[0]!.promptTemplate;
  PHASE_TEMPLATES.prd[0] = {
    ...(PHASE_TEMPLATES.prd[0] as TaskTemplate),
    promptTemplate: 'A={{prd}} B={{design}} C={{codeSummary}} D={{testReport}}',
  };
  try {
    const tasks = generateTasksForPhase('prd', c, { id: 'p1', title: 'X' });
    assert.equal(tasks[0].prompt, 'A= B= C= D=');
  } finally {
    PHASE_TEMPLATES.prd[0] = { ...(PHASE_TEMPLATES.prd[0] as TaskTemplate), promptTemplate: original };
  }
});

test('generateTasksForPhase:assignee 解析失败退化为 hint 字符串', () => {
  // 改 PHASE_TEMPLATES 用一个无法解析的 hint
  const original = PHASE_TEMPLATES.prd[0]!;
  PHASE_TEMPLATES.prd[0] = { ...original, assigneeHint: 'totally-unknown-hint' };
  try {
    const c = makeCompany();
    const tasks = generateTasksForPhase('prd', c, { id: 'p1', title: 'X' });
    // resolveAssignee('totally-unknown-hint', c) → 'totally-unknown' 部门不存在 → null
    // 退化:assignee = hint
    assert.equal(tasks[0].assignee, 'totally-unknown-hint');
  } finally {
    PHASE_TEMPLATES.prd[0] = original;
  }
});

test('generateTasksForPhase:title 占位符替换', () => {
  const c = makeCompany();
  const tasks = generateTasksForPhase('prd', c, {
    id: 'p1',
    title: '球球的可视化报告',
    description: '球球要看的项目',
  });
  assert.ok(tasks[0].prompt.includes('球球的可视化报告'));
  assert.ok(tasks[0].prompt.includes('球球要看的项目'));
});

test('generateTasksForPhase:description 缺失时 {{description}} 替换为空', () => {
  const c = makeCompany();
  const original = PHASE_TEMPLATES.prd[0]!.promptTemplate;
  PHASE_TEMPLATES.prd[0] = {
    ...(PHASE_TEMPLATES.prd[0] as TaskTemplate),
    promptTemplate: 'desc={{description}}',
  };
  try {
    const tasks = generateTasksForPhase('prd', c, { id: 'p1', title: 'X' });
    assert.equal(tasks[0].prompt, 'desc=');
  } finally {
    PHASE_TEMPLATES.prd[0] = { ...(PHASE_TEMPLATES.prd[0] as TaskTemplate), promptTemplate: original };
  }
});
