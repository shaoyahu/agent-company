import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  Conversation,
  ConversationMember,
  ConversationMessage,
  CreateConversationInput,
} from '../conversations/types.js';
import { extractMentionIds } from '../orchestrator/message-bus.js';
import type { ConversationRepo } from '../store/conversations.js';
import type { AgentConfig } from '../types/company.js';

const BLOCKED_IDS = new Set(['__proto__', 'constructor']);

export interface ConversationRouteDeps {
  repo: ConversationRepo;
  getAgents(): AgentConfig[];
  hasProvider(id: string): boolean;
  bossName: string;
  onMessage(message: ConversationMessage): void;
  notifyMessage(conversationId: string): void;
  notifyMembershipChanged(conversationId: string): void;
  pauseConversation(conversationId: string): void;
  resumeConversation(conversationId: string): void;
  pauseAgent(conversationId: string, agentId: string): void;
  resumeAgent(conversationId: string, agentId: string): void;
  removeConversation(conversationId: string): void;
  onConversationUpdated(conversationId: string): void;
    onConversationDeleted(conversationId: string): void;
}

interface ConversationDetail extends Conversation {
  members: ConversationMember[];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是有效字符串`);
  const id = value.trim();
  if (!id || BLOCKED_IDS.has(id)) throw new Error(`${label}必须是有效字符串`);
  return id;
}

function agentEnabled(agent: AgentConfig): boolean {
  const enabled = (agent as AgentConfig & { enabled?: unknown }).enabled;
  return enabled !== false;
}

function requireAgent(deps: ConversationRouteDeps, value: unknown): AgentConfig {
  const id = requireSafeId(value, 'Agent id');
  if (id === 'boss') throw new Error('boss 不能作为 Agent 成员');
  const agent = deps.getAgents().find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`Agent '${id}' 不存在`);
  if (!agentEnabled(agent)) throw new Error(`Agent '${id}' 未启用`);
  return agent;
}

function requireSchedulerInput(
  deps: ConversationRouteDeps,
  body: Record<string, unknown>,
  kind: 'direct' | 'group',
): Pick<CreateConversationInput, 'schedulerMode' | 'schedulerLlm' | 'schedulerAgentId'> {
  if (kind === 'direct') {
    return { schedulerMode: 'none' };
  }
  if (body.schedulerMode !== 'llm' && body.schedulerMode !== 'agent') {
    throw new Error('群聊必须配置调度器');
  }
  if (body.schedulerMode === 'llm') {
    const schedulerLlm = requireSafeId(body.schedulerLlm, '调度器 LLM');
    if (!deps.hasProvider(schedulerLlm)) throw new Error('调度器 LLM 不存在');
    if (body.schedulerAgentId !== undefined) {
      throw new Error('LLM 调度器不能配置调度器 Agent');
    }
    return { schedulerMode: 'llm', schedulerLlm };
  }

  const scheduler = requireAgent(deps, body.schedulerAgentId);
  if (body.schedulerLlm !== undefined) {
    throw new Error('Agent 调度器不能配置调度器 LLM');
  }
  return { schedulerMode: 'agent', schedulerAgentId: scheduler.id };
}

function requireAgentIds(
  deps: ConversationRouteDeps,
  value: unknown,
  kind: unknown,
): { agents: AgentConfig[]; ids: string[] } {
  if (!Array.isArray(value)) throw new Error('Agent 成员必须是数组');
  const ids = value.map((id) => requireSafeId(id, 'Agent id'));
  if (new Set(ids).size !== ids.length) throw new Error('Agent 成员不能重复');
  if (kind === 'direct' && ids.length !== 1) {
    throw new Error('私聊必须正好包含一个 Agent');
  }
  if (kind === 'group' && ids.length < 2) {
    throw new Error('群聊至少需要两个 Agent');
  }
  const agents = ids.map((id) => requireAgent(deps, id));
  return { agents, ids };
}

function requireConversationId(params: unknown): string {
  const record = requireRecord(params, '路径参数');
  return requireSafeId(record.id, '会话 id');
}

function requireMemberParams(params: unknown): { id: string; agentId: string } {
  const record = requireRecord(params, '路径参数');
  return {
    id: requireSafeId(record.id, '会话 id'),
    agentId: requireSafeId(record.agentId, 'Agent id'),
  };
}

function requireConversation(deps: ConversationRouteDeps, id: string): Conversation {
  const conversation = deps.repo.get(id);
  if (!conversation) throw new Error('会话不存在');
  return conversation;
}

function readDetail(deps: ConversationRouteDeps, id: string): ConversationDetail {
  const conversation = requireConversation(deps, id);
  const existingAgentIds = new Set(deps.getAgents().map((agent) => agent.id));
  return {
    ...conversation,
    members: deps.repo
      .listMembers(id)
      .filter((member) =>
        member.memberType === 'human' || existingAgentIds.has(member.memberId)),
  };
}

function readMember(deps: ConversationRouteDeps, id: string, agentId: string): ConversationMember {
  const member = deps.repo.listMembers(id).find((candidate) => candidate.memberId === agentId);
  if (!member || member.memberType !== 'agent') throw new Error('Agent 成员不存在');
  return member;
}

function readMessage(
  deps: ConversationRouteDeps,
  conversationId: string,
  messageId: string,
): ConversationMessage {
  const message = deps.repo
    .listMessages(conversationId, { limit: 200 })
    .find((candidate) => candidate.id === messageId);
  if (!message) throw new Error('消息写入失败');
  return message;
}

function sendError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message === '会话不存在' || message === 'Agent 成员不存在' ? 404 : 400;
  return reply.code(status).send({ error: message || '请求无效' });
}

function parseOptionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`分页 ${label} 必须是整数`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`分页 ${label} 必须是整数`);
  return parsed;
}

export function registerConversationRoutes(
  app: FastifyInstance,
  deps: ConversationRouteDeps,
): void {
  app.get('/api/conversations', async () => deps.repo.list());

  app.post('/api/conversations', async (request, reply) => {
    try {
      const body = requireRecord(request.body, '请求体');
      if (body.kind !== 'direct' && body.kind !== 'group') {
        throw new Error('会话类型只能是 direct 或 group');
      }
      if (body.createdBy !== undefined && body.createdBy !== 'boss') {
        throw new Error('会话创建者固定为 boss');
      }
      const { agents, ids } = requireAgentIds(deps, body.agentIds, body.kind);
      let title: string;
      if (body.kind === 'direct') {
        if (body.title !== undefined && typeof body.title !== 'string') {
          throw new Error('会话标题必须是字符串');
        }
        title = typeof body.title === 'string' && body.title.trim()
          ? body.title.trim()
          : `与${agents[0]!.name || agents[0]!.id}对话`;
      } else {
        if (typeof body.title !== 'string' || !body.title.trim()) {
          throw new Error('群聊标题不能为空');
        }
        title = body.title.trim();
      }
      if (body.cooldownMs !== undefined && body.cooldownMs !== 5_000) {
        throw new Error('会话冷却时间固定为 5000 毫秒');
      }

      const input: CreateConversationInput = {
        kind: body.kind,
        title,
        agentIds: ids,
        createdBy: 'boss',
        cooldownMs: 5_000,
        ...requireSchedulerInput(deps, body, body.kind),
      };
      for (const key of [
        'agentMessageLimit',
        'maxConsecutiveSpeeches',
        'maxMessageChars',
      ] as const) {
        if (body[key] !== undefined) input[key] = body[key] as number;
      }

      const existing = body.kind === 'direct'
        ? deps.repo.findDirectByAgent(ids[0]!)
        : null;
      const created = deps.repo.create(input);
      if (existing) return readDetail(deps, created.id);
      const detail = readDetail(deps, created.id);
      deps.onConversationUpdated(created.id);
      return detail;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/api/conversations/:id', async (request, reply) => {
    try {
      return readDetail(deps, requireConversationId(request.params));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch('/api/conversations/:id', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      const body = requireRecord(request.body, '请求体');
      const updated = deps.repo.updateConversationProfile(id, {
        title: body.title,
        avatar: body.avatar,
      });
      deps.onConversationUpdated(id);
      return {
        ...updated,
        members: deps.repo.listMembers(id),
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete('/api/conversations/:id', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      requireConversation(deps, id);
      if (!deps.repo.delete(id) || deps.repo.get(id)) throw new Error('会话删除失败');
      deps.removeConversation(id);
      deps.onConversationDeleted(id);
      return { ok: true as const };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/conversations/:id/pin', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      deps.repo.setConversationPinned(id, true);
      deps.onConversationUpdated(id);
      return readDetail(deps, id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/conversations/:id/unpin', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      deps.repo.setConversationPinned(id, false);
      deps.onConversationUpdated(id);
      return readDetail(deps, id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/conversations/:id/mute', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      deps.repo.setConversationMuted(id, true);
      deps.onConversationUpdated(id);
      return readDetail(deps, id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/conversations/:id/unmute', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      deps.repo.setConversationMuted(id, false);
      deps.onConversationUpdated(id);
      return readDetail(deps, id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/conversations/:id/read', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      deps.repo.markConversationRead(id);
      deps.onConversationUpdated(id);
      return readDetail(deps, id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/conversations/:id/members', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      const body = requireRecord(request.body, '请求体');
      const agent = requireAgent(deps, body.agentId);
      deps.repo.addAgentMember(id, agent.id);
      const member = readMember(deps, id, agent.id);
      deps.notifyMembershipChanged(id);
      deps.onConversationUpdated(id);
      return member;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete('/api/conversations/:id/members/:agentId', async (request, reply) => {
    try {
      const { id, agentId } = requireMemberParams(request.params);
      if (agentId === 'boss') throw new Error('不能移除 boss');
      if (!deps.repo.removeAgentMember(id, agentId)) throw new Error('Agent 成员不存在');
      if (deps.repo.listMembers(id).some((member) => member.memberId === agentId)) {
        throw new Error('Agent 成员移除失败');
      }
      deps.notifyMembershipChanged(id);
      deps.onConversationUpdated(id);
      return { ok: true as const };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/api/conversations/:id/messages', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      const query = requireRecord(request.query, '分页参数');
      return deps.repo.listMessages(id, {
        beforeSequence: parseOptionalInteger(query.beforeSequence, 'beforeSequence'),
        limit: parseOptionalInteger(query.limit, 'limit'),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/conversations/:id/messages', async (request, reply) => {
    try {
      const id = requireConversationId(request.params);
      const body = requireRecord(request.body, '请求体');
      if (Object.hasOwn(body, 'senderId') || Object.hasOwn(body, 'senderType')) {
        throw new Error('客户端不能指定消息发送者');
      }
      if (typeof body.content !== 'string' || !body.content.trim()) {
        throw new Error('消息内容不能为空');
      }
      const enabledMemberIds = new Set(
        deps.repo
          .listMembers(id)
          .filter((member) => member.memberType === 'agent' && member.enabled)
          .map((member) => member.memberId),
      );
      const enabledAgentIds = new Set(
        deps.getAgents()
          .filter(agentEnabled)
          .map((agent) => agent.id),
      );
      const mentions = extractMentionIds(body.content).filter(
        (agentId) => enabledMemberIds.has(agentId) && enabledAgentIds.has(agentId),
      );
      const committed = deps.repo.appendHumanMessageAndResumeLimit({
        conversationId: id,
        senderId: 'boss',
        senderType: 'human',
        content: body.content,
        mentions,
      });
      const message = readMessage(deps, id, committed.message.id);
      deps.onMessage(message);
      if (committed.resumedFromLimit) {
        deps.onConversationUpdated(id);
        deps.resumeConversation(id);
      } else {
        deps.notifyMessage(id);
      }
      return message;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  const setConversationPaused = async (
    request: { params: unknown },
    reply: FastifyReply,
    paused: boolean,
  ) => {
    try {
      const id = requireConversationId(request.params);
      const conversation = deps.repo.setConversationPaused(
        id,
        paused,
        paused ? 'manual' : undefined,
      );
      if (paused) deps.pauseConversation(id);
      else deps.resumeConversation(id);
      deps.onConversationUpdated(id);
      return conversation;
    } catch (error) {
      return sendError(reply, error);
    }
  };

  app.post('/api/conversations/:id/pause', async (request, reply) =>
    setConversationPaused(request, reply, true));
  app.post('/api/conversations/:id/resume', async (request, reply) =>
    setConversationPaused(request, reply, false));

  const setAgentPaused = async (
    request: { params: unknown },
    reply: FastifyReply,
    paused: boolean,
  ) => {
    try {
      const { id, agentId } = requireMemberParams(request.params);
      if (agentId === 'boss') throw new Error('boss 不是 Agent 成员');
      deps.repo.setMemberPaused(id, agentId, paused);
      if (paused) deps.pauseAgent(id, agentId);
      else deps.resumeAgent(id, agentId);
      const member = readMember(deps, id, agentId);
      deps.onConversationUpdated(id);
      return member;
    } catch (error) {
      return sendError(reply, error);
    }
  };

  app.post('/api/conversations/:id/members/:agentId/pause', async (request, reply) =>
    setAgentPaused(request, reply, true));
  app.post('/api/conversations/:id/members/:agentId/resume', async (request, reply) =>
    setAgentPaused(request, reply, false));
}
