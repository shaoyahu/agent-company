import type {
  Agent,
  ConversationKind,
  ConversationMessage,
} from '../../api/client';

export type ParticipantStateMeta = {
  label: string;
  tone: 'neutral' | 'accent' | 'danger';
};

const IDLE_META: ParticipantStateMeta = {
  label: '空闲',
  tone: 'neutral',
};

const STATE_META = new Map<string, ParticipantStateMeta>([
  ['idle', IDLE_META],
  ['cooling', { label: '阅读中', tone: 'neutral' }],
  ['deciding', { label: '判断中', tone: 'accent' }],
  ['speaking', { label: '发言中', tone: 'accent' }],
  ['paused', { label: '已暂停', tone: 'neutral' }],
  ['error', { label: '异常', tone: 'danger' }],
]);

function isSafeId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value !== '__proto__'
    && value !== 'constructor';
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConversationMessage>;
  return isSafeId(candidate.id)
    && isSafeId(candidate.conversationId)
    && typeof candidate.sequence === 'number'
    && Number.isFinite(candidate.sequence);
}

export function mergeConversationMessage(
  messages: ConversationMessage[],
  incoming: ConversationMessage,
): ConversationMessage[] {
  const byId = new Map<string, ConversationMessage>();
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (isConversationMessage(message)) byId.set(message.id, message);
    }
  }
  if (isConversationMessage(incoming)) byId.set(incoming.id, incoming);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function getParticipantStateMeta(state: unknown): ParticipantStateMeta {
  return typeof state === 'string'
    ? STATE_META.get(state) ?? IDLE_META
    : IDLE_META;
}

export function validateCreateConversationDraft(
  kind: ConversationKind | unknown,
  title: string,
  agentIds: unknown[],
  schedulerMode?: unknown,
  schedulerSourceId?: unknown,
): string | null {
  if (kind !== 'direct' && kind !== 'group') return '会话类型无效';
  if (!Array.isArray(agentIds) || agentIds.some((id) => !isSafeId(id))) {
    return 'Agent 选择无效';
  }
  if (new Set(agentIds).size !== agentIds.length) return 'Agent 不能重复选择';
  if (kind === 'direct') {
    return agentIds.length === 1 ? null : '私聊必须正好选择一个 Agent';
  }
  if (typeof title !== 'string' || !title.trim()) return '群聊标题不能为空';
  if (agentIds.length < 2) return '群聊至少需要两个 Agent';
  if (schedulerMode !== 'llm' && schedulerMode !== 'agent') return '群聊必须配置调度器';
  if (schedulerMode === 'llm') {
    return isSafeId(schedulerSourceId) ? null : '调度器 LLM 不能为空';
  }
  return isSafeId(schedulerSourceId) ? null : '调度器 Agent 无效';
}

export function getConversationSenderName(
  message: ConversationMessage | unknown,
  agents: Agent[] | unknown,
): string {
  if (!message || typeof message !== 'object') return 'Agent';
  const candidate = message as Partial<ConversationMessage>;
  if (candidate.senderType === 'system') return '系统';
  if (candidate.senderType === 'human') return '我';
  const agent = Array.isArray(agents)
    ? agents.find((item) => item?.id === candidate.senderId)
    : undefined;
  return agent?.name?.trim() || agent?.id || candidate.senderId || 'Agent';
}

export function readConversationMessageEvent(
  value: unknown,
): ConversationMessage | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as {
    type?: unknown;
    conversationId?: unknown;
    message?: unknown;
  };
  if (
    event.type !== 'conversation_message'
    || !isSafeId(event.conversationId)
    || !isConversationMessage(event.message)
  ) {
    return null;
  }
  return event.message.conversationId === event.conversationId
    ? event.message
    : null;
}
