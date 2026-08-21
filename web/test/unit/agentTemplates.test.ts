import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENT_TEMPLATES } from '../../src/components/agentTemplates';

test('Agent 模板 ID 必须唯一', () => {
  const ids = AGENT_TEMPLATES.map(template => template.id);
  assert.equal(new Set(ids).size, ids.length);
});
