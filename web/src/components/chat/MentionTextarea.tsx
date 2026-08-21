import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEventHandler,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import {
  applyMentionKeyDown,
  filterMentionAgents,
  findMentionState,
  insertMention,
  syncMentionStateForValue,
  type MentionAgent,
  type MentionState,
} from '../../features/chat/mentions';
import { Tag } from '../ui/Tag';
import { Textarea } from '../ui/Input';

interface MentionTextareaProps {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  agents: MentionAgent[];
  busy?: boolean;
  placeholder?: string;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
}

const CLOSED_MENTION: MentionState = {
  open: false,
  query: '',
  start: 0,
  selectedIndex: 0,
};

const ROLE_TONE: Record<string, 'accent' | 'info' | 'neutral'> = {
  head: 'accent',
  leader: 'info',
  worker: 'neutral',
};

const ROLE_LABEL: Record<string, string> = {
  head: '部长',
  leader: '组长',
  worker: '员工',
};

export function MentionTextarea({
  value,
  onChange,
  onSend,
  agents,
  busy = false,
  placeholder = '说点什么... 输入 @ 提及职员',
  onPaste,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<MentionState>(CLOSED_MENTION);
  const candidates = useMemo(
    () => mention.open ? filterMentionAgents(agents, mention.query) : [],
    [agents, mention.open, mention.query],
  );

  useEffect(() => {
    setMention(current => syncMentionStateForValue(value, current));
  }, [value]);

  const pick = (agent: MentionAgent) => {
    const next = insertMention(value, mention, agent.id);
    onChange(next.value);
    setMention(CLOSED_MENTION);
    requestAnimationFrame(() => {
      const textarea = ref.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    });
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    const caret = event.target.selectionStart ?? text.length;
    onChange(text);
    setMention(findMentionState(text, caret));
  };

  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    setMention(findMentionState(
      event.currentTarget.value,
      event.currentTarget.selectionStart ?? event.currentTarget.value.length,
    ));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const input = {
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      mentionOpen: mention.open,
      candidateCount: candidates.length,
      selectedIndex: mention.selectedIndex,
    };
    applyMentionKeyDown(input, {
      preventDefault: () => event.preventDefault(),
      close: () => setMention(CLOSED_MENTION),
      move: index => {
        setMention(current => ({
          ...current,
          selectedIndex: index,
        }));
      },
      select: index => {
        const candidate = candidates[index];
        if (candidate) pick(candidate);
      },
      send: onSend,
    });
  };

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      {mention.open && candidates.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--ui-radius)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 20,
            padding: 4,
          }}
          onMouseDown={event => event.preventDefault()}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--subtle)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '4px 8px 2px',
            }}
          >
            提及职员 · {candidates.length}
          </div>
          {candidates.map((agent, index) => {
            const active = index === mention.selectedIndex;
            const role = agent.role ?? '';
            return (
              <button
                key={agent.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(agent)}
                onMouseEnter={() => setMention(current => ({ ...current, selectedIndex: index }))}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--accent-2)' : 'var(--text-2)',
                  border: 'none',
                  borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRadius: 'var(--ui-radius)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: active ? 'var(--accent-2)' : 'var(--muted)',
                    flexShrink: 0,
                    width: 18,
                    textAlign: 'center',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {agent.avatar || '◇'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: active ? 600 : 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.name || agent.id}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--subtle)',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.department ? `${agent.id} · ${agent.department}` : agent.id}
                  </div>
                </div>
                <Tag tone={ROLE_TONE[role] ?? 'neutral'} size="xs" mono>
                  {ROLE_LABEL[role] ?? (role || '职员')}
                </Tag>
              </button>
            );
          })}
        </div>
      )}

      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        rows={2}
        mono
        disabled={busy}
      />
    </div>
  );
}
