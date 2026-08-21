export type CliModelsParser =
  | { type: 'lines' }
  | { type: 'json-path'; path: string }
  | { type: 'regex'; pattern: string };

export type CliToolConfigDraft = {
  command: string;
  argsTemplate: string;
  stdinTemplate: string;
  staticModels: string[];
  modelsCommand: string;
  modelsParser: CliModelsParser;
  timeoutMs: number;
  modelsTimeoutMs: number;
};

export type DiscoveredCli = {
  id: string;
  label: string;
  executable: string;
  path: string;
  preset: 'trae' | 'claude' | 'codex' | 'gemini' | 'opencode' | null;
};

export type DiscoveredCliSelection = {
  name: string;
  description: string;
  config: CliToolConfigDraft;
};

export type CliConfigurationState = {
  ready: boolean;
  title: string;
  description: string;
};

const stringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

const positiveNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const own = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;

export function normalizeCliToolConfig(value: unknown): CliToolConfigDraft {
  const config = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const rawParser = own(config, 'modelsParser');
  const parser = rawParser && typeof rawParser === 'object'
    ? rawParser as Record<string, unknown>
    : {};
  const parserType = own(parser, 'type');

  let modelsParser: CliModelsParser = { type: 'lines' };
  if (parserType === 'json-path') {
    modelsParser = { type: 'json-path', path: stringValue(own(parser, 'path')) };
  } else if (parserType === 'regex') {
    modelsParser = { type: 'regex', pattern: stringValue(own(parser, 'pattern')) };
  }

  return {
    command: stringValue(own(config, 'command')),
    argsTemplate: stringValue(own(config, 'argsTemplate')),
    stdinTemplate: stringValue(own(config, 'stdinTemplate'), '{prompt}'),
    staticModels: Array.isArray(own(config, 'staticModels'))
      ? [...new Set((own(config, 'staticModels') as unknown[])
        .filter((model): model is string => typeof model === 'string')
        .map(model => model.trim())
        .filter(Boolean))]
      : [],
    modelsCommand: stringValue(own(config, 'modelsCommand')),
    modelsParser,
    timeoutMs: positiveNumber(own(config, 'timeoutMs'), 600000),
    modelsTimeoutMs: positiveNumber(own(config, 'modelsTimeoutMs'), 15000),
  };
}

export function applyDiscoveredCli(value: unknown): DiscoveredCliSelection {
  if (!value || typeof value !== 'object') {
    return { name: '', description: '', config: normalizeCliToolConfig(null) };
  }
  const candidate = value as Record<string, unknown>;
  const name = stringValue(own(candidate, 'id'));
  const label = stringValue(own(candidate, 'label'));
  const path = stringValue(own(candidate, 'path'));
  const preset = own(candidate, 'preset');
  if (!name || !path) {
    return { name: '', description: '', config: normalizeCliToolConfig(null) };
  }

  if (preset === 'trae') {
    return {
      name,
      description: `${label || name} 本机 CLI`,
      config: normalizeCliToolConfig({
        command: path,
        argsTemplate: 'exec --skip-git-repo-check --ephemeral --ignore-user-config --sandbox workspace-write --model {model}',
        stdinTemplate: '{prompt}',
        modelsCommand: 'models',
        modelsParser: { type: 'lines' },
      }),
    };
  }

  const recommended = preset === 'claude'
    ? { argsTemplate: '-p {prompt:q}', staticModels: ['default'] }
    : preset === 'codex'
      ? { argsTemplate: 'exec --skip-git-repo-check --sandbox workspace-write {prompt:q}', staticModels: ['default'] }
      : preset === 'gemini'
        ? { argsTemplate: '-p {prompt:q} --model {model}', staticModels: ['auto', 'pro', 'flash', 'flash-lite'] }
        : preset === 'opencode'
          ? { argsTemplate: 'run {prompt:q}', staticModels: ['default'] }
          : null;
  if (recommended) {
    return {
      name,
      description: `${label || name} 本机 CLI`,
      config: normalizeCliToolConfig({
        command: path,
        argsTemplate: recommended.argsTemplate,
        stdinTemplate: '',
        staticModels: recommended.staticModels,
      }),
    };
  }

  return {
    name,
    description: `${label || name} 本机 CLI`,
    config: normalizeCliToolConfig({ command: path, stdinTemplate: '{prompt}' }),
  };
}

export function getCliConfigurationState(value: unknown): CliConfigurationState {
  const config = normalizeCliToolConfig(value);
  const ready = !!config.command.trim()
    && !!config.argsTemplate.trim()
    && (config.staticModels.length > 0 || !!config.modelsCommand.trim());
  return ready
    ? {
        ready: true,
        title: '配置已就绪',
        description: config.staticModels.length > 0
          ? '已使用推荐模型选项，可以直接测试并添加。'
          : '可以直接测试模型列表，确认成功后添加。',
      }
    : {
        ready: false,
        title: '还需完成高级配置',
        description: '此 CLI 没有可靠预设，需要填写模型列表命令和执行参数。',
      };
}
