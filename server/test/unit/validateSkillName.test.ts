// 球球 review 2026-08-15 C1 + C2:路径穿越 3 个 critical case 必须有单测
// scanner 接收的 name 来自 frontmatter (user-controlled),完全不可信
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  isValidSkillName,
  assertValidSkillName,
  assertPathWithin,
  InvalidSkillNameError,
} from '../../src/utils/validateSkillName.js';

// ─── isValidSkillName 纯字符串层 ──────────────────────────────

test('isValidSkillName — 合法名字通过', () => {
  assert.equal(isValidSkillName('a'), true);
  assert.equal(isValidSkillName('hello'), true);
  assert.equal(isValidSkillName('hello-world'), true);
  assert.equal(isValidSkillName('hello_world'), true);
  assert.equal(isValidSkillName('hello123'), true);
  assert.equal(isValidSkillName('a1b2c3'), true);
  assert.equal(isValidSkillName('claude-skill-001'), true);
});

test('isValidSkillName — 路径穿越攻击(球球 review 必测)', () => {
  assert.equal(isValidSkillName('../../../etc/passwd'), false, '../ 必须拒');
  assert.equal(isValidSkillName('..'), false, '裸 .. 必须拒');
  assert.equal(isValidSkillName('../foo'), false);
  assert.equal(isValidSkillName('foo/../bar'), false);
  assert.equal(isValidSkillName('foo/bar'), false, '/ 必须拒');
  assert.equal(isValidSkillName('foo\\bar'), false, '\\ 必须拒');
  assert.equal(isValidSkillName('foo\0bar'), false, 'null byte 必须拒');
});

test('isValidSkillName — 边界长度', () => {
  assert.equal(isValidSkillName(''), false, '空字符串拒');
  assert.equal(isValidSkillName('a'.repeat(64)), true, '64 字符 ok');
  assert.equal(isValidSkillName('a'.repeat(65)), false, '65 字符超长拒');
});

test('isValidSkillName — 非法字符(球球 review 必测)', () => {
  assert.equal(isValidSkillName('Hello'), false, '大写字母拒(规范 lowercase)');
  assert.equal(isValidSkillName('-hello'), false, '首字符不能 - (正则要求 alphanumeric)');
  assert.equal(isValidSkillName('_hello'), false, '首字符不能 _');
  assert.equal(isValidSkillName('hello world'), false, '空格拒');
  assert.equal(isValidSkillName('hello.world'), false, '. 拒');
  assert.equal(isValidSkillName('hello@world'), false);
  assert.equal(isValidSkillName('héllo'), false, 'unicode 拒');
  assert.equal(isValidSkillName('中文'), false, '中文拒');
});

test('isValidSkillName — null/undefined/非 string', () => {
  assert.equal(isValidSkillName(null as any), false);
  assert.equal(isValidSkillName(undefined as any), false);
  assert.equal(isValidSkillName(123 as any), false);
  assert.equal(isValidSkillName({} as any), false);
});

// ─── assertValidSkillName 抛错版 ──────────────────────────────

test('assertValidSkillName — 合法不抛', () => {
  assert.doesNotThrow(() => assertValidSkillName('hello-world'));
});

test('assertValidSkillName — 非法抛 InvalidSkillNameError', () => {
  assert.throws(
    () => assertValidSkillName('../etc/passwd'),
    (err: unknown) => err instanceof InvalidSkillNameError,
  );
});

test('assertValidSkillName — 错误信息含 name + 原因(球球 review 强调中文错因)', () => {
  try {
    assertValidSkillName('../etc/passwd');
    assert.fail('应该抛错');
  } catch (err: any) {
    assert.ok(err.message.includes('../etc/passwd'), 'err.message 应含原 name');
    assert.ok(err.message.includes('must be'), 'err.message 应含校验原因');
  }
});

// ─── assertPathWithin 路径层(球球 review C2 必测) ──────────────────────────────

test('assertPathWithin — 合法 name 返 resolve 后的绝对路径', () => {
  const root = '/tmp/skills';
  const result = assertPathWithin('hello', root);
  assert.equal(result, resolve(root, 'hello'));
});

test('assertPathWithin — ../ 路径穿越必须抛(防 normalize 之前绕过)', () => {
  // 即便 assertValidSkillName 先拦,这一层是 defense-in-depth
  // 这里直接测 resolve 行为(假设 name 通过校验,但 resolve 后越界)
  // 实际场景:被 bypass isValidSkillName 后 assertPathWithin 是最后兜底
  const root = '/tmp/skills';
  // 模拟攻击:传入 .. 但绕过 isValidSkillName(假设校验逻辑有 bug)
  // 我们的 regex 已经挡了 ..,所以这测的是"如果 regex 漏了,path 层也兜底"
  // 直接调 assertPathWithin('..', root) — resolve 后会跳到 root 父目录
  assert.throws(
    () => assertPathWithin('..', root),
    (err: unknown) => err instanceof InvalidSkillNameError && /escapes skills root/.test(err.message),
  );
});

test('assertPathWithin — 绝对路径名(name 字段含 / 或 ..)被拒', () => {
  // 这种 name 已经被 isValidSkillName 拒了,但如果绕过去,resolve 后会逃出 root
  const root = '/tmp/skills';
  assert.throws(
    () => assertPathWithin('/etc/passwd', root),
    (err: unknown) => err instanceof InvalidSkillNameError,
  );
});

test('assertPathWithin — 合法 name 不抛,return 路径在 root 内', () => {
  const root = '/tmp/skills-xyz';
  const result = assertPathWithin('my-skill', root);
  assert.ok(result.startsWith(root), '返回路径必须在 root 内');
  assert.ok(result.endsWith('my-skill'), '返回路径以 name 结尾');
});
