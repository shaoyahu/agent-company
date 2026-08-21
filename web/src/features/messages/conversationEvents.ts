import type {
  ConversationDetail,
  ConversationMessage,
  ConversationSocketEvent,
  ConversationSummary,
  ParticipantState,
} from '../../api/client';
import { mergeConversationMessage } from './messageModel';

export type { ConversationSocketEvent } from '../../api/client';

const PARTICIPANT_STATES = new Set<ParticipantState>([
  'idle',
  'cooling',
  'deciding',
  'speaking',
  'paused',
  'error',
]);

const LEGACY_EVENT_TYPES = new Set([
  'connected',
  'message',
  'project_update',
  'task_update',
  'agent_event',
  'agent_updated',
  'agent_deleted',
  'department_updated',
  'department_deleted',
  'provider_added',
  'provider_updated',
  'provider_deleted',
  'tool_updated',
  'tool_deleted',
  'skill_installed',
  'skill_uninstalled',
]);

export type LegacyEventType =
  | 'connected'
  | 'message'
  | 'project_update'
  | 'task_update'
  | 'agent_event'
  | 'agent_updated'
  | 'agent_deleted'
  | 'department_updated'
  | 'department_deleted'
  | 'provider_added'
  | 'provider_updated'
  | 'provider_deleted'
  | 'tool_updated'
  | 'tool_deleted'
  | 'skill_installed'
  | 'skill_uninstalled';

export type LegacySocketEvent = {
  type: LegacyEventType;
  [key: string]: any;
};

export type SocketEvent = ConversationSocketEvent | LegacySocketEvent;

export interface ParticipantStateSnapshot {
  state: ParticipantState;
  since: number;
}

export interface ConversationEventState {
  conversations: ConversationSummary[];
  messages: ConversationMessage[];
  participantStates: Map<string, ParticipantStateSnapshot>;
  handledMessageIds: Set<string>;
  shouldNotify: boolean;
  shouldReloadConversations: boolean;
  shouldReloadDetail: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isSafeSocketId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value !== '__proto__'
    && value !== 'constructor';
}

function isParticipantState(value: unknown): value is ParticipantState {
  return typeof value === 'string'
    && PARTICIPANT_STATES.has(value as ParticipantState);
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!isRecord(value)) return false;
  return isSafeSocketId(value.id)
    && isSafeSocketId(value.conversationId)
    && Number.isSafeInteger(value.sequence)
    && (value.sequence as number) > 0
    && isSafeSocketId(value.senderId)
    && (
      value.senderType === 'human'
      || value.senderType === 'agent'
      || value.senderType === 'system'
    )
    && typeof value.content === 'string'
    && Array.isArray(value.mentions)
    && value.mentions.every(isSafeSocketId)
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
    && value.createdAt >= 0;
}

export function parseConversationSocketEvent(
  value: unknown,
): ConversationSocketEvent | null {
  if (!isRecord(value) || !isSafeSocketId(value.conversationId)) return null;

  if (value.type === 'conversation_message') {
    if (
      !isConversationMessage(value.message)
      || value.message.conversationId !== value.conversationId
    ) {
      return null;
    }
    return value as unknown as ConversationSocketEvent;
  }

  if (value.type === 'conversation_state') {
    if (
      !isSafeSocketId(value.agentId)
      || !isParticipantState(value.state)
      || typeof value.since !== 'number'
      || !Number.isFinite(value.since)
      || value.since < 0
    ) {
      return null;
    }
    return value as unknown as ConversationSocketEvent;
  }

  if (
    value.type === 'conversation_updated'
    || value.type === 'conversation_deleted'
  ) {
    return value as unknown as ConversationSocketEvent;
  }

  return null;
}

export function parseWebSocketData(data: unknown): SocketEvent | null {
  let value = data;
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type.startsWith('conversation_')) {
    return parseConversationSocketEvent(value);
  }
  return LEGACY_EVENT_TYPES.has(value.type)
    ? value as unknown as LegacySocketEvent
    : null;
}

function sortConversationSummaries(
  conversations: ConversationSummary[],
): ConversationSummary[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.id.localeCompare(b.id);
  });
}

