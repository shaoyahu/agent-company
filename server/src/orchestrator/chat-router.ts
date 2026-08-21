/**
 * Chat Router - 决定 agent 要不要接话
 *
 * 工作模式:
 * 1. 老板发消息或 agent 发消息 → 路由到目标 channel
 * 2. 频道订阅的 agent 收到 → 用 LLM 决定"我要不要接话"
 * 3. 如果接,生成回复 → publish 回 channel
 *
 * 触发"会议模式":
 * - 老板 @ 多人
 * - 老板消息包含 "?" 且任务关键
 * - phase 转换需要决策
 */

import { randomUUID } from 'node:crypto';
import { MessageBus } from './message-bus.js';
import { LLMRegistry } from '../llm/registry.js';
import type { ChatMessage, AgentConfig } from '../types/company.js';
import type { LLMMessage } from '../llm/types.js';

export class ChatRouter {
  constructor(
    private bus: MessageBus,
    private llmRegistry: LLMRegistry,
    private getAgents: () => AgentConfig[],
  ) {
    // 全局订阅:任何消息进来时让相关 agent 决策
    bus.on('message', (msg: ChatMessage) => {
      // 只处理 'message' 类型,跳过 system / tool
      if (msg.type !== 'message') return;
      // 跳过自己发的(避免自回复)
      // (在调用处过滤)
      this.routeMessage(msg).catch((e) => {
        console.error('[chat-router] routeMessage unhandled:', e);
      });
    });
  }

  private async routeMessage(msg: ChatMessage): Promise<void> {
    // 1. 找可能相关的 agent
    const candidates = this.findCandidates(msg);
    if (candidates.length === 0) return;

    // 2. 排除自己
    const others = candidates.filter((a) => a.id !== msg.fromId);
    if (others.length === 0) return;

    // 3. 并行让每个 agent 决定要不要接
    await Promise.all(
      others.map((agent) => this.maybeReply(agent, msg)),
    );
  }

  private findCandidates(msg: ChatMessage): AgentConfig[] {
    const all = this.getAgents();
    if (msg.mentions && msg.mentions.length > 0) {
      // @ 提及时,只 @ 的人接话
      return all.filter((a) => msg.mentions!.includes(a.id) || msg.mentions!.includes(a.department));
    }
    // 否则:同一个部门 / 同一个项目 phase 的部门接话
    // 简化:任何 agent 都有可能接(让 LLM 决定)
    return all;
  }

  private async maybeReply(agent: AgentConfig, msg: ChatMessage): Promise<void> {
    // 同 runtime.ts:不再静默 fallback mock,LLM 拿不到就抛错
    const provider = this.llmRegistry.get(agent.llm);
    if (!provider) {
      throw new Error(`Agent "${agent.name ?? agent.id}" 引用了不可用的 LLM "${agent.llm}",无法在群聊中回复。`);
    }
    const decisionPrompt: LLMMessage[] = [
      {
        role: 'system',
        content: `你是 ${agent.name ?? agent.id}(${agent.department} · ${agent.role})。你刚听到公司群里的消息:

"${msg.fromName}: ${msg.content}"

请你判断:这条消息跟你有关吗?如果有关,用 1-2 句话回应。如果无关(跟你部门/角色完全无关),回复 "SKIP"。

规则:
- 只在跟你职责相关时回复
- 简短,不啰嗦
- 没必要每次都接话(避免刷屏)
- 如果是 @ 你 / @ 你的部门,一定要回应`,
      },
      {
        role: 'user',
        content: '请判断并回应。',
      },
    ];

    try {
      const response = await provider.chat({
        messages: decisionPrompt,
        temperature: 0.5,
        maxTokens: 300,
      });

      const text = response.text.trim();
      if (!text || text === 'SKIP' || text.startsWith('SKIP')) return;

      // 发送回复到 channel
      await this.bus.publish({
        projectId: msg.projectId,
        channel: msg.channel,
        fromId: agent.id,
        fromName: agent.name ?? agent.id,
        fromRole: `${agent.department} · ${agent.role}`,
        content: text,
        type: 'message',
      });
    } catch (e) {
      console.error(`[chat-router] ${agent.id} reply failed:`, e);
    }
  }

  /**
   * 检测"会议模式"触发条件
   */
  static shouldOpenMeeting(msg: ChatMessage): boolean {
    if (msg.fromId !== 'boss') return false;
    if (!msg.mentions || msg.mentions.length < 2) return false;
    return true;
  }
}
