import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAgents,
  groupAgentsByDepartment,
} from '../../src/features/organization/organizationModel.ts';

const departments = [
  { id: 'root', name: '研发部' },
  { id: 'child', name: '前端组', parentId: 'root' },
] as any[];

const agents = [
  { id: 'a1', name: 'Alice', department: 'root', llm: 'm1', description: '' },
  { id: 'a2', name: 'Bob', department: 'child', llm: 'm2', description: 'UI' },
  { id: 'a3', name: 'Carol', department: 'missing', llm: 'm3', description: '' },
] as any[];

test('选择父部门时包含子部门 Agent', () => {
  assert.deepEqual(
    filterAgents(agents, departments, '', 'root').map((agent) => agent.id),
    ['a1', 'a2'],
  );
});

test('搜索覆盖名称、ID、描述和 LLM', () => {
  assert.deepEqual(
    filterAgents(agents, departments, ' ui ', null).map((agent) => agent.id),
    ['a2'],
  );
  assert.deepEqual(
    filterAgents(agents, departments, 'M3', null).map((agent) => agent.id),
    ['a3'],
  );
});

test('组织筛选对缺失字段和 hostile input 不抛', () => {
  for (const value of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.doesNotThrow(() => filterAgents([
      { id: value, department: value, llm: value },
      null,
    ] as any, departments, value as any, value as any));
  }
});

test('按部门分组保留未知部门', () => {
  const grouped = groupAgentsByDepartment(agents);
  assert.equal(grouped.get('root')?.length, 1);
  assert.equal(grouped.get('missing')?.[0].id, 'a3');
});
