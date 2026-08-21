export type ConversationKind = 'direct' | 'group';
export type ConversationSenderType = 'human' | 'agent' | 'system';
export type DeliveryStatus = 'pending' | 'processing' | 'processed' | 'failed';
export type ConversationPauseReason = 'manual' | 'limit' | 'scheduler';
export type ConversationSchedulerMode = 'none' | 'llm' | 'agent';
export type ConversationProtectionBoundary = 'discussion_limit_resume';

export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string;
  avatar?: string;
  createdBy: string;
  agentMessageLimit: number;
  maxConsecutiveSpeeches: number;
  maxMessageChars: number;
  cooldownMs: number;
  paused: boolean;
  pauseReason?: ConversationPauseReason;
  pinned: boolean;
  muted: boolean;
  lastReadSequence: number;
  schedulerMode: ConversationSchedulerMode;
  schedulerLlm?: string;
  schedulerAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMember {
  conversationId: string;
  memberId: string;
  memberType: 'human' | 'agent';
  enabled: boolean;
  paused: boolean;
  joinedAt: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sequence: number;
  senderId: string;
  senderType: ConversationSenderType;
  content: string;
  mentions: string[];
  protectionBoundary?: ConversationProtectionBoundary;
  createdAt: number;
}

export interface ConversationDelivery {
  conversationId: string;
  messageId: string;
  agentId: string;
  status: DeliveryStatus;
  batchId?: string;
  deliveredAt: number;
  processedAt?: number;
  error?: string;
}

export interface CreateConversationInput {
  id?: string;
  kind: ConversationKind;
  title: string;
  agentIds: string[];
  createdBy?: string;
  agentMessageLimit?: number;
  maxConsecutiveSpeeches?: number;
  maxMessageChars?: number;
  cooldownMs?: number;
  schedulerMode?: ConversationSchedulerMode;
  schedulerLlm?: string;
  schedulerAgentId?: string;
}

export interface AppendConversationMessageInput {
  id?: string;
  conversationId: string;
  senderId: string;
  senderType: ConversationSenderType;
  content: string;
  mentions?: unknown[];
  protectionBoundary?: ConversationProtectionBoundary;
}

export interface AppendAgentReplyAndCompleteBatchInput {
  id?: string;
  batchId: string;
  conversationId: string;
  agentId: string;
  content: string;
  mentions?: unknown[];
}

export interface ConversationSummary extends Conversation {
  memberCount: number;
  unreadCount: number;
  lastMessage?: ConversationMessage;
}

export type ParticipantState =
  | 'idle'
  | 'cooling'
  | 'deciding'
  | 'speaking'
  | 'paused'
  | 'error';

export type AgentSpeechDecision =
  | { decision: 'skip' }
  | { decision: 'speak'; content: string };

export type SchedulerDecision =
  | { decision: 'continue' }
  | { decision: 'pause_conversation'; reason: string };
