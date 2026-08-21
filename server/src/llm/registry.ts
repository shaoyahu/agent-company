import type { LLMProvider, LLMProviderType } from './types.js';
import { createPiProvider } from './pi-bridge.js';
import { ProviderRepo, type StoredProvider } from '../store/providers.js';

export interface ProviderConfig {
  id: string;
  type: LLMProviderType;
  apiKey?: string;
  endpoint?: string;
  /**
   * 自定义 API path (e.g. "/chat/completions")。
   * 留空 = 走 pi-ai 标准 (/chat/completions for openai / /v1/messages for anthropic)。
   * 自定义值当前会被 pi-ai 忽略(SDK 强制 baseURL),见 pi-bridge.ts TODO。
   */
  path?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  source?: 'db' | 'yaml' | 'env';
  enabled?: boolean;
}

/**
 * LLM Provider Registry — Phase 3 重构
 *
 * 三层优先级:
 * 1. db (Web 上配的)
 * 2. yaml (company.yaml)
 * 3. env (环境变量)
 *
 * 底层全部用 @earendil-works/pi-ai(支持 30+ provider)
 */
export class LLMRegistry {
  private providers = new Map<string, LLMProvider>();
  // 球球 review 2026-08-15:model 不在 LLMProvider 对象上(pi-ai 内部用,不挂外面),
  // 之前 list() 读 (p as any).model 永远拿不到所以 "unknown"。存到 metadata 里。
  private metadata = new Map<string, { source: string; enabled: boolean; model: string; type: LLMProviderType }>();

  init(yamlConfigs: ProviderConfig[], dbProviders: StoredProvider[] = []): void {
    this.providers.clear();
    this.metadata.clear();

    for (const cfg of yamlConfigs) {
      this.addWithSource({ ...cfg, source: 'yaml' });
    }
    for (const p of dbProviders) {
      this.addWithSource({
        id: p.id,
        type: p.type,
        apiKey: p.apiKey,
        endpoint: p.endpoint,
        path: p.path,
        model: p.model,
        maxTokens: p.maxTokens,
        temperature: p.temperature,
        source: 'db',
        enabled: p.enabled,
      });
    }
  }

  private addWithSource(cfg: ProviderConfig): void {
    if (cfg.enabled === false) {
      this.remove(cfg.id);
      console.log(`[registry] skip ${cfg.id} (disabled)`);
      return;
    }
    const apiKey = this.resolveEnv(cfg.apiKey ?? '');

    // 球球要求"完全不要 mock,走不通就报错" — 没 apiKey 直接抛错让前端立刻知道。
    if (!apiKey) {
      throw new Error(
        `Provider "${cfg.id}" type=${cfg.type} 但 apiKey 为空。` +
        `必须在「设置 → LLM」里填入真实 API key 才能保存。`,
      );
    }

    // 设置环境变量让 pi-ai 自己解析
    if (apiKey) {
      // 给 pi-ai 一个稳定的 env 名字
      const envName = `PI_LLM_API_KEY_${cfg.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      process.env[envName] = apiKey;
    }

    const provider = createPiProvider({
      id: cfg.id,
      type: cfg.type,
      apiKey,
      endpoint: cfg.endpoint,
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
    });

    this.providers.set(cfg.id, provider);
    this.metadata.set(cfg.id, {
      source: cfg.source ?? 'yaml',
      enabled: true,
      model: cfg.model,   // ← 存到 metadata,list() 用它
      type: cfg.type,
    });
  }

  add(cfg: ProviderConfig): LLMProvider | undefined {
    this.addWithSource({ ...cfg, source: 'db' });
    return this.providers.get(cfg.id);
  }

  remove(id: string): boolean {
    const removedProvider = this.providers.delete(id);
    const removedMetadata = this.metadata.delete(id);
    return removedProvider || removedMetadata;
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  list(): Array<{
    id: string;
    type: LLMProviderType;
    model: string;
    source: string;
    enabled: boolean;
  }> {
    return Array.from(this.providers.entries()).map(([id, p]) => {
      // 球球 review 2026-08-15:model 不在 provider 对象上,要从 metadata 读
      const meta = this.metadata.get(id) ?? { source: 'unknown', enabled: true, model: 'unknown', type: p.type };
      return {
        id,
        type: meta.type,
        model: meta.model,
        source: meta.source,
        enabled: meta.enabled,
      };
    });
  }

  size(): number {
    return this.providers.size;
  }

  private resolveEnv(value: string): string {
    if (!value) return '';
    const m = value.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
    if (m) {
      return process.env[m[1]!] ?? '';
    }
    return value;
  }
}
