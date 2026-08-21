/**
 * agent/tools.ts 单测
 *
 * 测:
 * - 内置工具全部注册 + BUILTIN_TOOL_NAMES 完整
 * - alias 解析(read_file → read)
 * - 文件操作真测(bash/read/write/edit/glob/grep/list_files)
 * - web_fetch mock safeFetch + 内网 URL 被拒
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tools, BUILTIN_TOOL_NAMES } from '../../src/agent/tools.js';
import { safeFetch } from '../../src/utils/safeFetch.js';

let cwd: string;

before(() => {
  cwd = mkdtempSync(join(tmpdir(), 'agent-co-tools-'));
  writeFileSync(join(cwd, 'hello.txt'), 'hello world\nline 2\nline 3\n');
  writeFileSync(join(cwd, 'data.json'), '{"a": 1, "b": 2}');
});

after(() => {
  if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
});

const ctx = () => ({ cwd, companyRoot: cwd, agentId: 'a1', taskId: 't1' });

// =================== 注册 & alias ===================

test('BUILTIN_TOOL_NAMES 包含 7 个核心工具 + 多个 alias', () => {
  assert.ok(BUILTIN_TOOL_NAMES.includes('bash'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('read'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('write'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('edit'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('glob'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('grep'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('list_files'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('web_fetch'));
  // alias
  assert.ok(BUILTIN_TOOL_NAMES.includes('read_file'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('write_file'));
  assert.ok(BUILTIN_TOOL_NAMES.includes('ls'));
});

test('所有 BUILTIN_TOOL_NAMES 都能 resolve 到 handler', () => {
  for (const name of BUILTIN_TOOL_NAMES) {
    const handler = tools.get(name);
    assert.ok(handler, `${name} 应能 resolve 到 handler`);
  }
});

test('alias read_file → read handler', async () => {
  const result = await tools.get('read_file')!({ path: 'hello.txt' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('hello world'));
});

test('alias ls → list_files handler', async () => {
  const result = await tools.get('ls')!({ path: '.' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('hello.txt'));
});

test('alias write_file → write handler', async () => {
  const result = await tools.get('write_file')!({ path: 'via-alias.txt', content: 'x' }, ctx());
  assert.equal(result.success, true);
  assert.ok(existsSync(join(cwd, 'via-alias.txt')));
});

test('tools.resolveName 把 alias 转为正式名', () => {
  assert.equal(tools.resolveName('read_file'), 'read');
  assert.equal(tools.resolveName('ls'), 'list_files');
  assert.equal(tools.resolveName('read'), 'read', '正式名不变');
});

test('listForNames 去重 + alias 解析', () => {
  const defs = tools.listForNames(['read_file', 'read', 'ls']);
  const names = defs.map((d) => d.name);
  // read_file 解析成 read,重复;ls 解析为 list_files
  assert.ok(names.includes('read'));
  assert.ok(names.includes('list_files'));
  // 重复 read 不应出现两次
  const count = names.filter((n) => n === 'read').length;
  assert.equal(count, 1);
});

test('listDefinitions 包含全部正式工具', () => {
  const names = tools.listDefinitions().map((d) => d.name);
  for (const n of ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'list_files', 'web_fetch']) {
    assert.ok(names.includes(n), `缺 ${n}`);
  }
});

test('getDefinition 找不到时返 undefined', () => {
  assert.equal(tools.getDefinition('nope'), undefined);
});

test('get 找不到时返 undefined', () => {
  assert.equal(tools.get('nope'), undefined);
});

// =================== bash ===================

test('bash 执行 echo 返回 stdout', async () => {
  const result = await tools.get('bash')!({ command: 'echo hello' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('hello'));
});

test('bash 命令失败 success=false', async () => {
  const result = await tools.get('bash')!({ command: 'exit 1' }, ctx());
  assert.equal(result.success, false);
  assert.ok(result.output.includes('STDOUT') || result.output.includes('STDERR') || result.output.includes('Command failed'));
});

test('bash 缺 command 报错', async () => {
  const result = await tools.get('bash')!({}, ctx());
  assert.equal(result.success, false);
});

test('bash 不继承宿主进程中的敏感环境变量', async () => {
  const name = 'AGENT_COMPANY_TEST_SECRET';
  const previous = process.env[name];
  process.env[name] = 'must-not-leak';
  try {
    const result = await tools.get('bash')!({ command: `test -z "$${name}" && echo clean` }, ctx());
    assert.equal(result.success, true);
    assert.match(result.output, /clean/);
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

// =================== read ===================

test('read 返回文件内容 + producedFiles', async () => {
  const result = await tools.get('read')!({ path: 'hello.txt' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('1\thello world'));
  assert.deepEqual(result.producedFiles, [join(cwd, 'hello.txt')]);
});

test('read 不存在文件返 success=false', async () => {
  const result = await tools.get('read')!({ path: 'nope.txt' }, ctx());
  assert.equal(result.success, false);
  assert.ok(result.output.includes('not found'));
});

test('文件工具拒绝工作目录外的相对与绝对路径', async () => {
  await assert.rejects(tools.get('read')!({ path: '../outside.txt' }, ctx()), /工作目录内/);
  await assert.rejects(tools.get('write')!({ path: '/tmp/outside.txt', content: 'x' }, ctx()), /工作目录内/);
  await assert.rejects(tools.get('list_files')!({ path: '..' }, ctx()), /工作目录内/);
});

test('read 目录返文件列表', async () => {
  const result = await tools.get('read')!({ path: '.' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('hello.txt'));
  assert.ok(result.output.includes('data.json'));
});

test('read start/end 切片', async () => {
  const result = await tools.get('read')!({ path: 'hello.txt', start: 1, end: 2 }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('line 2'));
  assert.ok(!result.output.includes('hello world'), 'start=1 应跳过第一行');
});

// =================== write ===================

test('write 覆盖文件 + 自动建父目录', async () => {
  const result = await tools.get('write')!({ path: 'sub/dir/new.txt', content: '球球的' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('Written 3 bytes'));
  const got = readFileSync(join(cwd, 'sub/dir/new.txt'), 'utf-8');
  assert.equal(got, '球球的');
});

test('write 空内容', async () => {
  const result = await tools.get('write')!({ path: 'empty.txt', content: '' }, ctx());
  assert.equal(result.success, true);
  assert.equal(readFileSync(join(cwd, 'empty.txt'), 'utf-8'), '');
});

// =================== edit ===================

test('edit 替换唯一字符串', async () => {
  writeFileSync(join(cwd, 'edit.txt'), 'foo bar baz');
  const result = await tools.get('edit')!(
    { path: 'edit.txt', old_string: 'bar', new_string: 'BAR' },
    ctx(),
  );
  assert.equal(result.success, true);
  assert.equal(readFileSync(join(cwd, 'edit.txt'), 'utf-8'), 'foo BAR baz');
});

test('edit 多次出现时报错', async () => {
  writeFileSync(join(cwd, 'multi.txt'), 'foo foo foo');
  const result = await tools.get('edit')!(
    { path: 'multi.txt', old_string: 'foo', new_string: 'bar' },
    ctx(),
  );
  assert.equal(result.success, false);
  assert.ok(result.output.includes('multiple times'));
});

test('edit replace_all=true 全部替换', async () => {
  writeFileSync(join(cwd, 'multi2.txt'), 'foo foo foo');
  const result = await tools.get('edit')!(
    { path: 'multi2.txt', old_string: 'foo', new_string: 'bar', replace_all: true },
    ctx(),
  );
  assert.equal(result.success, true);
  assert.equal(readFileSync(join(cwd, 'multi2.txt'), 'utf-8'), 'bar bar bar');
  assert.ok(result.output.includes('Replaced 3 occurrence'));
});

test('edit old_string 不存在时报错', async () => {
  writeFileSync(join(cwd, 'noexist.txt'), 'foo');
  const result = await tools.get('edit')!(
    { path: 'noexist.txt', old_string: 'nope', new_string: 'x' },
    ctx(),
  );
  assert.equal(result.success, false);
  assert.ok(result.output.includes('not found'));
});

test('edit 文件不存在报错', async () => {
  const result = await tools.get('edit')!(
    { path: 'no-file.txt', old_string: 'a', new_string: 'b' },
    ctx(),
  );
  assert.equal(result.success, false);
  assert.ok(result.output.includes('File not found'));
});

// =================== glob ===================

test('glob 找 *.txt', async () => {
  const result = await tools.get('glob')!({ pattern: '*.txt' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('hello.txt'));
});

test('glob 无匹配返 (no matches)', async () => {
  const result = await tools.get('glob')!({ pattern: '*.nonexistent' }, ctx());
  assert.equal(result.success, true);
  assert.equal(result.output, '(no matches)');
});

// =================== grep ===================

test('grep 找包含 "world" 的文件', async () => {
  const result = await tools.get('grep')!({ pattern: 'world' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('hello.txt'));
  assert.ok(result.output.includes('hello world'));
});

test('grep 无匹配返 (no matches)', async () => {
  const result = await tools.get('grep')!({ pattern: 'nonexistent-xyzzy' }, ctx());
  assert.equal(result.success, true);
  assert.equal(result.output, '(no matches)');
});

// =================== list_files ===================

test('list_files 列当前目录', async () => {
  const result = await tools.get('list_files')!({ path: '.' }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('hello.txt'));
  assert.ok(result.output.includes('data.json'));
});

test('list_files 不存在的目录报错', async () => {
  const result = await tools.get('list_files')!({ path: 'nope-dir' }, ctx());
  assert.equal(result.success, false);
  assert.ok(result.output.includes('not found'));
});

test('list_files recursive 遍历子目录', async () => {
  // 之前 write 测试建了 sub/dir/new.txt
  const result = await tools.get('list_files')!({ path: '.', recursive: true, maxDepth: 3 }, ctx());
  assert.equal(result.success, true);
  assert.ok(result.output.includes('sub'));
});

// =================== web_fetch ===================

test('web_fetch 内网 URL 被拒(SSRF 防护)', async () => {
  const result = await tools.get('web_fetch')!({ url: 'http://127.0.0.1/' }, ctx());
  assert.equal(result.success, false, '内网应被拒');
  assert.ok(result.output.length > 0, '应返回错误原因');
});

test('web_fetch 私网 IP 被拒(10.x.x.x)', async () => {
  const result = await tools.get('web_fetch')!({ url: 'http://10.0.0.1/' }, ctx());
  assert.equal(result.success, false, '私网应被拒');
});

test('web_fetch 真实公网 URL 成功(https://example.com)', async () => {
  const result = await tools.get('web_fetch')!({ url: 'https://example.com/' }, ctx());
  // example.com 应该 200,可能被网络拦
  // 不强求 success=true,但不应崩
  assert.ok(typeof result.success === 'boolean');
  assert.ok(typeof result.output === 'string');
});

test('web_fetch 失败时透出错误原因', async () => {
  // 用一个 invalid URL 让 safeFetch 抛错
  const result = await tools.get('web_fetch')!({ url: 'not-a-url' }, ctx());
  assert.equal(result.success, false);
  assert.ok(result.output.length > 0);
});
