import React, { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
  mono?: boolean;
  size?: 'sm' | 'md';
}

export function Input({ label, hint, error, icon, mono, size = 'md', style, ...rest }: InputProps) {
  return (
    <div>
      {label && (
        <label
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--muted)',
            marginBottom: 5,
          }}
        >
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        {icon && (
          <span
            style={{
              position: 'absolute',
              left: 10,
              top: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--subtle)',
              fontSize: 12,
              pointerEvents: 'none',
            }}
          >
            {icon}
          </span>
        )}
        <input
          {...rest}
          style={{
            width: '100%',
            // 球球 2026-08-15:界面设置 — 高度跟随密度档位
            height: size === 'sm' ? 'var(--ui-control-h-input-sm)' : 'var(--ui-control-h-input)',
            padding: icon ? '0 12px 0 32px' : '0 12px',
            fontSize: size === 'sm' ? 13 : 14,
            background: rest.disabled ? 'var(--surface-2)' : 'var(--surface)',
            color: 'var(--text)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--line)'}`,
            borderRadius: 'var(--ui-radius)',
            fontFamily: mono ? 'var(--font-mono)' : 'inherit',
            outline: 'none',
            transition: 'border-color 0.12s',
            ...style,
          }}
        />
      </div>
      {(error || hint) && (
        <div
          style={{
            fontSize: 11,
            color: error ? 'var(--danger)' : 'var(--subtle)',
            marginTop: 4,
          }}
        >
          {error || hint}
        </div>
      )}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

// 使用 plain function + displayName 以兼容老 Vite esbuild(generic 推断可能失败)
function TextareaInner(
  { label, hint, error, mono, style, ...rest }: TextareaProps,
  ref: React.ForwardedRef<HTMLTextAreaElement>,
) {
  return (
    <div>
      {label && (
        <label
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--muted)',
            marginBottom: 5,
          }}
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        {...rest}
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 14,
          background: rest.disabled ? 'var(--surface-2)' : 'var(--surface)',
          color: 'var(--text)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--line)'}`,
          borderRadius: 'var(--ui-radius)',
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          outline: 'none',
          resize: 'vertical',
          minHeight: 64,
          ...style,
        }}
      />
      {(error || hint) && (
        <div
          style={{
            fontSize: 11,
            color: error ? 'var(--danger)' : 'var(--subtle)',
            marginTop: 4,
          }}
        >
          {error || hint}
        </div>
      )}
    </div>
  );
}

export const Textarea = forwardRef(TextareaInner);
Textarea.displayName = 'Textarea';
