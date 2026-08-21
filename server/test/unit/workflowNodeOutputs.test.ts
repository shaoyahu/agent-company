import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ProjectRepo } from '../../src/store/repository.js';
import { WorkflowNodeOutputRepo } from '../../src/store/workflowNodeOutputs.js';
import { cleanupDB, freshDB } from '../helpers/db.js';

let fixture: ReturnType<typeof freshDB>;

before(() => {
  fixture = freshDB();
  new ProjectRepo().create({
    id: 'project-1', title: '项目', boss: 'boss', status: 'idea', phase: 'idea', metadata: {},
  });
});
after(() => cleanupDB(fixture.dir, fixture.path));

test('节点输出可创建、完成并按轮次读取', () => {
  const repo = new WorkflowNodeOutputRepo();
  const running = repo.createRunning({
    projectId: 'project-1', workflowNodeId: 'stage-a', workflowNodeType: 'stage',
    runId: 'run-a', iteration: 0, inputSnapshot: [], createdAt: 1,
  });
  assert.equal(running.status, 'running');
  const completed = repo.complete('project-1', 'run-a', {
    outputText: '设计完成',
    outputTaskIds: ['task-1'],
    outputFileRefs: ['design.md'],
    controlResult: { type: 'condition', matched: true },
  });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.controlResult, { type: 'condition', matched: true });
  assert.equal(repo.findLatestCompleted('project-1', 'stage-a', 0)?.outputText, '设计完成');
  assert.equal(repo.findLatestCompleted('project-1', 'stage-a', 1), null);
});

test('重复创建同一运行记录不覆盖输入，失败记录不可作为成功输出读取', () => {
  const repo = new WorkflowNodeOutputRepo();
  const first = repo.createRunning({
    projectId: 'project-1', workflowNodeId: 'stage-b', workflowNodeType: 'stage',
    runId: 'run-b', iteration: 1,
    inputSnapshot: [{
      sourceNodeId: 'start', sourceRunId: 'run-start', sourceName: '开始',
      outputText: '原始需求', outputFileRefs: [],
    }],
    createdAt: 2,
  });
  const duplicate = repo.createRunning({
    projectId: 'project-1', workflowNodeId: 'stage-b', workflowNodeType: 'stage',
    runId: 'run-b', iteration: 1, inputSnapshot: [], createdAt: 3,
  });
  assert.deepEqual(duplicate.inputSnapshot, first.inputSnapshot);

  repo.fail('project-1', 'run-b', '执行失败');
  assert.equal(repo.findLatestCompleted('project-1', 'stage-b', 1), null);
});
