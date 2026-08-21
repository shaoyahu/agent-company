import {
  MessageSquarePlus,
  MessagesSquare,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import type { ConversationSummary } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { renderAgentAvatar } from '../../components/ui/renderAgentAvatar';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId?: string;
  loading: boolean;
  error: string | null;
  onSelect(id: string): void;
  onCreate(kind: 'direct' | 'group'): void;
  onTogglePinned(conversation: ConversationSummary): void;
  onToggleMuted(conversation: ConversationSummary): void;
  onDelete(conversation: ConversationSummary): void;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

export function ConversationList({
  conversations,
  activeId,
  loading,
  error,
  onSelect,
  onCreate,
  onTogglePinned,
  onToggleMuted,
  onDelete,
}: ConversationListProps) {
  const [menu, setMenu] = useState<{
    conversation: ConversationSummary;
    x: number;
    y: number;
  } | null>(null);

  const runMenuAction = (action: (conversation: ConversationSummary) => void) => {
    if (!menu) return;
    const conversation = menu.conversation;
    setMenu(null);
    action(conversation);
  };

  return (
    <>
      <div className="messages-list-header">
        <div>
          <div className="messages-eyebrow">会话列表</div>
          <div className="messages-pane-title">消息</div>
        </div>
        <span className="messages-count">{conversations.length}</span>
      </div>
      <div className="messages-create-actions">
        <Button
          size="sm"
          variant="secondary"
          icon={<MessageSquarePlus size={15} />}
          onClick={() => onCreate('direct')}
        >
          新建聊天
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={15} />}
          onClick={() => onCreate('group')}
        >
          新建群聊
        </Button>
      </div>
      <div className="messages-conversation-list">
        {loading && (
          <div className="messages-state" role="status">正在加载会话...</div>
        )}
        {!loading && error && (
          <div className="messages-state messages-state--error" role="alert">
            会话加载失败：{error}
          </div>
        )}
        {!loading && !error && conversations.length === 0 && (
          <div className="messages-state">
            <MessagesSquare size={22} />
            暂无会话
          </div>
        )}
        {!loading && !error && conversations.map((conversation) => {
          const unreadCount = Number.isSafeInteger(conversation.unreadCount)
            ? conversation.unreadCount
            : 0;
          const showUnread = unreadCount > 0 && !conversation.muted;
          const active = activeId === conversation.id;
          return (
            <button
              key={conversation.id}
              type="button"
              className={[
                'messages-conversation-item',
                active ? 'is-active' : '',
                conversation.pinned ? 'is-pinned' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(conversation.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  conversation,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <span className="messages-conversation-icon">
                {conversation.avatar
                  ? renderAgentAvatar(conversation.avatar, { size: 28, fontSize: 14 })
                  : conversation.kind === 'group' ? '群' : '聊'}
              </span>
              <span className="messages-conversation-main">
                <span className="messages-conversation-row">
                  <span className="messages-conversation-title">
                    {conversation.title || '未命名会话'}
                  </span>
                  {conversation.pinned && (
                    <Pin size={12} className="messages-conversation-pin" aria-label="已置顶" />
                  )}
                  <span className="messages-conversation-time">
                    {formatTime(conversation.lastMessage?.createdAt ?? conversation.updatedAt)}
                  </span>
                </span>
                <span className="messages-conversation-row">
                  <span className="messages-conversation-summary">
                    {conversation.lastMessage?.content || '暂无消息'}
                  </span>
                  {conversation.muted && (
                    <VolumeX
                      size={14}
                      className="messages-conversation-muted"
                      aria-label="免打扰"
                    />
                  )}
                  {showUnread && (
                    <span
                      className="messages-conversation-unread"
                      aria-label={`${unreadCount} 条未读消息`}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {menu && (
        <div
          className="messages-conversation-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onMouseLeave={() => setMenu(null)}
        >
          <button type="button" role="menuitem" onClick={() => runMenuAction(onTogglePinned)}>
            {menu.conversation.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            <span>{menu.conversation.pinned ? '取消置顶' : '置顶消息'}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(onToggleMuted)}>
            {menu.conversation.muted ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span>{menu.conversation.muted ? '关闭免打扰' : '消息免打扰'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => runMenuAction(onDelete)}
          >
            <Trash2 size={14} />
            <span>删除消息</span>
          </button>
        </div>
      )}
    </>
  );
}
