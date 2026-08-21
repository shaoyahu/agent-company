import { Send } from 'lucide-react';
import type { Agent } from '../../api/client';
import { MentionTextarea } from '../../components/chat/MentionTextarea';
import { Button } from '../../components/ui/Button';

interface ConversationComposerProps {
  value: string;
  agents: Agent[];
  sending: boolean;
  disabled?: boolean;
  onChange(value: string): void;
  onSend(): void;
}

export function ConversationComposer({
  value,
  agents,
  sending,
  disabled = false,
  onChange,
  onSend,
}: ConversationComposerProps) {
  const canSend = !disabled && !sending && value.trim().length > 0;
  return (
    <div className="messages-composer">
      <MentionTextarea
        value={value}
        onChange={onChange}
        onSend={onSend}
        agents={agents}
        busy={disabled || sending}
        placeholder="输入消息，使用 @ 提及 Agent"
      />
      <Button
        variant="primary"
        icon={<Send size={16} />}
        loading={sending}
        disabled={!canSend}
        onClick={onSend}
        aria-label="发送消息"
      >
        发送
      </Button>
    </div>
  );
}
