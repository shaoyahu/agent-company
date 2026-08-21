import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDepartmentPayload,
  canSaveDepartmentEditor,
} from '../../src/features/organization/departmentEditorModel.js';

test('buildDepartmentPayload:新建部门只提交业务字段并用英文名称生成 id', () => {
  assert.deepEqual(
    buildDepartmentPayload({
      existing: null,
      name: '开发部',
      englishName: 'dev',
      parentId: 'root',
      description: '负责软件开发。',
    }),
    {
      id: 'dev',
      name: '开发部',
      parentId: 'root',
      description: '负责软件开发。',
    },
  );
});

test('buildDepartmentPayload:不提交 head 和 teams', () => {
  const payload = buildDepartmentPayload({
    existing: { id: 'dev', name: '旧开发部', head: 'legacy-head', teams: ['copy'] },
    name: '开发部',
    englishName: 'dev',
    description: '',
  });

  assert.equal('head' in payload, false);
  assert.equal('teams' in payload, false);
});

test('canSaveDepartmentEditor:只要求部门名称和英文名称', () => {
  assert.equal(canSaveDepartmentEditor({ name: '开发部', englishName: 'dev' }), true);
  assert.equal(canSaveDepartmentEditor({ name: '', englishName: 'dev' }), false);
  assert.equal(canSaveDepartmentEditor({ name: '开发部', englishName: '' }), false);
  assert.equal(canSaveDepartmentEditor({ name: '开发部', englishName: '中文' }), false);
});
