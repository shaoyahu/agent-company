import type {
  Agent,
  ConversationMember,
} from '../../api/client';
import { Tag } from '../../components/ui/Tag';
import {
  isSafeSocketId,
  type ParticipantStateSnapshot,
} from './conversationEvents';
import { getParticipantStateMeta } from './messageModel';

interface ParticipantStateBarProps {
  members: ConversationMember[];
  agents: Agent[];
  participantStates: Map<string, ParticipantStateSnapshot>;
  conversationPaused: boolean;
}

export function ParticipantStateBar({
  members,
  agents,
  participantStates,
  conversationPaused,
}: ParticipantStateBarProps) {
  const agentMembers = Array.isArray(members)
    ? members.filter((member) =>
        member?.memberType === 'agent' && isSafeSocketId(member.memberId))
    : [];

  if (agentMembers.length === 0) return null;

  return (
    <div className="messages-participant-states" aria-label="Agent 运行状态">
      {agentMembers.map((member) => {
        const agent = Array.isArray(agents)
          ? agents.find((candidate) => candidate?.id === member.memberId)
          : undefined;
        const snapshot = participantStates.get(member.memberId);
        const state = conversationPaused || member.paused
          ? 'paused'
          : snapshot?.state;
        const meta = getParticipantStateMeta(state);
        return (
          <span
            key={member.memberId}
            className="messages-participant-state"
            title={agent?.name || member.memberId}
          >
            <span>{agent?.name || member.memberId}</span>
            <Tag tone={meta.tone} size="xs" dot>
              {meta.label}
            </Tag>
          </span>
        );
      })}
    </div>
  );
}
