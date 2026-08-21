import { randomUUID } from 'node:crypto';
import type { ConversationRepo } from '../store/conversations.js';
import type { AgentConfig } from '../types/company.js';
import type { AgentSpeaker } from './agentSpeaker.js';
import type { ConversationScheduler } from './scheduler.js';
import type {
  Conversation,
  ConversationMessage,
  AgentSpeechDecision,
  ParticipantState,
} from './types.js';

export type { ParticipantState } from './types.js';

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ConversationRuntimeEvents {
  message(message: ConversationMessage): void;
  state(event: {
    conversationId: string;
    agentId: string;
    state: ParticipantState;
    since: number;
  }): void;
  updated?(conversationId: string): void;
}

export type DirectReplyGenerator = (
  conversation: Conversation,
  agentId: string,
) => Promise<string>;

interface ParticipantActor {
  conversationId: string;
  agentId: string;
  state: ParticipantState;
  generation: number;
  activeBatchId?: string;
  inFlight: boolean;
  coolingReady: boolean;
  timer?: unknown;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function discussionLimitMessage(limit: number): string {
  return `本轮 Agent 讨论已达到 ${limit} 条，为避免循环已暂停。发送新消息或手动恢复后可继续。`;
}

function actorKey(conversationId: string, agentId: string): string {
  return `${conversationId}\u0000${agentId}`;
}

function agentEnabled(agent: AgentConfig): boolean {
  const enabled = (agent as AgentConfig & { enabled?: unknown }).enabled;
  return enabled !== false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const message = String(error).trim();
  return message || 'Agent 群聊发言失败';
}

export class ConversationRuntimeManager {
  private readonly actors = new Map<string, ParticipantActor>();
  private running = false;

  constructor(
    private readonly repo: ConversationRepo,
    private readonly speaker: AgentSpeaker,
    private readonly getAgents: () => AgentConfig[],
    private readonly events: ConversationRuntimeEvents,
    private readonly clock: Clock = systemClock,
    private readonly generateDirectReply?: DirectReplyGenerator,
    private readonly scheduler?: ConversationScheduler,
  ) {}

  start(): void {
    if (this.running) return;
    this.repo.recoverProcessing();
    this.running = true;
    for (const conversation of this.repo.list()) {
      this.scheduleConversation(conversation.id, true);
    }
  }

  stop(): void {
    this.running = false;
    for (const actor of this.actors.values()) {
      actor.generation += 1;
      if (actor.timer !== undefined) this.clock.clearTimeout(actor.timer);
    }
    this.actors.clear();
  }

  removeConversation(conversationId: string): void {
    for (const [key, actor] of this.actors) {
      if (actor.conversationId !== conversationId) continue;
      actor.generation += 1;
      actor.coolingReady = false;
      if (actor.timer !== undefined) {
        this.clock.clearTimeout(actor.timer);
        actor.timer = undefined;
      }
      actor.activeBatchId = undefined;
      this.actors.delete(key);
    }
  }

  notifyMessage(conversationId: string): void {
    if (!this.running) return;
    const conversation = this.repo.get(conversationId);
    if (!conversation) return;
    if (conversation.paused) {
      this.pauseConversation(conversationId);
      return;
    }
    this.scheduleConversation(conversationId, true);
  }

  notifyMembershipChanged(conversationId: string): void {
    if (!this.running) return;
    const conversation = this.repo.get(conversationId);
    if (!conversation) return;
    const memberIds = new Set(
      this.repo
        .listMembers(conversationId)
        .filter((member) => member.memberType === 'agent')
        .map((member) => member.memberId),
    );
    for (const actor of this.actors.values()) {
      if (
        actor.conversationId === conversationId
        && !memberIds.has(actor.agentId)
      ) {
        this.invalidateActor(actor, '已移出群聊');
      }
    }
    this.scheduleConversation(conversationId, false);
  }

  notifyAgentChanged(agentId: string): void {
    if (!this.running) return;
    const available = this.getAgents().some(
      (agent) => agent.id === agentId && agentEnabled(agent),
    );
    for (const conversation of this.repo.list()) {
      const member = this.repo
        .listMembers(conversation.id)
        .find((candidate) =>
          candidate.memberType === 'agent' && candidate.memberId === agentId);
      if (!member) continue;
      if (!available) {
        this.failUnavailableAgent(conversation.id, agentId);
        continue;
      }
      const actor = this.actors.get(actorKey(conversation.id, agentId));
      if (actor) this.restartActor(actor, conversation.paused || member.paused);
      this.scheduleConversation(conversation.id, true);
    }
  }

