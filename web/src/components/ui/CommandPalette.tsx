import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Tag } from './Tag';

export interface CommandItem {
  id: string;
  label: string;
  /** 搜索关键词 */
  keywords?: string[];
  group: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  /** 灰显(不可选) */
  disabled?: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  // 关闭时重置
  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlighted(0);
    }
  }, [open]);

  // 搜索 + 分组
  const grouped = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filtered = q
      ? items.filter(it => {
          const hay = (it.label + ' ' + (it.keywords ?? []).join(' ')).toLowerCase();
          return hay.includes(q);
        })
      : items;
    const map = new Map<string, CommandItem[]>();
    for (const it of filtered) {
      if (!map.has(it.group)) map.set(it.group, []);
      map.get(it.group)!.push(it);
    }
    return Array.from(map.entries());
  }, [items, query]);

  const flat = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // 键盘导航
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlighted(h => Math.min(h + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlighted(h => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = flat[highlighted];
        if (it && !it.disabled) {
          it.onSelect();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, flat, highlighted, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      breadcrumb={
        <>
          <Tag tone="mono" size="xs" uppercase>命令</Tag>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span style={{ color: 'var(--muted)' }}>{query || '输入关键词搜索'}</span>
        </>
      }
    >
      <div style={{ padding: 8 }}>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索命令、页面、agent..."
          style={{
            width: '100%',
            height: 40,
            padding: '0 12px',
            fontSize: 14,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--ui-radius)',
            outline: 'none',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
          }}
        />
      </div>

      <div style={{ maxHeight: 360, overflowY: 'auto', padding: '0 8px 8px' }}>
        {flat.length === 0 && (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--subtle)',
            }}
          >
            没有匹配的命令
          </div>
        )}
        {grouped.map(([group, list]) => (
          <div key={group} style={{ marginBottom: 8 }}>
            <div
              style={{
                padding: '4px 8px',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--subtle)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {group}
            </div>
            {list.map(it => {
              const flatIndex = flat.indexOf(it);
              const isActive = flatIndex === highlighted;
              return (
                <button
                  key={it.id}
                  onClick={() => { if (!it.disabled) { it.onSelect(); onClose(); } }}
                  onMouseEnter={() => setHighlighted(flatIndex)}
                  disabled={it.disabled}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    color: it.disabled ? 'var(--faint)' : 'var(--text-2)',
                    border: 'none',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    borderRadius: 'var(--ui-radius)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: it.disabled ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                  }}
                >
                  {it.icon && <span style={{ opacity: 0.7 }}>{it.icon}</span>}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.label}
                  </span>
                  {it.shortcut && (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--subtle)',
                        padding: '1px 5px',
                        background: 'var(--surface-2)',
                        borderRadius: 'var(--ui-radius)',
                      }}
                    >
                      {it.shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--line)',
          background: 'var(--surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--subtle)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span>↑↓ 选择 · ⏎ 执行 · esc 关闭</span>
        <span>{flat.length} 个结果</span>
      </div>
    </Modal>
  );
}
