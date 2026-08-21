import { useEffect, useRef } from 'react';
import type { Agent, ConversationMessage } from '../../api/client';
import { MarkdownText } from '../../components/ui/MarkdownText';
import { getConversationSenderName } from './messageModel';

interface ConversationTimelineProps {
  messages: ConversationMessage[];
  agents: Agent[];
  loading: boolean;
  error: string | null;
}

function formatMessageTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ConversationTimeline({
  messages,
  agents,
  loading,
  error,
}: ConversationTimelineProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const ordered = [...messages].sort(
    (left, right) => left.sequence - right.sequence,
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [ordered.length]);

  if (loading) {
    return <div className="messages-timeline-state">正在加载消息...</div>;
  }
  if (error) {
    return (
      <div className="messages-timeline-state messages-state--error" role="alert">
        消息加载失败：{error}
      </div>
    );
  }
  if (ordered.length === 0) {
    return <div className="messages-timeline-state">暂无消息</div>;
  }

  return (
    <div className="messages-timeline">
      {ordered.map((message) => {
        const own = message.senderType === 'human';
        return (
          <article
            key={message.id}
            className={`messages-message${own ? ' is-own' : ''} is-${message.senderType}`}
          >
            <div className="messages-message-meta">
              <span>{getConversationSenderName(message, agents)}</span>
              <span>#{message.sequence}</span>
              <time>{formatMessageTime(message.createdAt)}</time>
            </div>
            <MarkdownText className="messages-message-content" value={message.content} />
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