  private scheduleConversation(conversationId: string, includeDirect: boolean): void {
    const conversation = this.repo.get(conversationId);
    if (!conversation || conversation.paused) return;
    if (conversation.kind === 'direct' && !includeDirect) return;
    const configuredAgents = new Map(
      this.getAgents()
        .filter(agentEnabled)
        .map((agent) => [agent.id, agent]),
    );
    for (const member of this.repo.listMembers(conversationId)) {
      if (member.memberType !== 'agent') continue;
      if (!member.enabled || !configuredAgents.has(member.memberId)) {
        this.failUnavailableAgent(conversationId, member.memberId);
        continue;
      }
      if (member.paused) continue;
      const actor = this.requireActor(conversationId, member.memberId);
      if (actor.state === 'error') this.setState(actor, 'idle');
      if (actor.state === 'idle' && this.repo.hasPending(conversationId, member.memberId)) {
        if (conversation.kind === 'direct') this.beginImmediately(actor);
        else this.beginCooling(actor, conversation.cooldownMs);
      }
    }
  }

  pauseConversation(conversationId: string): void {
    for (const actor of this.actors.values()) {
      if (actor.conversationId === conversationId) this.pauseActor(actor);
    }
  }

  resumeConversation(conversationId: string): void {
    for (const actor of this.actors.values()) {
      if (actor.conversationId === conversationId && actor.state === 'paused') {
        this.setState(actor, 'idle');
      }
    }
    this.notifyMessage(conversationId);
  }

  pauseAgent(conversationId: string, agentId: string): void {
    this.pauseActor(this.requireActor(conversationId, agentId));
  }

  resumeAgent(conversationId: string, agentId: string): void {
    const actor = this.requireActor(conversationId, agentId);
    if (actor.state === 'paused') this.setState(actor, 'idle');
    this.notifyMessage(conversationId);
  }

  private requireActor(conversationId: string, agentId: string): ParticipantActor {
    const key = actorKey(conversationId, agentId);
    const existing = this.actors.get(key);
    if (existing) return existing;
    const actor: ParticipantActor = {
      conversationId,
      agentId,
      state: 'idle',
      generation: 0,
      inFlight: false,
      coolingReady: false,
    };
    this.actors.set(key, actor);
    return actor;
  }

  private beginCooling(actor: ParticipantActor, delayMs: number): void {
    if (!this.running || actor.state !== 'idle') return;
    actor.coolingReady = false;
    this.setState(actor, 'cooling');
    actor.timer = this.clock.setTimeout(() => {
      actor.timer = undefined;
      actor.coolingReady = true;
      void this.runActor(actor);
    }, delayMs);
  }

  private beginImmediately(actor: ParticipantActor): void {
    if (!this.running || actor.state !== 'idle') return;
    actor.coolingReady = true;
    actor.state = 'cooling';
    void this.runActor(actor);
  }

