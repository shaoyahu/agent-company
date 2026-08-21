import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardSummary } from '../../src/features/dashboard/dashboardModel.ts';

test('工作台摘要正确统计运行状态', () => {
  const summary = buildDashboardSummary({
    agents: [{ id: 'a1' }, { id: 'a2' }],
    providers: [{ id: 'p1' }],
    departments: [{ id: 'd1' }],
  } as any, [
    { id: '1', status: 'dev', updatedAt: 10 },
    { id: '2', status: 'done', updatedAt: 20 },
    { id: '3', status: 'failed', updatedAt: 30 },
  ] as any);

  assert.equal(summary.agentCount, 2);
  assert.equal(summary.providerCount, 1);
  assert.equal(summary.activeProjectCount, 1);
  assert.equal('failedProjectCount' in summary, false);
  assert.equal('attentionProjects' in summary, false);
  assert.equal('recentProjects' in summary, false);
});

test('工作台摘要对缺失数组和未知状态安全兜底', () => {
  assert.doesNotThrow(() => buildDashboardSummary({} as any, [
    { id: '__proto__', status: 'constructor' },
    null,
  ] as any));

  const summary = buildDashboardSummary({} as any, undefined as any);
  assert.equal(summary.agentCount, 0);
  assert.equal(summary.providerCount, 0);
    assert.equal(summary.activeProjectCount, 0);
});
