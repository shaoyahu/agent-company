import {
  ImagePlus,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  type Agent,
  type ConversationDetail,
  type ParticipantState,
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { renderAgentAvatar } from '../../components/ui/renderAgentAvatar';
import { useConfirm } from '../../components/ui/useConfirm';
import { filterEnabledAgents } from '../chat/mentions';
import {
  runConversationMutation,
  type ParticipantStateSnapshot,
} from './conversationEvents';
import { getParticipantStateMeta } from './messageModel';

interface ConversationDetailsProps {
  conversation: ConversationDetail;
  agents: Agent[];
  participantStates: Map<string, ParticipantStateSnapshot>;
  onChange(conversation: ConversationDetail): void;
  onError(title: string, error: unknown): void;
  onClose(): void;
}

const AVATAR_PRESETS = ['群', '研', '产', '设', 'bot', 'briefcase', 'color:A', 'color:C'];
const MAX_AVATAR_FILE_BYTES = 512 * 1024;
const MEMBER_MENU_MULTI_HEIGHT = 78;
const MEMBER_MENU_SINGLE_HEIGHT = 44;
const MEMBER_MENU_GAP = 6;
const MEMBER_MENU_MARGIN = 12;

type MemberMenuPosition = {
  memberId: string;
  top: number;
  right: number;
};

export function ConversationDetails({
  conversation,
  agents,
  participantStates,
  onChange,
  onError,
  onClose,
}: ConversationDetailsProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [memberMenuPosition, setMemberMenuPosition] = useState<MemberMenuPosition | null>(null);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [addMemberQuery, setAddMemberQuery] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileTitle, setProfileTitle] = useState(conversation.title || '');
  const [profileAvatar, setProfileAvatar] = useState(conversation.avatar ?? '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const { confirm, dialog } = useConfirm();
  const profileDirty = profileTitle.trim() !== conversation.title
    || (profileAvatar.trim() || undefined) !== conversation.avatar;
  const agentMemberIds = new Set(
    conversation.members
      .filter((member) => member.memberType === 'agent')
      .map((member) => member.memberId),
  );
  const availableAgents = filterEnabledAgents(agents)
    .filter((agent) => !agentMemberIds.has(agent.id))
    .filter((agent) => {
      const query = addMemberQuery.trim().toLowerCase();
      if (!query) return true;
      return [
        agent.id,
        agent.name,
        agent.department,
        agent.role,
      ].some((value) => value?.toLowerCase().includes(query));
    });

  useEffect(() => {
    setProfileTitle(conversation.title || '');
    setProfileAvatar(conversation.avatar ?? '');
    setProfileError(null);
  }, [conversation.id, conversation.title, conversation.avatar]);

  const memberState = (memberId: string, paused: boolean): ParticipantState => {
    if (conversation.paused || paused) return 'paused';
    return participantStates.get(memberId)?.state ?? 'idle';
  };

  const run = async (key: string, title: string, action: () => Promise<unknown>) => {
    setBusyKey(key);
    setMemberMenuPosition(null);
    try {
      const detail = await runConversationMutation(
        action,
        () => api.conversation(conversation.id),
      );
      onChange(detail);
      setAddMembersOpen(false);
      setAddMemberQuery('');
      return true;
    } catch (error) {
      onError(title, error);
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (agent: Agent | undefined, agentId: string) => {
    setMemberMenuPosition(null);
    const accepted = await confirm({
      title: '移除群聊成员',
      message: `确定移除 ${agent?.name || agentId} 吗？`,
      confirmText: '移除',
      danger: true,
    });
    if (!accepted) return;
    await run(`remove:${agentId}`, '移除成员失败', () =>
      api.removeConversationMember(conversation.id, agentId));
  };

  const saveProfile = async () => {
    const title = profileTitle.trim();
    if (!title) {
      setProfileError('会话标题不能为空');
      return;
    }
    setProfileError(null);
    const ok = await run('profile', '保存资料失败', () =>
      api.updateConversationProfile(conversation.id, {
        title,
        avatar: profileAvatar.trim() || null,
      }));
    if (ok) setEditingProfile(false);
  };

  const readAvatarFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setProfileError('只能上传图片头像');
      return;
    }
    if (file.size > MAX_AVATAR_FILE_BYTES) {
      setProfileError('头像图片不能超过 512KB');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setProfileError('读取头像失败');
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setProfileError('读取头像失败');
        return;
      }
      setProfileAvatar(reader.result);
      setProfileError(null);
    };
    reader.readAsDataURL(file);
  };

  const toggleMemberMenu = (memberId: string, anchor: HTMLElement) => {
    setMemberMenuPosition((current) => {
      if (current?.memberId === memberId) return null;
      const rect = anchor.getBoundingClientRect();
      const menuHeight = conversation.kind === 'group'
        ? MEMBER_MENU_MULTI_HEIGHT
        : MEMBER_MENU_SINGLE_HEIGHT;
      const maxTop = window.innerHeight - menuHeight - MEMBER_MENU_MARGIN;
      const top = Math.max(
        MEMBER_MENU_MARGIN,
        Math.min(rect.bottom + MEMBER_MENU_GAP, maxTop),
      );
      const right = Math.max(
        MEMBER_MENU_MARGIN,
        window.innerWidth - rect.right,
      );
      return { memberId, top, right };
    });
  };

  const renderMemberMenu = (memberId: string, memberPaused: boolean, agent: Agent | undefined) => {
    if (memberMenuPosition?.memberId !== memberId || typeof document === 'undefined') return null;
    return createPortal(
      <div
        className="messages-member-menu-popover"
        style={{
          top: memberMenuPosition.top,
          right: memberMenuPosition.right,
        }}
      >
        <button
          type="button"
          disabled={busyKey !== null}
          onClick={() => void run(
            `pause:${memberId}`,
            memberPaused ? '恢复 Agent 失败' : '暂停 Agent 失败',
            () => memberPaused
              ? api.resumeConversationAgent(conversation.id, memberId)
              : api.pauseConversationAgent(conversation.id, memberId),
          )}
        >
          {memberPaused
            ? <Play size={13} />
            : <Pause size={13} />}
          <span>{memberPaused ? '恢复 Agent' : '暂停 Agent'}</span>
        </button>
        {conversation.kind === 'group' && (
          <button
            type="button"
            className="is-danger"
            disabled={busyKey !== null}
            onClick={() => void remove(agent, memberId)}
          >
            <UserMinus size={13} />
            <span>移出群聊</span>
          </button>
        )}
      </div>,
      document.body,
    );
  };

  return (
    <>
      <div className="messages-details-header">
        <div>
          <div className="messages-eyebrow">详情</div>
          <div className="messages-pane-title">会话详情</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<X size={14} />}
          aria-label="关闭会话详情"
          onClick={onClose}
        />
      </div>
      <div className="messages-details-content">
        <section className="messages-detail-section messages-profile-editor">
          <div className="messages-detail-section-head">
            <span>资料</span>
            {editingProfile ? (
              <span className="messages-detail-head-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyKey !== null}
                  onClick={() => {
                    setProfileTitle(conversation.title || '');
                    setProfileAvatar(conversation.avatar ?? '');
                    setProfileError(null);
                    setEditingProfile(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busyKey === 'profile'}
                  disabled={busyKey !== null || !profileDirty || !profileTitle.trim()}
                  onClick={() => void saveProfile()}
                >
                  保存资料
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyKey !== null}
                onClick={() => {
                  setProfileTitle(conversation.title || '');
                  setProfileAvatar(conversation.avatar ?? '');
                  setProfileError(null);
                  setEditingProfile(true);
                }}
              >
                编辑资料
              </Button>
            )}
          </div>
          {editingProfile ? (
            <>
              <div className="messages-profile-row">
                <span className="messages-profile-avatar">
                  {renderAgentAvatar(profileAvatar, { size: 42, fontSize: 16 })}
                </span>
                <div className="messages-profile-main">
                  <Input
                    size="sm"
                    label="标题"
                    value={profileTitle}
                    error={profileError ?? undefined}
                    onChange={(event) => {
                      setProfileTitle(event.target.value);
                      if (profileError) setProfileError(null);
                    }}
                  />
                </div>
              </div>
              <div className="messages-avatar-presets">
                {AVATAR_PRESETS.map((avatar) => (
                  <button
                    key={avatar}
                    type="button"
                    className={profileAvatar === avatar ? 'is-active' : ''}
                    disabled={busyKey !== null}
                    title={`使用头像 ${avatar}`}
                    onClick={() => {
                      setProfileAvatar(avatar);
                      setProfileError(null);
                    }}
                  >
                    {renderAgentAvatar(avatar, { size: 24, fontSize: 12 })}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busyKey !== null}
                  title="上传本地头像"
                  onClick={() => avatarFileRef.current?.click()}
                >
                  <ImagePlus size={15} />
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null || !profileAvatar}
                  title="清空头像"
                  onClick={() => setProfileAvatar('')}
                >
                  <Trash2 size={14} />
                </button>
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) readAvatarFile(file);
                  }}
                />
              </div>
            </>
          ) : (
            <div className="messages-profile-row">
              <span className="messages-profile-avatar">
                {renderAgentAvatar(conversation.avatar, { size: 42, fontSize: 16 })}
              </span>
              <div className="messages-profile-main">
                <div className="messages-detail-label">标题</div>
                <div className="messages-detail-value">{conversation.title || '未命名会话'}</div>
              </div>
            </div>
          )}
          {editingProfile && profileError && (
            <div className="messages-profile-error">{profileError}</div>
          )}
          <div className="messages-detail-meta">
            {conversation.kind === 'group' ? '群聊' : '私聊'} · {conversation.members.length} 位成员
          </div>
        </section>

        <section className="messages-detail-section">
          <div className="messages-detail-section-head">
            <span>Agent 调度</span>
            <Button
              size="sm"
              variant={conversation.paused ? 'primary' : 'secondary'}
              icon={conversation.paused ? <Play size={14} /> : <Pause size={14} />}
              loading={busyKey === 'conversation'}
              onClick={() => void run(
                'conversation',
                conversation.paused ? '恢复会话失败' : '暂停会话失败',
                () => conversation.paused
                  ? api.resumeConversation(conversation.id)
                  : api.pauseConversation(conversation.id),
              )}
            >
              {conversation.paused ? '恢复' : '暂停'}
            </Button>
          </div>
        </section>

        <section className="messages-detail-section">
          <div className="messages-detail-section-head">
            <span>成员</span>
            <span className="messages-detail-head-actions">
              <span>{conversation.members.length}</span>
              {conversation.kind === 'group' && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<UserPlus size={14} />}
                  aria-label="添加成员"
                  onClick={() => setAddMembersOpen((open) => !open)}
                />
              )}
            </span>
          </div>
          <div className="messages-member-list messages-member-list--scroll">
            {conversation.members.map((member) => {
              const agent = member.memberType === 'agent'
                ? agents.find((candidate) => candidate.id === member.memberId)
                : undefined;
              const agentMissing = member.memberType === 'agent' && !agent;
              const state = member.memberType === 'agent' && !agentMissing
                ? memberState(member.memberId, member.paused)
                : null;
              const stateMeta = getParticipantStateMeta(state);
              return (
                <div key={`${member.memberType}:${member.memberId}`} className="messages-member">
                  <span className="messages-member-avatar">
                    {member.memberType === 'human'
                      ? '我'
                      : renderAgentAvatar(agent?.avatar, { size: 28, fontSize: 13 })}
                  </span>
                  <span className="messages-member-info">
                    <strong>
                      {member.memberType === 'human'
                        ? '我'
                        : agentMissing ? 'Agent 不存在' : agent?.name || member.memberId}
                    </strong>
                    <small>
                      {member.memberType === 'human'
                        ? '会话创建者'
                        : agent?.department || member.memberId}
                    </small>
                  </span>
                  {member.memberType === 'agent' && !agentMissing && (
                    <span
                      className={`messages-member-status is-${stateMeta.tone}`}
                      title={stateMeta.label}
                    >
                      {stateMeta.label}
                    </span>
                  )}
                  {member.memberType === 'agent' && (
                    <div className="messages-member-menu">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<MoreHorizontal size={14} />}
                        aria-label="打开成员操作菜单"
                        loading={busyKey?.endsWith(`:${member.memberId}`) === true}
                        onClick={(event) => toggleMemberMenu(
                          member.memberId,
                          event.currentTarget,
                        )}
                      />
                      {renderMemberMenu(member.memberId, member.paused, agent)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {conversation.kind === 'group' && addMembersOpen && (
          <section className="messages-detail-section">
            <div className="messages-detail-section-head">
              <span>添加成员</span>
              <UserPlus size={14} />
            </div>
            <Input
              size="sm"
              icon={<Search size={13} />}
              placeholder="搜索 Agent"
              value={addMemberQuery}
              onChange={(event) => setAddMemberQuery(event.target.value)}
            />
            <div className="messages-add-member-list">
              {availableAgents.length === 0 && (
                <div className="messages-add-member-empty">没有可添加的 Agent</div>
              )}
              {availableAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void run(
                    `add:${agent.id}`,
                    '添加成员失败',
                    () => api.addConversationMember(conversation.id, agent.id),
                  )}
                >
                  <UserPlus size={13} />
                  <span>{agent.name || agent.id}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      {dialog}
    </>
  );
}
