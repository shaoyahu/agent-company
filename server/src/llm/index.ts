/**
 * LLM 模块入口
 *
 * Phase 3 重构:底层换成 @earendil-works/pi-ai(30+ provider)
 * 球球要求"完全不要 mock" — 任何 LLM 调用必须有真实 provider + 真实 apiKey,
 * 走不通就立刻抛错,前端能看到真错因。
 */

export * from './types.js';
export { LLMRegistry, type ProviderConfig } from './registry.js';
export { createPiProvider } from './pi-bridge.js';
