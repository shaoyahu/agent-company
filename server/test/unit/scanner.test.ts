// scanner 单测 — install / uninstall / 路径校验
// 球球 review C1 + C2:scanner 接收的 name 完全不可信
// 用临时 HOME + chdir 隔离(避免污染用户家目录)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  installFromContent,
  uninstallSkill,
  listSkills,
  getSkill,
} from '../../src/skills/scanner.js';
import { InvalidSkillNameError } from '../../src/utils/validateSkillName.js';

let fakeHome: string;
let fakeCwd: string;
let origHome: string | undefined;
let origCwd: string;

before(() => {
  // 隔离:scanner 用 homedir() + process.cwd(),分别重定向以验证 user/project 优先级
  fakeHome = mkdtempSync(join(tmpdir(), 'scanner-test-'));
  fakeCwd = mkdtempSync(join(tmpdir(), 'scanner-cwd-'));
  origHome = process.env.HOME;
  origCwd = process.cwd();
  process.env.HOME = fakeHome;
  process.chdir(fakeCwd);
});

after(() => {
  process.chdir(origCwd);
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(fakeCwd, { recursive: true, force: true });
});

const VALID_SKILL_MD = `---
name: test-skill
description: 球球的测试 skill
---

# Test Skill Body

正文内容,用于 agent 调用时注入。`;

test('installFromContent — 合法 SKILL.md 安装到 ~/.minimax/skills/test-skill/', async () => {
  const result = await installFromContent(VALID_SKILL_MD);
  assert.equal(result.name, 'test-skill');
  assert.equal(result.source, 'content');
  // 文件应写到 <HOME>/.minimax/skills/test-skill/SKILL.md
  const dest = join(fakeHome, '.minimax', 'skills', 'test-skill', 'SKILL.md');
  assert.ok(existsSync(dest), `应创建 ${dest}`);
});

test('installFromContent — 非法 name(frontmatter 写 ../etc)被 assertValidSkillName 拦', async () => {
  const evil = `---
name: ../etc/passwd
description: evil
---
body`;
  await assert.rejects(
    installFromContent(evil),
    (err: unknown) => err instanceof InvalidSkillNameError,
  );
});

test('installFromContent — 无 frontmatter 抛错', async () => {
  const noFm = '# 没 frontmatter';
  await assert.rejects(installFromContent(noFm), /frontmatter/);
});

test('installFromContent — 空内容抛错', async () => {
  await assert.rejects(installFromContent(''), /empty/);
  await assert.rejects(installFromContent('   \n  '), /empty/);
});

test('uninstallSkill — 卸载刚装的 skill', async () => {
  await installFromContent(VALID_SKILL_MD);
  const result = uninstallSkill(process.cwd(), 'test-skill');
  assert.equal(result.removed, join(fakeHome, '.minimax', 'skills', 'test-skill'));
  // 文件应已删
  const dest = join(fakeHome, '.minimax', 'skills', 'test-skill', 'SKILL.md');
  assert.ok(!existsSync(dest), '应已卸载');
});

test('uninstallSkill — 项目级 skill 使用显式 companyRoot 而不是 cwd', () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'scanner-company-root-'));
  const skillDir = join(companyRoot, '.minimax', 'skills', 'project-only');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: project-only\ndescription: 项目级\n---\n\nbody',
  );

  try {
    const result = uninstallSkill(companyRoot, 'project-only');
    assert.equal(result.removed, skillDir);
    assert.equal(existsSync(skillDir), false);
  } finally {
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('uninstallSkill — 同名 skill 按读取优先级先卸载项目级', () => {
  const companyRoot = mkdtempSync(join(tmpdir(), 'scanner-priority-root-'));
  const userDir = join(fakeHome, '.minimax', 'skills', 'same-name');
  const projectDir = join(companyRoot, '.minimax', 'skills', 'same-name');
  mkdirSync(userDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(userDir, 'SKILL.md'),
    '---\nname: same-name\ndescription: 用户级\n---\n\nuser body',
  );
  writeFileSync(
    join(projectDir, 'SKILL.md'),
    '---\nname: same-name\ndescription: 项目级\n---\n\nproject body',
  );

  try {
    assert.equal(getSkill(companyRoot, 'same-name')?.source, 'project');
    const result = uninstallSkill(companyRoot, 'same-name');
    assert.equal(result.removed, projectDir);
    assert.equal(existsSync(projectDir), false);
    assert.equal(getSkill(companyRoot, 'same-name')?.source, 'user');
  } finally {
    rmSync(userDir, { recursive: true, force: true });
    rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('uninstallSkill — 路径穿越 name(球球 review C1)被 assertValidSkillName 拦', () => {
  assert.throws(
    () => uninstallSkill(process.cwd(), '../../../etc'),
    (err: unknown) => err instanceof InvalidSkillNameError,
  );
});

test('uninstallSkill — 不存在的 skill 抛错', () => {
  assert.throws(
    () => uninstallSkill(process.cwd(), 'never-installed'),
    /not found/,
  );
});

test('listSkills — 装一个后能列出', async () => {
  await installFromContent(VALID_SKILL_MD);
  const skills = listSkills(process.cwd());
  const found = skills.find(s => s.name === 'test-skill');
  assert.ok(found, '应能找到 test-skill');
  assert.equal(found!.source, 'user');
});

test('getSkill — 装一个后能 get 详情(球球 review C1:read 也走校验)', async () => {
  await installFromContent(VALID_SKILL_MD);
  const detail = getSkill(process.cwd(), 'test-skill');
  assert.ok(detail);
  assert.equal(detail!.name, 'test-skill');
  assert.equal(detail!.description, '球球的测试 skill');
  assert.match(detail!.body, /Test Skill Body/);
});

test('getSkill — 路径穿越 name 也被拦(球球 review C1)', () => {
  assert.throws(
    () => getSkill(process.cwd(), '../etc'),
    (err: unknown) => err instanceof InvalidSkillNameError,
  );
});

test('getSkill — 不存在返 null,不抛', () => {
  assert.equal(getSkill(process.cwd(), 'nonexistent'), null);
});