  private async runActor(actor: ParticipantActor): Promise<void> {
    if (!this.running || actor.state !== 'cooling') return;
    if (actor.inFlight) return;
    actor.coolingReady = false;
    const generation = actor.generation;
    const batchId = randomUUID();
    const deliveries = this.repo.claimPending(
      actor.conversationId,
      actor.agentId,
      batchId,
    );
    if (deliveries.length === 0) {
      this.setState(actor, 'idle');
      return;
    }
    actor.activeBatchId = batchId;

    try {
      const conversation = this.repo.get(actor.conversationId);
      if (!conversation) throw new Error('会话不存在');
      if (conversation.paused) {
        this.pauseActor(actor);
        return;
      }
      const agent = this.getAgents().find((candidate) => candidate.id === actor.agentId);
      if (!agent || !agentEnabled(agent)) {
        throw new Error(`Agent '${actor.agentId}' 不存在或未启用`);
      }
      let decision: AgentSpeechDecision;
      if (conversation.kind === 'direct') {
        if (!this.generateDirectReply) {
          throw new Error('私聊回复执行器未配置');
        }
        this.setState(actor, 'speaking');
        if (!this.isCurrent(actor, generation, 'speaking')) {
          this.handleStaleBatch(actor, batchId);
          return;
        }
        actor.inFlight = true;
        try {
          const content = await this.generateDirectReply(conversation, actor.agentId);
          if (typeof content !== 'string' || !content.trim()) {
            throw new Error(`Agent '${actor.agentId}' 未返回有效回复`);
          }
          decision = { decision: 'speak', content };
        } finally {
          actor.inFlight = false;
        }
        if (!this.isCurrent(actor, generation, 'speaking')) {
          this.handleStaleBatch(actor, batchId);
          return;
        }
      } else {
        const stats = this.repo.getDiscussionStats(actor.conversationId);
        if (stats.agentMessagesSinceHuman >= conversation.agentMessageLimit) {
          this.repo.completeBatch(batchId);
          this.clearActiveBatch(actor, batchId);
          this.pauseForDiscussionLimit(actor.conversationId);
          return;
        }
        if (
          stats.lastSenderId === actor.agentId
          && stats.consecutiveLastSender >= conversation.maxConsecutiveSpeeches
        ) {
          this.repo.completeBatch(batchId);
          this.clearActiveBatch(actor, batchId);
          this.finishActor(actor);
          return;
        }

        const members = this.repo.listMembers(actor.conversationId);
        const snapshotIds = new Set(deliveries.map((delivery) => delivery.messageId));
        const messages = this.repo.listMessages(actor.conversationId, { limit: 200 });
        const newMessages = this.repo.listMessagesByIds(
          actor.conversationId,
          deliveries.map((delivery) => delivery.messageId),
        );
        const history = messages.filter((message) => !snapshotIds.has(message.id));

        this.setState(actor, 'deciding');
        if (!this.isCurrent(actor, generation, 'deciding')) {
          this.handleStaleBatch(actor, batchId);
          return;
        }
        actor.inFlight = true;
        try {
          decision = await this.speaker.decideAndSpeak({
            conversation,
            agent,
            members,
            history,
            newMessages,
          });
        } finally {
          actor.inFlight = false;
        }
        if (!this.isCurrent(actor, generation, 'deciding')) {
          this.handleStaleBatch(actor, batchId);
          return;
        }
      }
      if (decision.decision === 'speak') {
        if (conversation.kind === 'group') this.setState(actor, 'speaking');
        if (!this.isCurrent(actor, generation, 'speaking')) {
          this.handleStaleBatch(actor, batchId);
          return;
        }
        const message = this.repo.appendAgentReplyAndCompleteBatch({
          batchId,
          conversationId: actor.conversationId,
          agentId: actor.agentId,
          content: decision.content,
        });
        this.clearActiveBatch(actor, batchId);
        this.events.message(message);
        if (!this.isCurrent(actor, generation, 'speaking')) return;
        if (conversation.kind === 'group') {
          const latestStats = this.repo.getDiscussionStats(actor.conversationId);
          if (latestStats.agentMessagesSinceHuman >= conversation.agentMessageLimit) {
            this.pauseForDiscussionLimit(actor.conversationId);
            return;
          }
          const pausedByScheduler = await this.maybePauseByScheduler(
            actor.conversationId,
            message,
          );
          if (pausedByScheduler) return;
        }
        this.notifyMessage(actor.conversationId);
        if (!this.isCurrent(actor, generation, 'speaking')) return;
      } else {
        this.repo.completeBatch(batchId);
        this.clearActiveBatch(actor, batchId);
      }
      this.finishActor(actor);
    } catch (error) {
      if (!this.isCurrent(actor, generation)) {
        this.handleStaleBatch(actor, batchId);
        return;
      }
      this.repo.failBatch(batchId, errorMessage(error));
      this.clearActiveBatch(actor, batchId);
      this.setState(actor, 'error');
      if (this.repo.hasPending(actor.conversationId, actor.agentId)) {
        this.finishActor(actor);
      }
    }
  }

  private finishActor(actor: ParticipantActor): void {
    if (!this.running) return;
    this.setState(actor, 'idle');
    const conversation = this.repo.get(actor.conversationId);
    if (!conversation) return;
    if (conversation.paused) {
      this.pauseActor(actor);
      return;
    }
    const member = this.repo
      .listMembers(actor.conversationId)
      .find((candidate) => candidate.memberId === actor.agentId);
    if (!member || member.memberType !== 'agent') {
      this.invalidateActor(actor, '已移出群聊');
      return;
    }
    if (member.paused || !member.enabled) return;
    const agent = this.getAgents().find((candidate) => candidate.id === actor.agentId);
    if (!agent || !agentEnabled(agent)) {
      this.failUnavailableAgent(actor.conversationId, actor.agentId);
      return;
    }
    if (!this.repo.hasPending(actor.conversationId, actor.agentId)) return;
    if (conversation.kind === 'direct') this.beginImmediately(actor);
    else this.beginCooling(actor, conversation.cooldownMs);
  }

  private isCurrent(
    actor: ParticipantActor,
    generation: number,
    state?: ParticipantState,
  ): boolean {
    return this.running
      && this.actors.get(actorKey(actor.conversationId, actor.agentId)) === actor
      && actor.generation === generation
      && (state === undefined || actor.state === state);
  }

