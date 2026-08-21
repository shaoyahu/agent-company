import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { StoredCustomTool } from '../../src/store/customTools.js';
import {
  clearCliModelsCache,
  discoverCliModels,
  parseCliModels,
} from '../../src/agent/cliModels.js';

function tool(config: Record<string, unknown>): StoredCustomTool {
  return {
    id: 'cli-1',
    name: 'test-cli',
    type: 'cli',
    description: '',
    enabled: true,
    config: config as any,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(clearCliModelsCache);

test('lines 解析会 trim、过滤空行并去重', () => {
  assert.deepEqual(parseCliModels(' a \n\nb\na\n', { type: 'lines' }), ['a', 'b']);
});

test('json-path 从对象数组提取字段', () => {
  const output = JSON.stringify({ data: { models: [{ id: 'm1' }, { id: 'm2' }] } });
  assert.deepEqual(
    parseCliModels(output, { type: 'json-path', path: 'data.models[].id' }),
    ['m1', 'm2'],
  );
});

test('regex 按捕获组全局提取', () => {
  assert.deepEqual(
    parseCliModels('model=m1\nmodel=m2', {
      type: 'regex',
      pattern: 'model=(\\S+)',
      group: 1,
    }),
    ['m1', 'm2'],
  );
});

for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor']) {
  test(`hostile parser ${String(hostile)} 不抛 TypeError`, () => {
    assert.throws(() => parseCliModels('m1', hostile as any), /解析|parser|type/i);
  });
}

test('json-path 拒绝原型链字段', () => {
  assert.throws(
    () => parseCliModels('{"x":"m1"}', { type: 'json-path', path: '__proto__.x' }),
    /非法|路径/,
  );
});

test('CLI 不存在时不可用', async () => {
  const result = await discoverCliModels(tool({
    command: '/no/such/cli',
    argsTemplate: '',
    modelsCommand: 'models',
    modelsParser: { type: 'lines' },
  }));
  assert.equal(result.available, false);
  assert.match(result.error ?? '', /不存在|不可执行/);
});

test('静态模型配置不执行模型探测命令', async () => {
  const result = await discoverCliModels(tool({
    command: '/bin/sh',
    argsTemplate: '',
    staticModels: ['default', 'pro', 'default', '  '],
  }));

  assert.deepEqual(result, {
    available: true,
    models: ['default', 'pro'],
    cached: false,
  });
});

test('真实命令输出模型并命中缓存', async () => {
  const input = tool({
    command: '/bin/sh',
    argsTemplate: '',
    modelsCommand: '-c "printf m1; /bin/echo; printf m2; /bin/echo"',
    modelsParser: { type: 'lines' },
  });
  const first = await discoverCliModels(input);
  const second = await discoverCliModels(input);
  assert.deepEqual(first.models, ['m1', 'm2']);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
});

test('非零退出透出真实错误', async () => {
  const result = await discoverCliModels(tool({
    command: '/bin/sh',
    argsTemplate: '',
    modelsCommand: '-c "echo model-error 1>&2; exit 2"',
    modelsParser: { type: 'lines' },
  }));
  assert.equal(result.available, false);
  assert.match(result.error ?? '', /exit 2/);
  assert.match(result.error ?? '', /model-error/);
});
