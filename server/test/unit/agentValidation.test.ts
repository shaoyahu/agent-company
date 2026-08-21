import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAgentRequiredFields } from '../../src/api/agentValidation.js';

const base = {
  id: 'worker-1',
  department: 'dev',
  role: 'worker',
};

test('LLM Agent 必须选择 LLM Provider', () => {
  assert.equal(
    validateAgentRequiredFields({ ...base, executor: 'llm', llm: '' }),
    'LLM Agent 必须选择 LLM Provider',
  );
});

test('CLI Agent 不要求 LLM Provider', () => {
  assert.equal(
    validateAgentRequiredFields({ ...base, executor: 'cli', llm: '' }),
    undefined,
  );
});

test('未知执行器按 LLM Agent 校验', () => {
  assert.equal(
    validateAgentRequiredFields({ ...base, executor: 'constructor', llm: '' }),
    'LLM Agent 必须选择 LLM Provider',
  );
});
