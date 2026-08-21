import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projectsPage = readFileSync(
  new URL('../../src/features/projects/ProjectsPage.tsx', import.meta.url),
  'utf8',
);

const appSource = readFileSync(
  new URL('../../src/App.tsx', import.meta.url),
  'utf8',
);

test('ProjectsPage 提供删除项目入口且确认文案说明不删除文件', () => {
  assert.match(projectsPage, /Trash2/);
  assert.match(projectsPage, /onDeleteProject/);
  assert.match(projectsPage, /删除项目记录/);
  assert.match(projectsPage, /项目目录和文件会保留/);
  assert.match(projectsPage, /confirmText: '删除记录'/);
});

test('ProjectsPage 项目行不是嵌套 button,打开和删除是独立按钮', () => {
  assert.match(projectsPage, /<article\s+className="project-list-row"/);
  assert.match(projectsPage, /className="project-list-row__open"/);
  assert.match(projectsPage, /className="project-list-row__delete"/);
  assert.doesNotMatch(projectsPage, /<button[\s\S]*className="project-list-row"[\s\S]*<button/);
});

test('App 删除当前项目后刷新列表并离开已删除详情页', () => {
  assert.match(appSource, /handleDeleteProject/);
  assert.match(appSource, /api\.deleteProject\(project\.id\)/);
  assert.match(appSource, /setProjects\(prev => prev\.filter/);
  assert.match(appSource, /route\.view === 'project'/);
  assert.match(appSource, /navigate\(\{ view: 'projects' \}\)/);
});
