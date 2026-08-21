import type { ReactNode, ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

const variants: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--on-solid)', border: '1px solid var(--accent)' },
  secondary: { background: 'var(--surface)', color: 'var(--text-2)', border: '1px solid var(--line)' },
  ghost: { background: 'transparent', color: 'var(--muted)', border: '1px solid transparent' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger-line)' },
  dark: { background: 'var(--text)', color: 'var(--canvas)', border: '1px solid var(--text)' },
};

// 球球 review 2026-08-15:全站密度上调。sm 26→30, md 32→36, lg 38→42, fontSize 12→13/13→14/14→15
// 球球 2026-08-15:界面设置 - 高度用 var(--ui-control-h-*) 让密度档位能控制
const sizes: Record<Size, { padding: string; fontSize: number; height: string; gap: number }> = {
  sm: { padding: '0 10px', fontSize: 13, height: 'var(--ui-control-h-sm)', gap: 5 },
  md: { padding: '0 14px', fontSize: 14, height: 'var(--ui-control-h-md)', gap: 7 },
  lg: { padding: '0 18px', fontSize: 15, height: '42px', gap: 9 },
};

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, loading, children, disabled, style, ...rest }: ButtonProps) {
  const s = sizes[size];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{
        ...variants[variant],
        padding: s.padding,
        fontSize: s.fontSize,
        height: s.height,
        gap: s.gap,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--ui-radius)',
        fontWeight: 500,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.5 : 1,
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {loading ? <Spinner size={s.fontSize} /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

function Spinner({ size }: { size: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        border: '1.5px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'spin 0.6s linear infinite',
        display: 'inline-block',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
