import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyDiscoveredCli,
  getCliConfigurationState,
  normalizeCliToolConfig,
} from '../../src/features/settings/cliToolModel';

test('CLI 配置补齐安全默认值', () => {
  assert.deepEqual(normalizeCliToolConfig(null), {
    command: '',
    argsTemplate: '',
    stdinTemplate: '{prompt}',
    staticModels: [],
    modelsCommand: '',
    modelsParser: { type: 'lines' },
    timeoutMs: 600000,
    modelsTimeoutMs: 15000,
  });
});

test('CLI 配置保留合法解析规则', () => {
  assert.deepEqual(
    normalizeCliToolConfig({
      command: '/usr/local/bin/acme',
      argsTemplate: 'run --model {model}',
      stdinTemplate: '',
      staticModels: [],
      modelsCommand: 'models --json',
      modelsParser: { type: 'json-path', path: 'data.models' },
      timeoutMs: 120000,
      modelsTimeoutMs: 5000,
    }),
    {
      command: '/usr/local/bin/acme',
      argsTemplate: 'run --model {model}',
      stdinTemplate: '',
      staticModels: [],
      modelsCommand: 'models --json',
      modelsParser: { type: 'json-path', path: 'data.models' },
      timeoutMs: 120000,
      modelsTimeoutMs: 5000,
    },
  );
});

test('CLI 配置对 hostile input 使用默认值', () => {
  for (const value of [undefined, '', '   ', '__proto__', 'constructor', { modelsParser: { type: 'constructor' } }]) {
    assert.doesNotThrow(() => normalizeCliToolConfig(value));
    assert.equal(normalizeCliToolConfig(value).modelsParser.type, 'lines');
  }
});

test('选择 Trae CLI 应用已验证的完整预设', () => {
  const selected = applyDiscoveredCli({
    id: 'trae-cli',
    label: 'Trae CLI',
    executable: 'traecli',
    path: '/Users/test/.local/bin/traecli',
    preset: 'trae',
  });

  assert.equal(selected.name, 'trae-cli');
  assert.equal(selected.config.command, '/Users/test/.local/bin/traecli');
  assert.equal(selected.config.modelsCommand, 'models');
  assert.match(selected.config.argsTemplate, /--model \{model\}/);
  assert.equal(selected.config.stdinTemplate, '{prompt}');
});

test('已识别 CLI 应用可直接运行的推荐配置', () => {
  const cases = [
    { id: 'claude-code', label: 'Claude Code', executable: 'claude', preset: 'claude', args: /-p \{prompt:q\}/, models: ['default'] },
    { id: 'codex-cli', label: 'Codex CLI', executable: 'codex', preset: 'codex', args: /exec .*{prompt:q}/, models: ['default'] },
    { id: 'gemini-cli', label: 'Gemini CLI', executable: 'gemini', preset: 'gemini', args: /-p \{prompt:q\} --model \{model\}/, models: ['auto', 'pro', 'flash', 'flash-lite'] },
    { id: 'opencode', label: 'OpenCode', executable: 'opencode', preset: 'opencode', args: /run \{prompt:q\}/, models: ['default'] },
  ] as const;

  for (const item of cases) {
    const selected = applyDiscoveredCli({
      ...item,
      path: `/usr/local/bin/${item.executable}`,
    });

    assert.equal(selected.name, item.id);
    assert.match(selected.config.argsTemplate, item.args);
    assert.deepEqual(selected.config.staticModels, item.models);
    assert.equal(selected.config.modelsCommand, '');
    assert.equal(selected.config.stdinTemplate, '');
  }
});

test('本机 CLI 快速选择对 hostile input 安全兜底', () => {
  for (const value of [undefined, null, '', '__proto__', 'constructor']) {
    assert.doesNotThrow(() => applyDiscoveredCli(value as any));
    assert.deepEqual(applyDiscoveredCli(value as any), {
      name: '',
      description: '',
      config: normalizeCliToolConfig(null),
    });
  }
});

test('完整 CLI 配置显示为可直接测试', () => {
  assert.deepEqual(getCliConfigurationState({
    command: '/Users/test/.local/bin/traecli',
    argsTemplate: 'exec --model {model}',
    stdinTemplate: '{prompt}',
    modelsCommand: 'models',
    modelsParser: { type: 'lines' },
  }), {
    ready: true,
    title: '配置已就绪',
    description: '可以直接测试模型列表，确认成功后添加。',
  });
});

test('缺少模型命令时提示进入高级配置', () => {
  assert.deepEqual(getCliConfigurationState({
    command: '/usr/local/bin/claude',
  }), {
    ready: false,
    title: '还需完成高级配置',
    description: '此 CLI 没有可靠预设，需要填写模型列表命令和执行参数。',
  });
});

test('CLI 配置状态对 hostile input 安全兜底', () => {
  for (const value of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.doesNotThrow(() => getCliConfigurationState(value));
    assert.equal(getCliConfigurationState(value).ready, false);
  }
});
