import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface SelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'size'> {
  value: string | undefined | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: 'sm' | 'md';
  error?: boolean;
  errorText?: string;
  wrapperStyle?: CSSProperties;
}

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

export function Select({
  value,
  onChange,
  options,
  placeholder,
  size = 'md',
  disabled,
  error,
  errorText,
  style,
  wrapperStyle,
  onKeyDown,
  onBlur,
  ...rest
}: SelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const menuOptions = useMemo(
    () => placeholder === undefined
      ? options
      : [{ value: '', label: placeholder }, ...options],
    [options, placeholder],
  );
  const selectedOption = options.find(option => option.value === value);
  const enabledIndexes = useMemo(
    () => menuOptions.flatMap((option, index) => option.disabled ? [] : index),
    [menuOptions],
  );
  const [activeIndex, setActiveIndex] = useState(() => {
    const selectedIndex = menuOptions.findIndex(option => option.value === value && !option.disabled);
    return selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1;
  });
  const height = size === 'sm' ? 'var(--ui-control-h-input-sm)' : 'var(--ui-control-h-input)';
  const fontSize = size === 'sm' ? 13 : 14;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = () => {
    if (disabled) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const selectedIndex = menuOptions.findIndex(option => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1);
    setMenuPosition({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
    setOpen(true);
  };

  const selectOption = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const handleViewportChange = () => close();
    const handleViewportScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportScroll, true);
    };
  }, [open]);

  const moveActive = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const currentPosition = enabledIndexes.indexOf(activeIndex);
    const nextPosition = currentPosition < 0
      ? 0
      : (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (open) moveActive(1);
      else openMenu();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (open) moveActive(-1);
      else openMenu();
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      const option = menuOptions[activeIndex];
      if (option) selectOption(option);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  };

  const menu = open && menuPosition && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        role="listbox"
        id={listboxId}
        aria-label={rest['aria-label']}
        style={{
          position: 'fixed',
          zIndex: 1000,
          top: menuPosition.top,
          left: menuPosition.left,
          width: menuPosition.width,
          maxHeight: 280,
          overflowY: 'auto',
          padding: 4,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--ui-radius)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {menuOptions.map((option, index) => {
          const selected = option.value === value;
          const active = index === activeIndex;
          return (
            <button
              key={`${option.value}:${index}`}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onClick={() => selectOption(option)}
              style={{
                width: '100%',
                minHeight: 40,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 10px',
                border: 'none',
                borderRadius: 'var(--ui-radius)',
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: option.disabled
                  ? 'var(--faint)'
                  : active ? 'var(--accent-2)' : 'var(--text)',
                cursor: option.disabled ? 'not-allowed' : 'pointer',
                font: 'inherit',
                fontSize,
                textAlign: 'left',
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{option.label}</span>
              {selected && <Check size={15} strokeWidth={2} aria-hidden="true" />}
            </button>
          );
        })}
      </div>,
      document.body,
    )
    : null;

  return (
    <div style={{ position: 'relative', width: '100%', ...wrapperStyle }}>
      <button
        {...rest}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => open ? close() : openMenu()}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        style={{
          width: '100%',
          height,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px 0 12px',
          background: disabled ? 'var(--surface-2)' : 'var(--surface)',
          color: selectedOption ? 'var(--text)' : 'var(--subtle)',
          border: `1px solid ${error ? 'var(--danger)' : open ? 'var(--accent-line)' : 'var(--line)'}`,
          borderRadius: 'var(--ui-radius)',
          fontFamily: 'inherit',
          fontSize,
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          textAlign: 'left',
          ...style,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selectedOption?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: disabled ? 'var(--faint)' : 'var(--subtle)',
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 0.12s',
          }}
        />
      </button>
      {menu}
      {errorText && (
        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{errorText}</div>
      )}
    </div>
  );
}
