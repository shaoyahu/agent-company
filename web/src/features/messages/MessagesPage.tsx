import { Info } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  api,
  type Agent,
  type ConversationDetail,
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/useConfirm';
import { ConversationComposer } from './ConversationComposer';
import { ConversationDetails } from './ConversationDetails';
import { ConversationList } from './ConversationList';
import { ConversationTimeline } from './ConversationTimeline';
import {
  CreateConversationModal,
  type CreateConversationDraft,
} from './CreateConversationModal';
import {
  createConversationEventState,
  parseConversationSocketEvent,
  reduceConversationConnectionGeneration,
  reduceConversationEvent,
} from './conversationEvents';
import {
  mergeConversationMessage,
} from './messageModel';

interface MessagesPageProps {
  agents: Agent[];
  providers: Array<{ id: string; type: string; model: string }>;
  conversationId?: string;
  lastEvent: unknown;
  connected: boolean;
  connectionGeneration: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

export function MessagesPage({
  agents,
  providers,
  conversationId,
  lastEvent,
  connected,
  connectionGeneration,
}: MessagesPageProps) {
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [eventState, setEventState] = useState(() =>
    createConversationEventState([], []));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [createKind, setCreateKind] = useState<'direct' | 'group' | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const connectionGenerationRef = useRef(connectionGeneration);
  const {
    conversations,
    messages,
    participantStates,
  } = eventState;

  const loadConversations = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const nextConversations = await api.conversations();
      setEventState((current) => ({
        ...current,
        conversations: nextConversations,
      }));
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    setDetailsOpen(false);
    if (!conversationId) {
      setDetail(null);
      setEventState((current) => ({
        ...current,
        messages: [],
        participantStates: new Map(),
      }));
      setConversationError(null);
      return;
    }
    let active = true;
    setConversationLoading(true);
    setConversationError(null);
    setEventState((current) => ({
      ...current,
      messages: [],
      participantStates: new Map(),
      conversations: current.conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, unreadCount: 0 }
          : conversation),
    }));
    void Promise.all([
      api.conversation(conversationId),
      api.conversationMessages(conversationId),
    ]).then(([nextDetail, nextMessages]) => {
      if (!active) return;
      setDetail(nextDetail);
      setEventState((current) => {
        const mergedMessages = nextMessages.reduce(
          (merged, message) => mergeConversationMessage(merged, message),
          current.messages,
        );
        return {
          ...current,
          messages: mergedMessages,
          conversations: current.conversations.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, unreadCount: 0 }
              : conversation),
          handledMessageIds: new Set([
            ...current.handledMessageIds,
            ...mergedMessages.map((message) => message.id),
          ]),
        };
      });
      void api.markConversationRead(conversationId)
        .then((readDetail) => {
          if (!active) return;
          setDetail(readDetail);
          void loadConversations();
        })
        .catch((error) => {
          if (!active) return;
          toast.push({
            title: '标记已读失败',
            description: errorMessage(error),
            tone: 'danger',
          });
        });
    }).catch((error) => {
      if (!active) return;
      setDetail(null);
      setEventState((current) => ({ ...current, messages: [] }));
      setConversationError(errorMessage(error));
    }).finally(() => {
      if (active) setConversationLoading(false);
    });
    return () => {
      active = false;
    };
  }, [conversationId, loadConversations, toast]);

  useEffect(() => {
    const event = parseConversationSocketEvent(lastEvent);
    if (!event) return;
    setEventState((current) =>
      reduceConversationEvent(current, event, conversationId));

    if (
      event.type === 'conversation_message'
      && event.conversationId !== conversationId
    ) {
      void loadConversations();
    }
    if (
      event.type === 'conversation_message'
      && event.conversationId === conversationId
      && event.message.senderType === 'agent'
    ) {
      void api.markConversationRead(event.conversationId)
        .then((readDetail) => {
          setDetail(readDetail);
          void loadConversations();
        })
        .catch((error) => {
          toast.push({
            title: '标记已读失败',
            description: errorMessage(error),
            tone: 'danger',
          });
        });
    }
      if (event.type === 'conversation_deleted') {
        void loadConversations();
        if (event.conversationId === conversationId && conversationId) {
          setDetail(null);
          setDetailsOpen(false);
          setConversationError(null);
          history.replaceState({}, '', '/messages');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
        return;
      }
    if (event.type === 'conversation_updated') {
      void loadConversations();
      if (event.conversationId === conversationId && conversationId) {
        void api.conversation(conversationId)
          .then(setDetail)
          .catch((error) => {
            toast.push({
              title: '刷新会话失败',
              description: errorMessage(error),
              tone: 'danger',
            });
          });
      }
    }
  }, [conversationId, lastEvent, loadConversations, toast]);

  useEffect(() => {
    const previousGeneration = connectionGenerationRef.current;
    connectionGenerationRef.current = connectionGeneration;
    if (previousGeneration === connectionGeneration) return;

    setEventState((current) =>
      reduceConversationConnectionGeneration(
        current,
        previousGeneration,
        connectionGeneration,
      ).state);
    void loadConversations();
    if (!conversationId) return;

    let active = true;
    void Promise.all([
      api.conversation(conversationId),
      api.conversationMessages(conversationId),
    ]).then(([nextDetail, nextMessages]) => {
      if (!active) return;
      setDetail(nextDetail);
      setEventState((current) => {
        const mergedMessages = nextMessages.reduce(
          (merged, message) => mergeConversationMessage(merged, message),
          current.messages,
        );
        return {
          ...current,
          messages: mergedMessages,
          handledMessageIds: new Set([
            ...current.handledMessageIds,
            ...mergedMessages.map((message) => message.id),
          ]),
        };
      });
    }).catch((error) => {
      if (!active) return;
      toast.push({
        title: '重连后刷新会话失败',
        description: errorMessage(error),
        tone: 'danger',
      });
    });
    return () => {
      active = false;
    };
  }, [connectionGeneration, conversationId, loadConversations, toast]);

  const navigateConversation = (id: string) => {
    const path = `/messages/${encodeURIComponent(id)}`;
    if (location.pathname !== path) history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleCreate = async (draft: CreateConversationDraft) => {
    setCreating(true);
    try {
      const created = await api.createConversation(draft);
      setCreateKind(null);
      await loadConversations();
      navigateConversation(created.id);
    } catch (error) {
      toast.push({
        title: '创建会话失败',
        description: errorMessage(error),
        tone: 'danger',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSend = async () => {
    const content = composerValue.trim();
    if (!conversationId || !detail || conversationLoading || !content || sending) return;
    setSending(true);
    try {
      const sent = await api.sendConversationMessage(conversationId, content);
      setEventState((current) => ({
        ...current,
        messages: mergeConversationMessage(current.messages, sent),
        handledMessageIds: new Set(current.handledMessageIds).add(sent.id),
      }));
      setComposerValue('');
    } catch (error) {
      toast.push({
        title: '发送失败',
        description: errorMessage(error),
        tone: 'danger',
      });
    } finally {
      setSending(false);
    }
  };

  const mentionAgents = useMemo(() => {
    if (!detail || detail.kind === 'direct') return agents;
    const memberIds = new Set(
      detail.members
        .filter((member) => member.memberType === 'agent')
        .map((member) => member.memberId),
    );
    return agents.filter((agent) => memberIds.has(agent.id));
  }, [agents, detail]);

  const updateDetail = (next: ConversationDetail) => {
    setDetail(next);
    void loadConversations();
  };

  const handleTogglePinned = async (id: string, pinned: boolean) => {
    try {
      const next = pinned
        ? await api.unpinConversation(id)
        : await api.pinConversation(id);
      if (id === conversationId) setDetail(next);
      await loadConversations();
    } catch (error) {
      showActionError(pinned ? '取消置顶失败' : '置顶失败', error);
    }
  };

  const handleToggleMuted = async (id: string, muted: boolean) => {
    try {
      const next = muted
        ? await api.unmuteConversation(id)
        : await api.muteConversation(id);
      if (id === conversationId) setDetail(next);
      await loadConversations();
    } catch (error) {
      showActionError(muted ? '关闭免打扰失败' : '开启免打扰失败', error);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    const target = conversations.find((conversation) => conversation.id === id);
    const accepted = await confirm({
      title: '删除消息',
      message: `确定删除「${target?.title || '未命名会话'}」吗？`,
      confirmText: '删除',
      danger: true,
    });
    if (!accepted) return;
    try {
      await api.deleteConversation(id);
      if (id === conversationId) {
        history.pushState({}, '', '/messages');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      await loadConversations();
    } catch (error) {
      showActionError('删除消息失败', error);
    }
  };

  const showActionError = (title: string, error: unknown) => {
    toast.push({
      title,
      description: errorMessage(error),
      tone: 'danger',
    });
  };

  return (
    <div
      className="messages-layout"
      data-connected={connected}
      data-has-event={lastEvent != null}
    >
      <aside className="messages-list-pane">
        <ConversationList
          conversations={conversations}
          activeId={conversationId}
          loading={listLoading}
          error={listError}
          onSelect={navigateConversation}
          onCreate={setCreateKind}
          onTogglePinned={(conversation) =>
            void handleTogglePinned(conversation.id, conversation.pinned)}
          onToggleMuted={(conversation) =>
            void handleToggleMuted(conversation.id, conversation.muted)}
          onDelete={(conversation) =>
            void handleDeleteConversation(conversation.id)}
        />
      </aside>
      <main className="messages-chat-pane">
        {!conversationId ? (
          <div className="messages-empty-selection">
            <div className="messages-pane-title">请选择一个会话</div>
            <p>从左侧打开已有会话，或创建新的聊天。</p>
          </div>
        ) : (
          <>
            <header className="messages-chat-header">
              <div>
                <div className="messages-eyebrow">
                  {detail?.kind === 'group' ? '群聊' : '私聊'}
                </div>
                <div className="messages-pane-title">
                  {detail?.title || '会话'}
                </div>
              </div>
              <span className="messages-chat-header-actions">
                <span className={`messages-connection${connected ? ' is-online' : ''}`}>
                  {connected ? '实时连接' : '连接已断开'}
                </span>
                <Button
                  size="sm"
                  variant={detailsOpen ? 'primary' : 'secondary'}
                  icon={<Info size={14} />}
                  disabled={!detail}
                  aria-label="打开会话详情"
                  onClick={() => setDetailsOpen((open) => !open)}
                />
              </span>
            </header>
            <ConversationTimeline
              messages={messages}
              agents={agents}
              loading={conversationLoading}
              error={conversationError}
            />
            <ConversationComposer
              value={composerValue}
              agents={mentionAgents}
              sending={sending}
              disabled={!detail || conversationLoading}
              onChange={setComposerValue}
              onSend={() => void handleSend()}
            />
          </>
        )}
      </main>
      {detailsOpen && detail && (
        <aside className="messages-details-pane">
          <ConversationDetails
            conversation={detail}
            agents={agents}
            participantStates={participantStates}
            onChange={updateDetail}
            onError={showActionError}
            onClose={() => setDetailsOpen(false)}
          />
        </aside>
      )}
      <CreateConversationModal
        open={createKind !== null}
        kind={createKind ?? 'direct'}
        agents={agents}
        providers={providers}
        submitting={creating}
        onClose={() => setCreateKind(null)}
        onSubmit={(draft) => void handleCreate(draft)}
      />
      {confirmDialog}
    </div>
  );
}
