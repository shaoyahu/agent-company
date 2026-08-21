import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import type {
  CliModelsParser,
  CliToolConfig,
  StoredCustomTool,
} from '../store/customTools.js';
import { tokenizeArgs } from './cliExecutor.js';

export interface CliModelsResult {
  available: boolean;
  models: string[];
  cached: boolean;
  error?: string;
}

const CACHE_TTL_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const cache = new Map<string, { expiresAt: number; result: CliModelsResult }>();
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeModels(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean))];
}

function parseJsonPath(root: unknown, path: string): unknown[] {
  if (!path.trim()) throw new Error('JSON Path 不能为空');
  let values: unknown[] = [root];
  for (const rawPart of path.split('.')) {
    const expand = rawPart.endsWith('[]');
    const key = expand ? rawPart.slice(0, -2) : rawPart;
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || FORBIDDEN_KEYS.has(key)) {
      throw new Error(`非法 JSON Path 字段: ${key}`);
    }
    const next: unknown[] = [];
    for (const value of values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const child = Object.prototype.hasOwnProperty.call(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
      if (expand) {
        if (Array.isArray(child)) next.push(...child);
      } else if (child !== undefined) {
        next.push(child);
      }
    }
    values = next;
  }
  return values.flatMap(value => Array.isArray(value) ? value : [value]);
}

export function parseCliModels(output: string, parser: CliModelsParser): string[] {
  if (!parser || typeof parser !== 'object' || !parser.type) {
    throw new Error('modelsParser 配置无效');
  }
  if (parser.type === 'lines') return normalizeModels(output.split(/\r?\n/));
  if (parser.type === 'json-path') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch (error: any) {
      throw new Error(`模型输出不是合法 JSON: ${error.message}`);
    }
    return normalizeModels(parseJsonPath(parsed, parser.path ?? ''));
  }
  if (parser.type === 'regex') {
    if (!parser.pattern) throw new Error('regex parser 缺少 pattern');
    let regex: RegExp;
    try {
      const flags = parser.flags?.includes('g') ? parser.flags : `${parser.flags ?? ''}g`;
      regex = new RegExp(parser.pattern, flags);
    } catch (error: any) {
      throw new Error(`模型正则表达式无效: ${error.message}`);
    }
    const group = parser.group ?? 1;
    const values: unknown[] = [];
    for (const match of output.matchAll(regex)) values.push(match[group]);
    return normalizeModels(values);
  }
  throw new Error(`不支持的模型解析类型: ${(parser as any).type}`);
}

export function clearCliModelsCache(): void {
  cache.clear();
}

function cacheKey(tool: StoredCustomTool): string {
  return `${tool.id}:${tool.updatedAt}:${JSON.stringify(tool.config)}`;
}

function executableError(command: unknown): string | undefined {
  if (typeof command !== 'string' || !command.trim()) return 'CLI 命令路径为空';
  try {
    accessSync(command, constants.X_OK);
    return undefined;
  } catch {
    return `CLI 不存在或不可执行: ${command}`;
  }
}

export async function discoverCliModels(
  tool: StoredCustomTool,
  options: { refresh?: boolean } = {},
): Promise<CliModelsResult> {
  if (!tool.enabled) return { available: false, models: [], cached: false, error: `CLI '${tool.name}' 已禁用` };
  if (tool.type !== 'cli') return { available: false, models: [], cached: false, error: `工具 '${tool.name}' 不是 CLI` };
  const config = tool.config as CliToolConfig;
  const commandError = executableError(config.command);
  if (commandError) return { available: false, models: [], cached: false, error: commandError };
  const staticModels = normalizeModels(Array.isArray(config.staticModels) ? config.staticModels : []);
  if (staticModels.length > 0) {
    return { available: true, models: staticModels, cached: false };
  }
  if (!config.modelsCommand?.trim() || !config.modelsParser) {
    return {
      available: false,
      models: [],
      cached: false,
      error: `CLI '${tool.name}' 未配置 modelsCommand/modelsParser`,
    };
  }

  const key = cacheKey(tool);
  const hit = cache.get(key);
  if (!options.refresh && hit && hit.expiresAt > Date.now()) {
    return { ...hit.result, cached: true };
  }

  const timeoutMs = config.modelsTimeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    return { available: false, models: [], cached: false, error: 'modelsTimeoutMs 必须在 1-60000 之间' };
  }

  const result = await new Promise<CliModelsResult>((resolve) => {
    const args = tokenizeArgs(config.modelsCommand!);
    const child = spawn(config.command, args, {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value: CliModelsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const append = (current: string, chunk: unknown) =>
      (current + String(chunk)).slice(0, MAX_OUTPUT_BYTES);
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', error => finish({
      available: false,
      models: [],
      cached: false,
      error: `CLI '${tool.name}' 模型探测启动失败: ${error.message}`,
    }));
    child.on('close', code => {
      if (code !== 0) {
        finish({
          available: false,
          models: [],
          cached: false,
          error: `CLI '${tool.name}' 模型探测 exit ${code}: ${(stderr || stdout).trim()}`,
        });
        return;
      }
      try {
        const models = parseCliModels(stdout, config.modelsParser!);
        finish(models.length > 0
          ? { available: true, models, cached: false }
          : { available: false, models: [], cached: false, error: `CLI '${tool.name}' 未返回可用模型` });
      } catch (error: any) {
        finish({ available: false, models: [], cached: false, error: `CLI '${tool.name}' 模型解析失败: ${error.message}` });
      }
    });
    const timer = setTimeout(() => {
      child.kill();
      finish({
        available: false,
        models: [],
        cached: false,
        error: `CLI '${tool.name}' 模型探测超时(${timeoutMs}ms)`,
      });
    }, timeoutMs);
  });

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}
