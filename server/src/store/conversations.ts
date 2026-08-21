import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AppendAgentReplyAndCompleteBatchInput,
  AppendConversationMessageInput,
  Conversation,
  ConversationDelivery,
  ConversationKind,
  ConversationMember,
  ConversationMessage,
  ConversationPauseReason,
  ConversationProtectionBoundary,
  ConversationSchedulerMode,
  ConversationSenderType,
  ConversationSummary,
  CreateConversationInput,
  DeliveryStatus,
} from '../conversations/types.js';
import { getDB } from './db.js';

const BLOCKED_IDS = new Set(['__proto__', 'constructor']);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MAX_AVATAR_CHARS = 1_000_000;

interface ConversationRow {
  id: string;
  kind: ConversationKind;
  title: string;
  avatar: string | null;
  created_by: string;
  agent_message_limit: number;
  max_consecutive_speeches: number;
  max_message_chars: number;
  cooldown_ms: number;
  paused: number;
  pause_reason: ConversationPauseReason | null;
  pinned: number;
  muted: number;
  last_read_sequence: number;
  scheduler_mode: ConversationSchedulerMode;
  scheduler_llm: string | null;
  scheduler_agent_id: string | null;
  created_at: number;
  updated_at: number;
  member_count?: number;
  unread_count?: number;
  last_message_id?: string | null;
  last_message_sequence?: number | null;
  last_message_sender_id?: string | null;
  last_message_sender_type?: ConversationSenderType | null;
  last_message_content?: string | null;
  last_message_mentions?: string | null;
  last_message_protection_boundary?: ConversationProtectionBoundary | null;
  last_message_created_at?: number | null;
}

interface MemberRow {
  conversation_id: string;
  member_id: string;
  member_type: 'human' | 'agent';
  enabled: number;
  paused: number;
  joined_at: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sequence: number;
  sender_id: string;
  sender_type: ConversationSenderType;
  content: string;
  mentions: unknown;
  protection_boundary: ConversationProtectionBoundary | null;
  created_at: number;
}

interface DeliveryRow {
  conversation_id: string;
  message_id: string;
  agent_id: string;
  status: DeliveryStatus;
  batch_id: string | null;
  delivered_at: number;
  processed_at: number | null;
  error: string | null;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function optionalSafeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || BLOCKED_IDS.has(id)) return null;
  return id;
}

function requireSafeId(value: unknown, label: string): string {
  const id = optionalSafeId(value);
  if (!id) throw new Error(`${label}必须是有效字符串`);
  return id;
}

function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`会话配置 ${label} 超出范围`);
  }
  return value as number;
}

function normalizeConversationTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('会话标题不能为空');
  }
  return value.trim();
}

function normalizeConversationAvatar(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('会话头像必须是字符串');
  const avatar = value.trim();
  if (!avatar) return null;
  if (avatar.length > MAX_AVATAR_CHARS) throw new Error('会话头像过长');
  return avatar;
}

function requireSchedulerConfig(input: CreateConversationInput): {
  schedulerMode: ConversationSchedulerMode;
  schedulerLlm: string | null;
  schedulerAgentId: string | null;
} {
  const schedulerMode = input.schedulerMode ?? 'none';
  if (!['none', 'llm', 'agent'].includes(schedulerMode)) {
    throw new Error('调度器模式只能是 none、llm 或 agent');
  }
  if (schedulerMode === 'llm') {
    if (input.schedulerAgentId !== undefined) {
      throw new Error('LLM 调度器不能配置调度器 Agent');
    }
    return {
      schedulerMode,
      schedulerLlm: requireSafeId(input.schedulerLlm, '调度器 LLM'),
      schedulerAgentId: null,
    };
  }
  if (schedulerMode === 'agent') {
    if (input.schedulerLlm !== undefined) {
      throw new Error('Agent 调度器不能配置调度器 LLM');
    }
    return {
      schedulerMode,
      schedulerLlm: null,
      schedulerAgentId: requireSafeId(input.schedulerAgentId, '调度器 Agent'),
    };
  }
  if (input.schedulerLlm !== undefined || input.schedulerAgentId !== undefined) {
    throw new Error('未启用调度器时不能配置调度器来源');
  }
  return {
    schedulerMode,
    schedulerLlm: null,
    schedulerAgentId: null,
  };
}

function fromConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    avatar: row.avatar ?? undefined,
    createdBy: row.created_by,
    agentMessageLimit: row.agent_message_limit,
    maxConsecutiveSpeeches: row.max_consecutive_speeches,
    maxMessageChars: row.max_message_chars,
    cooldownMs: row.cooldown_ms,
    paused: row.paused === 1,
    pauseReason: row.pause_reason ?? undefined,
    pinned: row.pinned === 1,
    muted: row.muted === 1,
    lastReadSequence: row.last_read_sequence,
    schedulerMode: row.scheduler_mode,
    schedulerLlm: row.scheduler_llm ?? undefined,
    schedulerAgentId: row.scheduler_agent_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromMemberRow(row: MemberRow): ConversationMember {
  return {
    conversationId: row.conversation_id,
    memberId: row.member_id,
    memberType: row.member_type,
    enabled: row.enabled === 1,
    paused: row.paused === 1,
    joinedAt: row.joined_at,
  };
}

function fromMessageRow(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    senderId: row.sender_id,
    senderType: row.sender_type,
    content: row.content,
    mentions: parseStringArray(row.mentions),
    protectionBoundary: row.protection_boundary ?? undefined,
    createdAt: row.created_at,
  };
}

function fromDeliveryRow(row: DeliveryRow): ConversationDelivery {
  return {
    conversationId: row.conversation_id,
    messageId: row.message_id,
    agentId: row.agent_id,
    status: row.status,
    batchId: row.batch_id ?? undefined,
    deliveredAt: row.delivered_at,
    processedAt: row.processed_at ?? undefined,
    error: row.error ?? undefined,
  };
}

export class ConversationRepo {
  private readonly db: Database.Database;

  constructor() {
    this.db = getDB();
  }

  private setConversationFlag(
    id: string,
    column: 'pinned' | 'muted',
    value: boolean,
  ): Conversation {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    if (typeof value !== 'boolean') throw new Error('会话设置必须是布尔值');
    this.db.prepare(`UPDATE conversations SET ${column} = ? WHERE id = ?`)
      .run(value ? 1 : 0, conversationId);
    return this.requireConversation(conversationId);
  }

