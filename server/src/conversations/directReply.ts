import type { AgentConfig } from '../types/company.js';
import type { LLMMessage } from '../llm/types.js';
import type { Conversation, ConversationMessage } from './types.js';

const BLOCKED_IDS = new Set(['__proto__', 'constructor']);
const HISTORY_LIMIT = 100;

export interface DirectReplyDeps {
  getAgent(id: string): AgentConfig | undefined;
  getHistory(conversationId: string, limit: number): ConversationMessage[];
  executeAgent(agent: AgentConfig, messages: LLMMessage[]): Promise<string>;
}

function requireAgentId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Agent id 必须是有效字符串');
  const id = value.trim();
  if (!id || BLOCKED_IDS.has(id)) throw new Error('Agent id 必须是有效字符串');
  return id;
}

function toAgentHistory(messages: ConversationMessage[]): LLMMessage[] {
  return messages
    .map((message) => ({
      role: message.senderType === 'human'
        ? 'user'
        : message.senderType === 'agent'
          ? 'assistant'
          : 'system',
      content: message.content,
      name: `${message.senderType}:${message.senderId}`,
    }));
}

export async function generateDirectReply(
  conversation: Conversation,
  agentId: string,
  deps: DirectReplyDeps,
): Promise<string> {
  if (conversation.kind !== 'direct') {
    throw new Error('直接回复仅支持私聊会话');
  }
  const safeAgentId = requireAgentId(agentId);
  const agent = deps.getAgent(safeAgentId);
  if (!agent) throw new Error(`Agent '${safeAgentId}' 不存在`);
  if ((agent as AgentConfig & { enabled?: unknown }).enabled === false) {
    throw new Error(`Agent '${safeAgentId}' 未启用`);
  }

  const history = deps.getHistory(conversation.id, HISTORY_LIMIT);
  const reply = await deps.executeAgent(agent, toAgentHistory(history));
  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error(`Agent '${safeAgentId}' 未返回有效回复`);
  }
  return reply;
}
