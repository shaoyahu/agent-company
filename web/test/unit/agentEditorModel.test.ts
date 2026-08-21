import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAgentPayload,
  canSaveAgentIdentity,
  canSaveAgentEditor,
  filterAvailableAgentTemplates,
  getCliToolSelectionNotice,
} from '../../src/features/organization/agentEditorModel';

const base = {
  id: 'worker-1',
  department: 'dev',
  llm: '',
};

test('LLM Agent 没有 LLM 时不可保存', () => {
  assert.equal(canSaveAgentEditor({ ...base, executor: 'llm' }, [], false), false);
});

test('CLI Agent 不依赖 LLM 也可保存', () => {
  assert.equal(
    canSaveAgentEditor(
      { ...base, executor: 'cli', cliTool: 'trae-cli', cliModel: 'model-a' },
      ['model-a'],
      false,
    ),
    true,
  );
});

test('CLI Agent 必须选择探测到的模型', () => {
  assert.equal(
    canSaveAgentEditor(
      { ...base, executor: 'cli', cliTool: 'trae-cli', cliModel: 'missing' },
      ['model-a'],
      false,
    ),
    false,
  );
});

test('未知执行器按 LLM Agent 处理', () => {
  assert.equal(
    canSaveAgentEditor({ ...base, executor: 'constructor' }, [], false),
    false,
  );
});

test('未添加对应 CLI 时隐藏 CLI Agent 模板', () => {
  const templates = [
    { id: 'frontend', executor: 'llm' },
    { id: 'trae', executor: 'cli', cliTool: 'trae-cli' },
  ];
  assert.deepEqual(filterAvailableAgentTemplates(templates, []), [templates[0]]);
  assert.deepEqual(filterAvailableAgentTemplates(templates, ['trae-cli']), templates);
});

test('存在可用 CLI 但尚未选择时只提示用户选择', () => {
  assert.deepEqual(
    getCliToolSelectionNotice('', [{ name: 'trae-cli' }]),
    {
      tone: 'warn',
      message: '请选择一个已配置的本机 CLI。',
    },
  );
});

test('没有可用 CLI 时提示前往设置配置', () => {
  assert.deepEqual(
    getCliToolSelectionNotice('', []),
    {
      tone: 'danger',
      message: '请先在「设置 → Tools → 添加本机 CLI」完成命令和模型探测配置，再返回选择。',
    },
  );
});

test('已经选择 CLI 时不显示提示', () => {
  assert.equal(
    getCliToolSelectionNotice('trae-cli', [{ name: 'trae-cli' }]),
    null,
  );
});

test('CLI 选择提示对 hostile input 安全兜底', () => {
  for (const value of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.doesNotThrow(() => getCliToolSelectionNotice(value, [{ name: 'trae-cli' }]));
  }
});

test('buildAgentPayload:新建 Agent 用英文名称生成 id 且不提交 team', () => {
  const payload = buildAgentPayload({
    existing: null,
    value: {
      id: '',
      name: '前端工程师',
      englishName: 'frontend-dev',
      department: 'dev',
      team: 'legacy-team',
      role: 'worker',
      llm: 'openai',
      systemPrompt: '负责前端。',
      tools: ['read'],
      skills: [],
      executor: 'llm',
    },
  });

  assert.equal(payload.id, 'frontend-dev');
  assert.equal('team' in payload, false);
});

test('buildAgentPayload:编辑 Agent 保留原 id', () => {
  const payload = buildAgentPayload({
    existing: { id: 'frontend-dev' },
    value: {
      id: 'frontend-dev',
      name: '前端工程师',
      englishName: 'new-id',
      department: 'dev',
      role: 'worker',
      llm: 'openai',
      systemPrompt: '',
      tools: [],
      executor: 'llm',
    },
  });

  assert.equal(payload.id, 'frontend-dev');
});

test('canSaveAgentIdentity:显示名和英文名称必填且英文名称格式受限', () => {
  assert.equal(canSaveAgentIdentity({ name: '前端工程师', englishName: 'frontend-dev' }), true);
  assert.equal(canSaveAgentIdentity({ name: '', englishName: 'frontend-dev' }), false);
  assert.equal(canSaveAgentIdentity({ name: '前端工程师', englishName: '' }), false);
  assert.equal(canSaveAgentIdentity({ name: '前端工程师', englishName: '中文' }), false);
});
