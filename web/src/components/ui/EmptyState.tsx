import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px dashed var(--line)',
        borderRadius: 'var(--ui-radius)',
        padding: compact ? '32px 20px' : '56px 28px',
        display: 'flex',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {icon && (
          <div
            style={{
              fontSize: compact ? 24 : 36,
              marginBottom: 12,
              opacity: 0.5,
              color: 'var(--faint)',
            }}
          >
            {icon}
          </div>
        )}
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text-2)',
            marginBottom: description ? 4 : 0,
          }}
        >
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 12, color: 'var(--subtle)' }}>{description}</div>
        )}
        {action && <div style={{ marginTop: 16 }}>{action}</div>}
      </div>
    </div>
  );
}

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}

export function Skeleton({ width = '100%', height = 12, radius = 'var(--ui-radius)', style }: SkeletonProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--surface-2) 0%, var(--line) 50%, var(--surface-2) 100%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    >
      <style>{`@keyframes skeleton-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}