  private handleStaleBatch(actor: ParticipantActor, batchId: string): void {
    if (
      !this.running
      || this.actors.get(actorKey(actor.conversationId, actor.agentId)) !== actor
    ) {
      return;
    }
    if (actor.activeBatchId === batchId) {
      this.repo.requeueBatch(batchId);
      this.clearActiveBatch(actor, batchId);
    }
    if (actor.state === 'cooling' && actor.coolingReady && !actor.inFlight) {
      void this.runActor(actor);
    }
  }

  private pauseActor(actor: ParticipantActor): void {
    actor.generation += 1;
    actor.coolingReady = false;
    if (actor.timer !== undefined) {
      this.clock.clearTimeout(actor.timer);
      actor.timer = undefined;
    }
    if (actor.activeBatchId !== undefined) {
      const batchId = actor.activeBatchId;
      this.repo.requeueBatch(batchId);
      this.clearActiveBatch(actor, batchId);
    }
    this.setState(actor, 'paused');
  }

  private restartActor(actor: ParticipantActor, paused: boolean): void {
    actor.generation += 1;
    actor.coolingReady = false;
    if (actor.timer !== undefined) {
      this.clock.clearTimeout(actor.timer);
      actor.timer = undefined;
    }
    if (actor.activeBatchId !== undefined) {
      const batchId = actor.activeBatchId;
      this.repo.requeueBatch(batchId);
      this.clearActiveBatch(actor, batchId);
    }
    this.setState(actor, paused ? 'paused' : 'idle');
  }

  private pauseForDiscussionLimit(conversationId: string): void {
    const conversation = this.repo.get(conversationId);
    if (!conversation || (conversation.paused && conversation.pauseReason === 'limit')) {
      return;
    }
    if (conversation.paused) return;
    const committed = this.repo.pauseForDiscussionLimit(
      conversationId,
      discussionLimitMessage(conversation.agentMessageLimit),
    );
    this.events.message(committed.message);
    this.events.updated?.(conversationId);
    this.pauseConversation(conversationId);
  }

  private async maybePauseByScheduler(
    conversationId: string,
    latestAgentMessage: ConversationMessage,
  ): Promise<boolean> {
    const conversation = this.repo.get(conversationId);
    if (!conversation || conversation.paused || conversation.kind !== 'group') return false;
    if (!this.scheduler || conversation.schedulerMode === 'none') return false;
    try {
      const decision = await this.scheduler.decide({
        conversation,
        latestAgentMessage,
        history: this.repo.listMessages(conversationId, { limit: 200 }),
      });
      if (decision.decision !== 'pause_conversation') return false;
      const committed = this.repo.pauseForScheduler(conversationId, decision.reason);
      this.events.message(committed.message);
      this.events.updated?.(conversationId);
      this.pauseConversation(conversationId);
      return true;
    } catch (error) {
      console.error('[conversation-runtime] scheduler failed:', errorMessage(error));
      return false;
    }
  }

  private failUnavailableAgent(conversationId: string, agentId: string): void {
    const error = `Agent '${agentId}' 不存在或未启用`;
    const failed = this.repo.failPendingForAgent(conversationId, agentId, error);
    const actor = this.actors.get(actorKey(conversationId, agentId));
    if (failed === 0 && !actor) return;
    const target = actor ?? this.requireActor(conversationId, agentId);
    target.generation += 1;
    target.coolingReady = false;
    if (target.timer !== undefined) {
      this.clock.clearTimeout(target.timer);
      target.timer = undefined;
    }
    target.activeBatchId = undefined;
    this.setState(target, 'error');
  }

  private invalidateActor(actor: ParticipantActor, error: string): void {
    actor.generation += 1;
    actor.coolingReady = false;
    if (actor.timer !== undefined) {
      this.clock.clearTimeout(actor.timer);
      actor.timer = undefined;
    }
    this.repo.failPendingForAgent(actor.conversationId, actor.agentId, error);
    actor.activeBatchId = undefined;
    this.setState(actor, 'error');
    this.actors.delete(actorKey(actor.conversationId, actor.agentId));
  }

  private clearActiveBatch(actor: ParticipantActor, batchId: string): void {
    if (actor.activeBatchId === batchId) actor.activeBatchId = undefined;
  }

  private setState(actor: ParticipantActor, state: ParticipantState): void {
    actor.state = state;
    this.events.state({
      conversationId: actor.conversationId,
      agentId: actor.agentId,
      state,
      since: this.clock.now(),
    });
  }
}
