/**
 * 配置服务 - Phase 3 重构后
 *
 * 现在所有配置(部门/Agent/LLM Provider)都来自 db,不再读 yaml。
 * 这个类变成"db config 的统一入口"。
 */

import type { CompanyConfig, AgentConfig, DepartmentConfig } from '../types/company.js';
import { DepartmentRepo, AgentRepo } from './org.js';
import { ProviderRepo } from './providers.js';

export class ConfigService {
  private deptRepo = new DepartmentRepo();
  private agentRepo = new AgentRepo();
  private providerRepo = new ProviderRepo();

  reload(): void {
    this.deptRepo = new DepartmentRepo();
    this.agentRepo = new AgentRepo();
    this.providerRepo = new ProviderRepo();
  }

  /** 部门列表(db only) */
  departments(): DepartmentConfig[] {
    return this.deptRepo.list();
  }

  /** Agent 列表(db only) */
  agents(): AgentConfig[] {
    return this.agentRepo.list();
  }

  /** LLM provider 列表(db only) */
  llmProviders() {
    return this.providerRepo.list();
  }

  /** 完整公司配置(供 Orchestrator) */
  merged(): CompanyConfig {
    return {
      name: '球球的 AI 公司',
      boss: '球球',
      description: '完全 Web 化配置',
      departments: this.departments(),
      agents: this.agents(),
      llm_providers: this.llmProviders().map((p) => ({
        id: p.id,
        type: p.type,
        apiKey: p.apiKey,
        endpoint: p.endpoint,
        model: p.model,
        maxTokens: p.maxTokens,
        temperature: p.temperature,
      })),
    };
  }
}