export function createConversationEventState(
  conversations: ConversationSummary[] | unknown,
  messages: ConversationMessage[] | unknown,
): ConversationEventState {
  const safeConversations = Array.isArray(conversations)
    ? conversations.filter((item) => isRecord(item) && isSafeSocketId(item.id))
    : [];
  const safeMessages = Array.isArray(messages)
    ? messages.filter(isConversationMessage)
    : [];
  return {
    conversations: sortConversationSummaries(safeConversations as ConversationSummary[]),
    messages: safeMessages.reduce(
      (current, message) => mergeConversationMessage(current, message),
      [] as ConversationMessage[],
    ),
    participantStates: new Map(),
    handledMessageIds: new Set(safeMessages.map((message) => message.id)),
    shouldNotify: false,
    shouldReloadConversations: false,
    shouldReloadDetail: false,
  };
}

function isConnectionGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function reduceConversationConnectionGeneration(
  state: ConversationEventState,
  previousGeneration: unknown,
  nextGeneration: unknown,
): { state: ConversationEventState; shouldReload: boolean } {
  if (
    !isConnectionGeneration(previousGeneration)
    || !isConnectionGeneration(nextGeneration)
    || previousGeneration === nextGeneration
  ) {
    return { state, shouldReload: false };
  }
  return {
    state: {
      ...state,
      participantStates: new Map(),
    },
    shouldReload: true,
  };
}

export function reduceConversationEvent(
  state: ConversationEventState,
  event: ConversationSocketEvent,
  activeConversationId?: string,
): ConversationEventState {
  const base = {
    ...state,
    shouldNotify: false,
    shouldReloadConversations: false,
    shouldReloadDetail: false,
  };

  if (event.type === 'conversation_message') {
    if (state.handledMessageIds.has(event.message.id)) return base;
    const handledMessageIds = new Set(state.handledMessageIds);
    handledMessageIds.add(event.message.id);
    const hasSummary = state.conversations.some(
      (conversation) => conversation.id === event.conversationId,
    );
    const updateConversation = (
      conversation: ConversationSummary,
      unreadCount: number,
    ): ConversationSummary => ({
      ...conversation,
      lastMessage: event.message,
      updatedAt: event.message.createdAt,
      unreadCount,
    });

    if (event.conversationId === activeConversationId) {
      const conversations = sortConversationSummaries(state.conversations.map((conversation) =>
        conversation.id === event.conversationId
          ? updateConversation(conversation, 0)
          : conversation));
      return {
        ...base,
        conversations,
        messages: mergeConversationMessage(state.messages, event.message),
        handledMessageIds,
        shouldReloadConversations: !hasSummary,
      };
    }

    const conversations = sortConversationSummaries(state.conversations.map((conversation) =>
      conversation.id === event.conversationId
        ? updateConversation(
            conversation,
            conversation.unreadCount + (event.message.senderType === 'agent' ? 1 : 0),
          )
        : conversation));
    return {
      ...base,
      conversations,
      handledMessageIds,
      shouldNotify: event.message.senderType === 'agent',
      shouldReloadConversations: !hasSummary,
    };
  }

  if (event.type === 'conversation_state') {
    if (event.conversationId !== activeConversationId) return base;
    const participantStates = new Map(state.participantStates);
    participantStates.set(event.agentId, {
      state: event.state,
      since: event.since,
    });
    return { ...base, participantStates };
  }

  if (event.type === 'conversation_deleted') {
    const isActiveConversation = event.conversationId === activeConversationId;
    return {
      ...base,
      conversations: state.conversations.filter(
        (conversation) => conversation.id !== event.conversationId,
      ),
      messages: isActiveConversation ? [] : state.messages,
      participantStates: isActiveConversation ? new Map() : state.participantStates,
      shouldReloadConversations: true,
      shouldReloadDetail: false,
    };
  }

  return {
    ...base,
    shouldReloadConversations: true,
    shouldReloadDetail: event.conversationId === activeConversationId,
  };
}

export async function runConversationMutation(
  action: () => Promise<unknown>,
  readDetail: () => Promise<ConversationDetail>,
): Promise<ConversationDetail> {
  await action();
  return readDetail();
}
