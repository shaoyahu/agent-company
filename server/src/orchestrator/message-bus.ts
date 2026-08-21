/**
 * 消息总线 - 多 agent 协作的核心
 *
 * 设计:
 * - 频道 channel(general, dev-team, boss-room 等)
 * - 每个 agent 订阅自己感兴趣的频道
 * - 消息发到频道,订阅者收到 → 决定要不要接话
 * - 持久化到 SQLite(供 dashboard)
 *
 * 模式:
 * - 调度模式(95%):orchestrator 派活,agent 干活,不聊天
 * - 会议模式(5%):开临时频道,agent 自由讨论
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ChatMessage } from '../types/company.js';
import { MessageRepo } from '../store/repository.js';

export type MessageHandler = (msg: ChatMessage) => void | Promise<void>;

const BLOCKED_MENTION_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export function extractMentionIds(content: unknown): string[] {
  if (typeof content !== 'string' || !content.trim()) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const id = match[1]!;
    if (BLOCKED_MENTION_IDS.has(id.toLocaleLowerCase()) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export class MessageBus extends EventEmitter {
  /** channel → subscriber handlers */
  private subscriptions = new Map<string, Set<MessageHandler>>();
  private messageRepo: MessageRepo;

  constructor() {
    super();
    this.setMaxListeners(200);
    this.messageRepo = new MessageRepo();
  }

  /**
   * 订阅频道
   */
  subscribe(channel: string, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.subscriptions.get(channel)!.add(handler);
    return () => {
      this.subscriptions.get(channel)?.delete(handler);
    };
  }

  /**
   * 发送消息(广播给订阅者,持久化到 db)
   */
  async publish(opts: {
    projectId?: string;
    taskId?: string;
    channel: string;
    fromId: string;
    fromName: string;
    fromRole?: string;
    content: string;
    type?: 'message' | 'system' | 'tool' | 'thought';
    toolName?: string;
    toolInput?: Record<string, unknown>;
    mentions?: string[];
  }): Promise<ChatMessage> {
    const msg = this.messageRepo.create({
      id: randomUUID(),
      projectId: opts.projectId,
      taskId: opts.taskId,
      channel: opts.channel,
      fromId: opts.fromId,
      fromName: opts.fromName,
      fromRole: opts.fromRole,
      content: opts.content,
      type: opts.type ?? 'message',
      toolName: opts.toolName,
      toolInput: opts.toolInput,
      mentions: opts.mentions ?? extractMentionIds(opts.content),
    });

    // 异步通知订阅者
    queueMicrotask(() => this.notify(msg));

    return msg;
  }

  private async notify(msg: ChatMessage): Promise<void> {
    const handlers = this.subscriptions.get(msg.channel);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        await handler(msg);
      } catch (e) {
        console.error('[bus] handler error:', e);
      }
    }
  }

  /**
   * 列历史消息
   */
  history(projectId: string, channel?: string, limit: number = 200): ChatMessage[] {
    if (channel) {
      return this.messageRepo.listByChannel(projectId, channel, limit);
    }
    return this.messageRepo.listByProject(projectId, limit);
  }
}
