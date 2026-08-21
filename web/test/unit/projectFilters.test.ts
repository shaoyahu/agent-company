import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndSortProjects,
  getProjectProgress,
  getProjectStatusMeta,
} from '../../src/features/projects/projectFilters.ts';

const projects = [
  { id: 'a', title: 'Alpha 项目', status: 'dev', phase: 'dev', updatedAt: 1 },
  { id: 'b', title: 'Beta 项目', status: 'failed', phase: 'qa', updatedAt: 3 },
  { id: 'c', title: 'Gamma', status: 'done', phase: 'done', updatedAt: 2 },
] as any[];

test('项目按查询、状态和阶段筛选', () => {
  assert.deepEqual(
    filterAndSortProjects(projects, ' beta ', 'failed', 'qa').map((item) => item.id),
    ['b'],
  );
});

test('空筛选按更新时间倒序', () => {
  assert.deepEqual(
    filterAndSortProjects(projects, '', 'all', 'all').map((item) => item.id),
    ['b', 'c', 'a'],
  );
});

test('未知筛选值和 hostile input 不导致崩溃', () => {
  for (const value of [undefined, null, '__proto__', 'constructor', '   ']) {
    assert.doesNotThrow(() => filterAndSortProjects([
      { id: value, title: value, updatedAt: undefined },
      null,
    ] as any, value as any, value as any, value as any));
  }
});

test('项目阶段映射为稳定进度并对未知值兜底', () => {
  assert.equal(getProjectProgress('idea'), 8);
  assert.equal(getProjectProgress('dev'), 60);
  assert.equal(getProjectProgress('done'), 100);
  assert.equal(getProjectProgress('__proto__'), 0);
  assert.equal(getProjectProgress(undefined), 0);
});

test('项目状态元数据对 hostile key 使用中性兜底', () => {
  assert.deepEqual(getProjectStatusMeta('failed'), {
    label: '失败',
    tone: 'danger',
  });
  for (const value of [undefined, null, '', '__proto__', 'constructor']) {
    const meta = getProjectStatusMeta(value);
    assert.equal(typeof meta.label, 'string');
    assert.equal(meta.tone, 'neutral');
  }
});
