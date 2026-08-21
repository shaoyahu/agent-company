import { useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, Users } from 'lucide-react';
import type { Agent, ConversationKind } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { filterEnabledAgents } from '../chat/mentions';
import { validateCreateConversationDraft } from './messageModel';

export type CreateConversationDraft =
  | { kind: 'direct'; agentIds: [string] }
  | {
      kind: 'group';
      title: string;
      agentIds: string[];
      schedulerMode: 'llm';
      schedulerLlm: string;
    }
  | {
      kind: 'group';
      title: string;
      agentIds: string[];
      schedulerMode: 'agent';
      schedulerAgentId: string;
    };

interface CreateConversationModalProps {
  open: boolean;
  kind: ConversationKind;
  agents: Agent[];
  providers: Array<{ id: string; type: string; model: string }>;
  submitting: boolean;
  onClose(): void;
  onSubmit(draft: CreateConversationDraft): void;
}

export function CreateConversationModal({
  open,
  kind,
  agents,
  providers,
  submitting,
  onClose,
  onSubmit,
}: CreateConversationModalProps) {
  const [title, setTitle] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [schedulerMode, setSchedulerMode] = useState<'llm' | 'agent'>('llm');
  const [schedulerLlm, setSchedulerLlm] = useState('');
  const [schedulerAgentId, setSchedulerAgentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const availableAgents = useMemo(() => filterEnabledAgents(agents), [agents]);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setAgentIds([]);
    setSchedulerMode(providers.length > 0 ? 'llm' : 'agent');
    setSchedulerLlm(providers[0]?.id ?? '');
    setSchedulerAgentId(availableAgents[0]?.id ?? '');
    setError(null);
  }, [availableAgents, kind, open, providers]);

  const toggleAgent = (agentId: string) => {
    setError(null);
    setAgentIds((current) => {
      if (current.includes(agentId)) {
        return current.filter((id) => id !== agentId);
      }
      if (kind === 'direct') return [agentId];
      return [...current, agentId];
    });
  };

  const submit = () => {
    const schedulerSourceId = schedulerMode === 'llm' ? schedulerLlm : schedulerAgentId;
    const validation = validateCreateConversationDraft(
      kind,
      title,
      agentIds,
      kind === 'group' ? schedulerMode : undefined,
      kind === 'group' ? schedulerSourceId : undefined,
    );
    if (validation) {
      setError(validation);
      return;
    }
    if (kind === 'direct') {
      onSubmit({ kind, agentIds: [agentIds[0]!] });
      return;
    }
    if (schedulerMode === 'llm') {
      onSubmit({
        kind,
        title: title.trim(),
        agentIds,
        schedulerMode,
        schedulerLlm,
      });
      return;
    }
    onSubmit({
      kind,
      title: title.trim(),
      agentIds,
      schedulerMode,
      schedulerAgentId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={kind === 'direct' ? '新建聊天' : '新建群聊'}
      size="md"
      footer={
        <>
          <span className="messages-modal-hint">
            {kind === 'direct' ? '私聊必须正好选择一个 Agent' : '群聊至少需要两个 Agent'}
          </span>
          <div className="messages-modal-actions">
            <Button onClick={onClose} disabled={submitting}>取消</Button>
            <Button
              variant="primary"
              icon={kind === 'direct'
                ? <MessageSquarePlus size={15} />
                : <Users size={15} />}
              loading={submitting}
              onClick={submit}
            >
              创建
            </Button>
          </div>
        </>
      }
    >
      <div className="messages-modal-content">
        {kind === 'group' && (
          <Input
            label="群聊标题"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            placeholder="输入群聊标题"
          />
        )}
        <div>
          <div className="messages-field-label">
            {kind === 'direct' ? '选择一个 Agent' : '选择至少两个 Agent'}
          </div>
          <div className="messages-agent-options">
            {availableAgents.length === 0 && (
              <div className="messages-state">暂无可用 Agent</div>
            )}
            {availableAgents.map((agent) => {
              const checked = agentIds.includes(agent.id);
              return (
                <label
                  key={agent.id}
                  className={`messages-agent-option${checked ? ' is-checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAgent(agent.id)}
                  />
                  <span className="messages-agent-avatar">{agent.avatar || '◇'}</span>
                  <span className="messages-agent-info">
                    <strong>{agent.name || agent.id}</strong>
                    <small>{agent.id} · {agent.department}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {error && <div className="messages-field-error" role="alert">{error}</div>}
          {kind === 'group' && !title.trim() && (
            <div className="messages-field-note">群聊标题不能为空</div>
          )}
        </div>
        {kind === 'group' && (
          <div className="messages-scheduler-panel">
            <div className="messages-field-label">隐藏调度器</div>
            <div className="messages-scheduler-mode">
              <Button
                variant={schedulerMode === 'llm' ? 'primary' : 'ghost'}
                onClick={() => {
                  setSchedulerMode('llm');
                  setError(null);
                }}
                disabled={submitting}
              >
                调度器 LLM
              </Button>
              <Button
                variant={schedulerMode === 'agent' ? 'primary' : 'ghost'}
                onClick={() => {
                  setSchedulerMode('agent');
                  setError(null);
                }}
                disabled={submitting}
              >
                调度器 Agent
              </Button>
            </div>
            {schedulerMode === 'llm' ? (
              <Select
                value={schedulerLlm}
                onChange={(value) => {
                  setSchedulerLlm(value);
                  setError(null);
                }}
                options={providers.map((provider) => ({
                  value: provider.id,
                  label: `${provider.id} · ${provider.model}`,
                }))}
                placeholder="选择调度器 LLM"
                disabled={submitting}
              />
            ) : (
              <Select
                value={schedulerAgentId}
                onChange={(value) => {
                  setSchedulerAgentId(value);
                  setError(null);
                }}
                options={availableAgents.map((agent) => ({
                  value: agent.id,
                  label: `${agent.name || agent.id} · ${agent.department}`,
                }))}
                placeholder="选择调度器 Agent"
                disabled={submitting}
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