  create(input: CreateConversationInput): Conversation {
    if (input.kind !== 'direct' && input.kind !== 'group') {
      throw new Error('会话类型只能是 direct 或 group');
    }
    const title = normalizeConversationTitle(input.title);
    if (!Array.isArray(input.agentIds)) {
      throw new Error('Agent 成员必须是数组');
    }

    const agentIds = input.agentIds.map((id) => requireSafeId(id, 'Agent id'));
    if (new Set(agentIds).size !== agentIds.length) {
      throw new Error('Agent 成员不能重复');
    }
    if (input.kind === 'direct' && agentIds.length !== 1) {
      throw new Error('私聊必须正好包含一个 Agent');
    }
    if (input.kind === 'group' && agentIds.length < 2) {
      throw new Error('群聊至少需要两个 Agent');
    }
    if (agentIds.includes('boss')) {
      throw new Error('boss 不能作为 Agent 成员');
    }

    const id = input.id === undefined
      ? randomUUID()
      : requireSafeId(input.id, '会话 id');
    const createdBy = input.createdBy === undefined
      ? 'boss'
      : requireSafeId(input.createdBy, '创建者');
    if (createdBy !== 'boss') {
      throw new Error('第一版会话创建者必须是 boss');
    }

    const agentMessageLimit = requireInteger(
      input.agentMessageLimit === undefined ? 30 : input.agentMessageLimit,
      'agentMessageLimit',
      1,
      10_000,
    );
    const maxConsecutiveSpeeches = requireInteger(
      input.maxConsecutiveSpeeches === undefined ? 2 : input.maxConsecutiveSpeeches,
      'maxConsecutiveSpeeches',
      1,
      100,
    );
    const maxMessageChars = requireInteger(
      input.maxMessageChars === undefined ? 300 : input.maxMessageChars,
      'maxMessageChars',
      1,
      100_000,
    );
    const cooldownMs = requireInteger(
      input.cooldownMs === undefined ? 5000 : input.cooldownMs,
      'cooldownMs',
      0,
      3_600_000,
    );
    const scheduler = requireSchedulerConfig(input);
    const now = Date.now();

    const insert = this.db.transaction(() => {
      if (input.kind === 'direct') {
        const existing = this.findDirectByAgent(agentIds[0]!);
        if (existing) return existing;
      }
      this.db.prepare(
        `INSERT INTO conversations (
          id, kind, title, avatar, created_by, agent_message_limit, max_consecutive_speeches,
          max_message_chars, cooldown_ms, paused, pause_reason, pinned, muted,
          last_read_sequence, scheduler_mode, scheduler_llm, scheduler_agent_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, NULL, 0, 0, 0, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.kind,
        title,
        createdBy,
        agentMessageLimit,
        maxConsecutiveSpeeches,
        maxMessageChars,
        cooldownMs,
        scheduler.schedulerMode,
        scheduler.schedulerLlm,
        scheduler.schedulerAgentId,
        now,
        now,
      );
      const insertMember = this.db.prepare(
        `INSERT INTO conversation_members (
          conversation_id, member_id, member_type, enabled, paused, joined_at
        ) VALUES (?, ?, ?, 1, 0, ?)`,
      );
      insertMember.run(id, 'boss', 'human', now);
      for (const agentId of agentIds) {
        insertMember.run(id, agentId, 'agent', now);
      }
      return this.requireConversation(id);
    });
    return insert();
  }

  get(id: string): Conversation | null {
    const safeId = optionalSafeId(id);
    if (!safeId) return null;
    const row = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(safeId) as
      | ConversationRow
      | undefined;
    return row ? fromConversationRow(row) : null;
  }

  updateConversationProfile(
    id: string,
    input: { title: unknown; avatar?: unknown },
  ): Conversation {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    const title = normalizeConversationTitle(input.title);
    const avatar = normalizeConversationAvatar(input.avatar);
    this.db.prepare(
      `UPDATE conversations
       SET title = ?, avatar = ?, updated_at = ?
       WHERE id = ?`,
    ).run(title, avatar, Date.now(), conversationId);
    return this.requireConversation(conversationId);
  }

  list(): ConversationSummary[] {
    const rows = this.db.prepare(
      `SELECT
         c.*,
         COUNT(cm.member_id) AS member_count,
         lm.id AS last_message_id,
         lm.sequence AS last_message_sequence,
         lm.sender_id AS last_message_sender_id,
         lm.sender_type AS last_message_sender_type,
         lm.content AS last_message_content,
         lm.mentions AS last_message_mentions,
         lm.protection_boundary AS last_message_protection_boundary,
         lm.created_at AS last_message_created_at,
         (
           SELECT COUNT(*)
           FROM conversation_messages unread
           WHERE unread.conversation_id = c.id
             AND unread.sequence > c.last_read_sequence
             AND unread.sender_type = 'agent'
         ) AS unread_count
       FROM conversations c
       LEFT JOIN conversation_members cm ON cm.conversation_id = c.id
       LEFT JOIN conversation_messages lm
         ON lm.conversation_id = c.id
        AND lm.sequence = (
          SELECT MAX(sequence)
          FROM conversation_messages
          WHERE conversation_id = c.id
        )
       GROUP BY c.id
       ORDER BY c.pinned DESC, c.updated_at DESC, c.created_at DESC, c.id ASC`,
    ).all() as ConversationRow[];
    return rows.map((row) => {
      const lastMessage: ConversationMessage | undefined = row.last_message_id
        && row.last_message_sequence != null
        && row.last_message_sender_id
        && row.last_message_sender_type
        && row.last_message_content != null
        && row.last_message_created_at != null
        ? {
            id: row.last_message_id,
            conversationId: row.id,
            sequence: row.last_message_sequence,
            senderId: row.last_message_sender_id,
            senderType: row.last_message_sender_type,
            content: row.last_message_content,
            mentions: parseStringArray(row.last_message_mentions),
            protectionBoundary: row.last_message_protection_boundary ?? undefined,
            createdAt: row.last_message_created_at,
          }
        : undefined;
      return {
        ...fromConversationRow(row),
        memberCount: row.member_count ?? 0,
        unreadCount: row.unread_count ?? 0,
        lastMessage,
      };
    });
  }

  setConversationPinned(id: string, pinned: boolean): Conversation {
    return this.setConversationFlag(id, 'pinned', pinned);
  }

  setConversationMuted(id: string, muted: boolean): Conversation {
    return this.setConversationFlag(id, 'muted', muted);
  }

  markConversationRead(id: string): Conversation {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    const row = this.db.prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS sequence
       FROM conversation_messages
       WHERE conversation_id = ?`,
    ).get(conversationId) as { sequence: number };
    this.db.prepare(
      `UPDATE conversations SET last_read_sequence = ? WHERE id = ?`,
    ).run(row.sequence, conversationId);
    return this.requireConversation(conversationId);
  }

  delete(id: string): boolean {
    const safeId = optionalSafeId(id);
    if (!safeId) return false;
    return this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(safeId).changes > 0;
  }

  findDirectByAgent(agentId: string): Conversation | null {
    const safeAgentId = optionalSafeId(agentId);
    if (!safeAgentId) return null;
    const row = this.db.prepare(
      `SELECT c.*
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE c.kind = 'direct' AND cm.member_type = 'agent' AND cm.member_id = ?
       LIMIT 1`,
    ).get(safeAgentId) as ConversationRow | undefined;
    return row ? fromConversationRow(row) : null;
  }

  listMembers(id: string): ConversationMember[] {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    const rows = this.db.prepare(
      `SELECT * FROM conversation_members
       WHERE conversation_id = ?
       ORDER BY CASE member_type WHEN 'human' THEN 0 ELSE 1 END, joined_at ASC, member_id ASC`,
    ).all(conversationId) as MemberRow[];
    return rows.map(fromMemberRow);
  }

  addAgentMember(id: string, agentId: string): ConversationMember {
    const conversationId = requireSafeId(id, '会话 id');
    const safeAgentId = requireSafeId(agentId, 'Agent id');
    if (safeAgentId === 'boss') throw new Error('boss 不能作为 Agent 成员');
    const conversation = this.requireConversation(conversationId);
    if (conversation.kind === 'direct') throw new Error('私聊不能添加 Agent');
    if (this.getMember(conversationId, safeAgentId)) throw new Error('Agent 成员已存在');

    const now = Date.now();
    this.db.prepare(
      `INSERT INTO conversation_members (
        conversation_id, member_id, member_type, enabled, paused, joined_at
      ) VALUES (?, ?, 'agent', 1, 0, ?)`,
    ).run(conversationId, safeAgentId, now);
    this.touch(conversationId, now);
    return this.requireMember(conversationId, safeAgentId);
  }

  removeAgentMember(id: string, agentId: string): boolean {
    const conversationId = requireSafeId(id, '会话 id');
    const safeAgentId = requireSafeId(agentId, 'Agent id');
    if (safeAgentId === 'boss') throw new Error('不能移除 boss');
    const conversation = this.requireConversation(conversationId);
    if (conversation.kind === 'direct') throw new Error('私聊不能移除 Agent');
    const member = this.getMember(conversationId, safeAgentId);
    if (!member) return false;

    const now = Date.now();
    const remove = this.db.transaction(() => {
      this.failPendingForAgent(conversationId, safeAgentId, '已移出群聊');
      const result = this.db.prepare(
        `DELETE FROM conversation_members WHERE conversation_id = ? AND member_id = ?`,
      ).run(conversationId, safeAgentId);
      this.touch(conversationId, now);
      return result.changes > 0;
    });
    return remove();
  }

  removeAgentFromAllConversations(agentId: string): string[] {
    const safeAgentId = requireSafeId(agentId, 'Agent id');
    if (safeAgentId === 'boss') throw new Error('不能移除 boss');
    const rows = this.db.prepare(
      `SELECT conversation_id FROM conversation_members
       WHERE member_id = ? AND member_type = 'agent'
       ORDER BY conversation_id ASC`,
    ).all(safeAgentId) as Array<{ conversation_id: string }>;
    if (rows.length === 0) return [];

    const conversationIds = rows.map((row) => row.conversation_id);
    const now = Date.now();
    const cleanup = this.db.transaction(() => {
      for (const conversationId of conversationIds) {
        this.failPendingForAgent(conversationId, safeAgentId, 'Agent 已删除');
        this.db.prepare(
          `DELETE FROM conversation_members WHERE conversation_id = ? AND member_id = ?`,
        ).run(conversationId, safeAgentId);
        this.touch(conversationId, now);
      }
    });
    cleanup();
    return conversationIds;
  }

  setConversationPaused(
    id: string,
    paused: boolean,
    reason?: ConversationPauseReason,
  ): Conversation {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    if (typeof paused !== 'boolean') throw new Error('暂停状态必须是布尔值');
    if (
      reason !== undefined
      && reason !== 'manual'
      && reason !== 'limit'
      && reason !== 'scheduler'
    ) {
      throw new Error('暂停原因只能是 manual、limit 或 scheduler');
    }
    const now = Date.now();
    this.db.prepare(
      `UPDATE conversations SET paused = ?, pause_reason = ?, updated_at = ? WHERE id = ?`,
    ).run(paused ? 1 : 0, paused ? (reason ?? 'manual') : null, now, conversationId);
    return this.requireConversation(conversationId);
  }

  pauseForDiscussionLimit(
    id: string,
    guardContent: string,
  ): { conversation: Conversation; message: ConversationMessage } {
    const conversationId = requireSafeId(id, '会话 id');
    const commit = this.db.transaction(() => {
      const current = this.requireConversation(conversationId);
      if (current.paused) throw new Error('会话已暂停');
      const now = Date.now();
      const updated = this.db.prepare(
        `UPDATE conversations
         SET paused = 1, pause_reason = 'limit', updated_at = ?
         WHERE id = ? AND paused = 0`,
      ).run(now, conversationId);
      if (updated.changes !== 1) throw new Error('会话自动暂停失败');
      const message = this.appendMessageInTransaction({
        conversationId,
        senderId: 'system',
        senderType: 'system',
        content: guardContent,
        protectionBoundary: 'discussion_limit_resume',
      });
      return {
        conversation: this.requireConversation(conversationId),
        message,
      };
    });
    return commit();
  }

  pauseForScheduler(
    id: string,
    reasonContent: string,
  ): { conversation: Conversation; message: ConversationMessage } {
    const conversationId = requireSafeId(id, '会话 id');
    const commit = this.db.transaction(() => {
      const current = this.requireConversation(conversationId);
      if (current.paused) throw new Error('会话已暂停');
      const now = Date.now();
      const updated = this.db.prepare(
        `UPDATE conversations
         SET paused = 1, pause_reason = 'scheduler', updated_at = ?
         WHERE id = ? AND paused = 0`,
      ).run(now, conversationId);
      if (updated.changes !== 1) throw new Error('调度器暂停失败');
      const message = this.appendMessageInTransaction({
        conversationId,
        senderId: 'system',
        senderType: 'system',
        content: reasonContent,
      });
      return {
        conversation: this.requireConversation(conversationId),
        message,
      };
    });
    return commit();
  }

  setMemberPaused(id: string, agentId: string, paused: boolean): ConversationMember {
    const conversationId = requireSafeId(id, '会话 id');
    const safeAgentId = requireSafeId(agentId, 'Agent id');
    this.requireConversation(conversationId);
    const member = this.getMember(conversationId, safeAgentId);
    if (!member || member.memberType !== 'agent') throw new Error('Agent 成员不存在');
    if (typeof paused !== 'boolean') throw new Error('暂停状态必须是布尔值');

    const now = Date.now();
    this.db.prepare(
      `UPDATE conversation_members SET paused = ? WHERE conversation_id = ? AND member_id = ?`,
    ).run(paused ? 1 : 0, conversationId, safeAgentId);
    this.touch(conversationId, now);
    return this.requireMember(conversationId, safeAgentId);
  }

  appendMessage(input: AppendConversationMessageInput): ConversationMessage {
    const append = this.db.transaction(() => this.appendMessageInTransaction(input));
    return append();
  }

  appendHumanMessageAndResumeLimit(
    input: AppendConversationMessageInput,
  ): { message: ConversationMessage; resumedFromLimit: boolean } {
    if (input.senderType !== 'human') {
      throw new Error('自动恢复入口只接受人类消息');
    }
    const commit = this.db.transaction(() => {
      const conversationId = requireSafeId(input.conversationId, '会话 id');
      const before = this.requireConversation(conversationId);
      const resumedFromLimit =
        before.kind === 'group'
        && before.paused
        && before.pauseReason === 'limit';
      const message = this.appendMessageInTransaction(input);
      if (resumedFromLimit) {
        const resumed = this.db.prepare(
          `UPDATE conversations
           SET paused = 0, pause_reason = NULL, updated_at = ?
           WHERE id = ? AND paused = 1 AND pause_reason = 'limit'`,
        ).run(Date.now(), conversationId);
        if (resumed.changes !== 1) throw new Error('会话自动恢复失败');
      }
      return { message, resumedFromLimit };
    });
    return commit();
  }

  appendAgentReplyAndCompleteBatch(
    input: AppendAgentReplyAndCompleteBatchInput,
  ): ConversationMessage {
    const batchId = requireSafeId(input.batchId, '批次 id');
    const conversationId = requireSafeId(input.conversationId, '会话 id');
    const agentId = requireSafeId(input.agentId, 'Agent id');
    const commit = this.db.transaction(() => {
      const batch = this.db.prepare(
        `SELECT conversation_id, agent_id, COUNT(*) AS count
         FROM conversation_deliveries
         WHERE batch_id = ? AND status = 'processing'
         GROUP BY conversation_id, agent_id`,
      ).get(batchId) as {
        conversation_id: string;
        agent_id: string;
        count: number;
      } | undefined;
      if (!batch) throw new Error('待完成的投递批次不存在');
      if (batch.conversation_id !== conversationId || batch.agent_id !== agentId) {
        throw new Error('投递批次与 Agent 回复不匹配');
      }

      const message = this.appendMessageInTransaction({
        id: input.id,
        conversationId,
        senderId: agentId,
        senderType: 'agent',
        content: input.content,
        mentions: input.mentions,
      });
      const completed = this.db.prepare(
        `UPDATE conversation_deliveries
         SET status = 'processed', processed_at = ?, error = NULL
         WHERE batch_id = ? AND status = 'processing'`,
      ).run(Date.now(), batchId);
      if (completed.changes !== batch.count) {
        throw new Error('投递批次未能完整完成');
      }
      return message;
    });
    return commit();
  }

  private appendMessageInTransaction(
    input: AppendConversationMessageInput,
  ): ConversationMessage {
    const conversationId = requireSafeId(input.conversationId, '会话 id');
    const senderId = requireSafeId(input.senderId, '发送者 id');
    const messageId = input.id === undefined
      ? randomUUID()
      : requireSafeId(input.id, '消息 id');
    if (!['human', 'agent', 'system'].includes(input.senderType)) {
      throw new Error('发送者类型无效');
    }
    if (
      input.protectionBoundary !== undefined
      && input.protectionBoundary !== 'discussion_limit_resume'
    ) {
      throw new Error('保护边界类型无效');
    }
    if (input.protectionBoundary !== undefined && input.senderType !== 'system') {
      throw new Error('保护边界只能用于 system 消息');
    }
    if (typeof input.content !== 'string' || !input.content.trim()) {
      throw new Error('消息内容不能为空');
    }

    this.requireConversation(conversationId);
    if (input.senderType !== 'system') {
      const sender = this.getMember(conversationId, senderId);
      if (!sender || sender.memberType !== input.senderType) {
        throw new Error('发送者不是当前会话成员');
      }
    }

    const agentRows = this.db.prepare(
      `SELECT member_id FROM conversation_members
       WHERE conversation_id = ? AND member_type = 'agent' AND enabled = 1`,
    ).all(conversationId) as Array<{ member_id: string }>;
    const agentIds = new Set(agentRows.map((row) => row.member_id));
    const mentions = Array.isArray(input.mentions)
      ? [...new Set(input.mentions
        .map(optionalSafeId)
        .filter((id): id is string => id !== null && agentIds.has(id)))]
      : [];
    const sequenceRow = this.db.prepare(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
       FROM conversation_messages WHERE conversation_id = ?`,
    ).get(conversationId) as { sequence: number };
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, sequence, sender_id, sender_type, content, mentions,
        protection_boundary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      messageId,
      conversationId,
      sequenceRow.sequence,
      senderId,
      input.senderType,
      input.content.trim(),
      JSON.stringify(mentions),
      input.protectionBoundary ?? null,
      now,
    );

    if (input.senderType !== 'system') {
      this.db.prepare(
        `INSERT INTO conversation_deliveries (
          conversation_id, message_id, agent_id, status, batch_id, delivered_at, processed_at, error
        )
        SELECT ?, ?, member_id, 'pending', NULL, ?, NULL, NULL
        FROM conversation_members
        WHERE conversation_id = ?
          AND member_type = 'agent'
          AND enabled = 1
          AND member_id <> ?`,
      ).run(conversationId, messageId, now, conversationId, senderId);
    }
    this.touch(conversationId, now);
    return this.requireMessage(messageId);
  }

  listMessages(
    id: string,
    options: { beforeSequence?: number; limit?: number } = {},
  ): ConversationMessage[] {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    const limit = options.limit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new Error('分页 limit 必须是 1 到 200 的整数');
    }
    if (
      options.beforeSequence !== undefined
      && (!Number.isSafeInteger(options.beforeSequence) || options.beforeSequence < 1)
    ) {
      throw new Error('分页 beforeSequence 必须是正整数');
    }

    const rows = options.beforeSequence === undefined
      ? this.db.prepare(
        `SELECT * FROM conversation_messages
         WHERE conversation_id = ?
         ORDER BY sequence DESC
         LIMIT ?`,
      ).all(conversationId, limit) as MessageRow[]
      : this.db.prepare(
        `SELECT * FROM conversation_messages
         WHERE conversation_id = ? AND sequence < ?
         ORDER BY sequence DESC
         LIMIT ?`,
      ).all(conversationId, options.beforeSequence, limit) as MessageRow[];
    return rows.reverse().map(fromMessageRow);
  }

  getDiscussionStats(id: string): {
    agentMessagesSinceHuman: number;
    lastSenderId?: string;
    consecutiveLastSender: number;
  } {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    const boundary = this.db.prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS sequence
       FROM conversation_messages
       WHERE conversation_id = ?
         AND (
           sender_type = 'human'
           OR protection_boundary = 'discussion_limit_resume'
         )`,
    ).get(conversationId) as { sequence: number };
    const agentMessages = this.db.prepare(
      `SELECT sender_id
       FROM conversation_messages
       WHERE conversation_id = ?
         AND sender_type = 'agent'
         AND sequence > ?
       ORDER BY sequence ASC`,
    ).all(conversationId, boundary.sequence) as Array<{ sender_id: string }>;
    const lastSenderId = agentMessages.at(-1)?.sender_id;
    if (!lastSenderId) {
      return {
        agentMessagesSinceHuman: 0,
        lastSenderId: undefined,
        consecutiveLastSender: 0,
      };
    }
    let consecutiveLastSender = 0;
    for (let index = agentMessages.length - 1; index >= 0; index -= 1) {
      if (agentMessages[index]!.sender_id !== lastSenderId) break;
      consecutiveLastSender += 1;
    }
    return {
      agentMessagesSinceHuman: agentMessages.length,
      lastSenderId,
      consecutiveLastSender,
    };
  }

  listMessagesByIds(id: string, messageIds: string[]): ConversationMessage[] {
    const conversationId = requireSafeId(id, '会话 id');
    this.requireConversation(conversationId);
    if (!Array.isArray(messageIds)) throw new Error('消息 id 必须是数组');
    const safeMessageIds = [...new Set(
      messageIds.map((messageId) => requireSafeId(messageId, '消息 id')),
    )];
    if (safeMessageIds.length === 0) return [];

    const placeholders = safeMessageIds.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT * FROM conversation_messages
       WHERE conversation_id = ? AND id IN (${placeholders})
       ORDER BY sequence ASC`,
    ).all(conversationId, ...safeMessageIds) as MessageRow[];
    return rows.map(fromMessageRow);
  }

  claimPending(
    id: string,
    agentId: string,
    batchId: string,
  ): ConversationDelivery[] {
    const conversationId = requireSafeId(id, '会话 id');
    const safeAgentId = requireSafeId(agentId, 'Agent id');
    const safeBatchId = requireSafeId(batchId, '批次 id');
    const claim = this.db.transaction(() => {
      const rows = this.db.prepare(
        `SELECT d.*
         FROM conversation_deliveries d
         JOIN conversation_messages m ON m.id = d.message_id
         WHERE d.conversation_id = ? AND d.agent_id = ? AND d.status = 'pending'
         ORDER BY m.sequence ASC`,
      ).all(conversationId, safeAgentId) as DeliveryRow[];
      if (rows.length === 0) return [];

      const update = this.db.prepare(
        `UPDATE conversation_deliveries
         SET status = 'processing', batch_id = ?, processed_at = NULL, error = NULL
         WHERE message_id = ? AND agent_id = ? AND status = 'pending'`,
      );
      for (const row of rows) {
        update.run(safeBatchId, row.message_id, safeAgentId);
      }
      return rows.map((row) => fromDeliveryRow({
        ...row,
        status: 'processing',
        batch_id: safeBatchId,
        processed_at: null,
        error: null,
      }));
    });
    return claim();
  }

  requeueBatch(batchId: string): number {
    const safeBatchId = requireSafeId(batchId, '批次 id');
    const result = this.db.prepare(
      `UPDATE conversation_deliveries
       SET status = 'pending', batch_id = NULL, processed_at = NULL, error = NULL
       WHERE batch_id = ? AND status = 'processing'`,
    ).run(safeBatchId);
    return result.changes;
  }

  completeBatch(batchId: string): void {
    const safeBatchId = requireSafeId(batchId, '批次 id');
    this.db.prepare(
      `UPDATE conversation_deliveries
       SET status = 'processed', processed_at = ?, error = NULL
       WHERE batch_id = ? AND status = 'processing'`,
    ).run(Date.now(), safeBatchId);
  }

  failBatch(batchId: string, error: string): void {
    const safeBatchId = requireSafeId(batchId, '批次 id');
    if (typeof error !== 'string' || !error.trim()) throw new Error('投递错误不能为空');
    this.db.prepare(
      `UPDATE conversation_deliveries
       SET status = 'failed', processed_at = ?, error = ?
       WHERE batch_id = ? AND status = 'processing'`,
    ).run(Date.now(), error.trim(), safeBatchId);
  }

  failPendingForAgent(id: string, agentId: string, error: string): number {
    const conversationId = requireSafeId(id, '会话 id');
    const safeAgentId = requireSafeId(agentId, 'Agent id');
    this.requireConversation(conversationId);
    if (typeof error !== 'string' || !error.trim()) {
      throw new Error('投递错误不能为空');
    }
    const result = this.db.prepare(
      `UPDATE conversation_deliveries
       SET status = 'failed', batch_id = NULL, processed_at = ?, error = ?
       WHERE conversation_id = ?
         AND agent_id = ?
         AND status IN ('pending', 'processing')`,
    ).run(
      Date.now(),
      error.trim(),
      conversationId,
      safeAgentId,
    );
    return result.changes;
  }

  hasPending(id: string, agentId: string): boolean {
    const conversationId = optionalSafeId(id);
    const safeAgentId = optionalSafeId(agentId);
    if (!conversationId || !safeAgentId) return false;
    const row = this.db.prepare(
      `SELECT 1 AS found FROM conversation_deliveries
       WHERE conversation_id = ? AND agent_id = ? AND status = 'pending'
       LIMIT 1`,
    ).get(conversationId, safeAgentId) as { found: number } | undefined;
    return row?.found === 1;
  }

  recoverProcessing(): number {
    const result = this.db.prepare(
      `UPDATE conversation_deliveries
       SET status = 'pending', batch_id = NULL, processed_at = NULL, error = NULL
       WHERE status = 'processing'`,
    ).run();
    return result.changes;
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.get(id);
    if (!conversation) throw new Error('会话不存在');
    return conversation;
  }

  private getMember(conversationId: string, memberId: string): ConversationMember | null {
    const row = this.db.prepare(
      `SELECT * FROM conversation_members WHERE conversation_id = ? AND member_id = ?`,
    ).get(conversationId, memberId) as MemberRow | undefined;
    return row ? fromMemberRow(row) : null;
  }

  private requireMember(conversationId: string, memberId: string): ConversationMember {
    const member = this.getMember(conversationId, memberId);
    if (!member) throw new Error('Agent 成员不存在');
    return member;
  }

  private requireMessage(id: string): ConversationMessage {
    const row = this.db.prepare(`SELECT * FROM conversation_messages WHERE id = ?`).get(id) as
      | MessageRow
      | undefined;
    if (!row) throw new Error('消息写入失败');
    return fromMessageRow(row);
  }

  private touch(id: string, now: number): void {
    this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, id);
  }
}
