export interface MentionAgent {
  id: string;
  name?: string;
  role?: string;
  department?: string;
  avatar?: string;
  enabled?: unknown;
}

export interface MentionState {
  open: boolean;
  query: string;
  start: number;
  selectedIndex: number;
}

export interface MentionKeyDownInput {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  mentionOpen: boolean;
  candidateCount: number;
  selectedIndex: number;
}

export type MentionKeyDownDecision =
  | { action: 'none'; preventDefault: false }
  | { action: 'close' | 'send'; preventDefault: true }
  | { action: 'move' | 'select'; selectedIndex: number; preventDefault: true };

export interface MentionKeyDownHandlers {
  preventDefault(): void;
  close(): void;
  move(selectedIndex: number): void;
  select(selectedIndex: number): void;
  send(): void;
}

const BLOCKED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const CLOSED_MENTION: MentionState = {
  open: false,
  query: '',
  start: 0,
  selectedIndex: 0,
};

function normalizeQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function isValidAgentId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) return false;
  return !BLOCKED_IDS.has(value.toLocaleLowerCase());
}

export function filterEnabledAgents<T extends MentionAgent>(
  agents: T[] | null | undefined,
): T[] {
  if (!Array.isArray(agents)) return [];
  return agents.filter((agent): agent is T =>
    Boolean(
      agent
      && typeof agent === 'object'
      && isValidAgentId(agent.id)
      && agent.enabled === true,
    ));
}

export function findMentionState(value: string, caret: number): MentionState {
  if (
    typeof value !== 'string'
    || !Number.isInteger(caret)
    || caret < 0
    || caret > value.length
  ) {
    return CLOSED_MENTION;
  }

  const before = value.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]))) {
    return CLOSED_MENTION;
  }

  const query = before.slice(start + 1);
  if (/\s/.test(query)) return CLOSED_MENTION;

  return {
    open: true,
    query,
    start,
    selectedIndex: 0,
  };
}

export function filterMentionAgents(
  agents: MentionAgent[] | null | undefined,
  query: unknown,
  limit = 8,
): MentionAgent[] {
  if (!Array.isArray(agents)) return [];

  const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 8;
  if (normalizedLimit <= 0) return [];

  const normalizedQuery = normalizeQuery(query);
  return filterEnabledAgents(agents)
    .filter((agent): agent is MentionAgent => {
      if (!normalizedQuery) return true;
      return [agent.id, agent.name, agent.role, agent.department]
        .some(field => normalizeQuery(field).includes(normalizedQuery));
    })
    .slice(0, normalizedLimit);
}

export function insertMention(
  value: string,
  mention: MentionState,
  agentId: string,
): { value: string; caret: number } {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('无效的提及文本');
  }
  if (!isValidAgentId(agentId)) {
    throw new Error('无效的 Agent id');
  }

  if (
    !mention
    || typeof mention !== 'object'
    || mention.open !== true
    || typeof mention.query !== 'string'
    || /\s/.test(mention.query)
    || !Number.isInteger(mention.start)
  ) {
    throw new Error('无效的提及状态');
  }

  const end = mention.start + mention.query.length + 1;
  const current = findMentionState(value, end);
  if (
    !current.open
    || current.start !== mention.start
    || current.query !== mention.query
  ) {
    throw new Error('无效的提及状态');
  }

  const inserted = `@${agentId} `;
  return {
    value: value.slice(0, mention.start) + inserted + value.slice(end),
    caret: mention.start + inserted.length,
  };
}

export function decideMentionKeyDown(input: MentionKeyDownInput): MentionKeyDownDecision {
  if (
    !input
    || typeof input !== 'object'
    || typeof input.key !== 'string'
    || typeof input.shiftKey !== 'boolean'
    || typeof input.isComposing !== 'boolean'
    || typeof input.mentionOpen !== 'boolean'
    || !Number.isInteger(input.candidateCount)
    || input.candidateCount < 0
    || !Number.isInteger(input.selectedIndex)
  ) {
    return { action: 'none', preventDefault: false };
  }
  if (input.isComposing) return { action: 'none', preventDefault: false };
  if (input.mentionOpen && input.key === 'Escape') {
    return { action: 'close', preventDefault: true };
  }

  if (input.mentionOpen && input.candidateCount > 0) {
    const selectedIndex = Math.min(
      Math.max(input.selectedIndex, 0),
      input.candidateCount - 1,
    );
    if (input.key === 'ArrowDown') {
      return {
        action: 'move',
        selectedIndex: Math.min(selectedIndex + 1, input.candidateCount - 1),
        preventDefault: true,
      };
    }
    if (input.key === 'ArrowUp') {
      return {
        action: 'move',
        selectedIndex: Math.max(selectedIndex - 1, 0),
        preventDefault: true,
      };
    }
    if (input.key === 'Enter' || input.key === 'Tab') {
      return { action: 'select', selectedIndex, preventDefault: true };
    }
  }

  if (input.key === 'Enter' && !input.shiftKey) {
    return { action: 'send', preventDefault: true };
  }
  return { action: 'none', preventDefault: false };
}

export function applyMentionKeyDown(
  input: MentionKeyDownInput,
  handlers: MentionKeyDownHandlers,
): void {
  const decision = decideMentionKeyDown(input);
  if (decision.preventDefault) handlers.preventDefault();

  switch (decision.action) {
    case 'close':
      handlers.close();
      break;
    case 'move':
      handlers.move(decision.selectedIndex);
      break;
    case 'select':
      handlers.select(decision.selectedIndex);
      break;
    case 'send':
      handlers.send();
      break;
    case 'none':
      break;
  }
}

export function syncMentionStateForValue(
  value: unknown,
  current: MentionState,
): MentionState {
  if (typeof value !== 'string' || !current?.open) return CLOSED_MENTION;
  const end = current.start + current.query.length + 1;
  const next = findMentionState(value, end);
  return (
    next.open
    && next.start === current.start
    && next.query === current.query
  ) ? current : CLOSED_MENTION;
}

export function getActiveMentionAgents(result: unknown): MentionAgent[] {
  if (!result || typeof result !== 'object' || !('active' in result)) return [];
  return filterMentionAgents((result as { active?: MentionAgent[] }).active, '');
}

export function extractMentionIds(content: unknown): string[] {
  if (typeof content !== 'string' || content.trim() === '') return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(/(?:^|\s)@([^\s@]+)/gu)) {
    const id = match[1];
    if (!isValidAgentId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
