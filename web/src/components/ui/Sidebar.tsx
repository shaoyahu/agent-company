import type { ReactNode } from 'react';
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  shortcut?: string;
}

interface SidebarProps {
  /** 顶部 logo + 品牌区 */
  brand: {
    name: string;
    icon?: ReactNode;
  };
  /** 主导航 */
  nav: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** 底部内容(项目列表 / 用户等) */
  bottom?: ReactNode;
  /** 折叠成 56px icon-only(窄屏用)— 隐藏品牌名 / 标签 / 底部区,只留 icon */
  collapsed?: boolean;
  /**
   * 用户主动 toggle 的回调(用于"手动展开/收起"按钮)。父组件应维护
   * `userToggled` 状态以脱离 viewport 自动控制。
   */
  onToggleCollapse?: () => void;
}

/**
 * 细 icon 按钮 — sidebar 内部用。设计原则:
 *   - 14×14 icon + 20×20 命中区
 *   - 默认透明背景,hover 时 surface-2 高亮
 *   - 永远显示(不只是 hover),给用户"这里能点"的 affordance
 */
function SidebarIconBtn({
  children,
  onClick,
  title,
  size = 16,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  size?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        // 球球 review 2026-08-15:点击区 22→26,icon 默认 14→16,跟新 nav 字号对齐
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 'var(--ui-radius)',
        color: 'var(--muted)',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 0.1s, color 0.1s, border-color 0.1s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.color = 'var(--text-2)';
        e.currentTarget.style.borderColor = 'var(--line)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--muted)';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <span style={{ display: 'inline-flex', width: size, height: size }}>{children}</span>
    </button>
  );
}

export function Sidebar({
  brand,
  nav,
  activeId,
  onSelect,
  bottom,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  // 球球 review 2026-08-15:"菜单按钮小+紧贴" — 整体密度上调。
  // 240 → 256 (16px 拓宽), 7px → 10px 垂直 padding, 1px → 2px 项间距, 16 → 18px icon, 13 → 14px 字号
  const w = collapsed ? 56 : 256;
  return (
    <aside
      style={{
        position: 'relative',
        width: w,
        background: 'var(--surface)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        transition: 'width 0.18s ease',
      }}
    >
      {/* 品牌区 + 展开/收起按钮 */}
      <div
        style={{
          padding: collapsed ? '18px 12px' : '18px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 10,
          minHeight: 64,
        }}
      >
        {/* 品牌 logo + 名字 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {brand.icon || (
            <div
              style={{
                width: 32,
                height: 32,
                background: 'var(--text)',
                color: 'var(--canvas)',
                borderRadius: 'var(--ui-radius)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}
            >
              AC
            </div>
          )}
          {!collapsed && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text)',
                  fontFamily: 'var(--font-display)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {brand.name}
              </div>
            </div>
          )}
        </div>

        {/* 展开态:头部右侧 PanelLeftClose;collapsed 态:不显示(底部有) */}
        {!collapsed && onToggleCollapse && (
          <SidebarIconBtn onClick={onToggleCollapse} title="收起侧边栏 (⌘B)">
            <PanelLeftClose size={16} strokeWidth={1.75} />
          </SidebarIconBtn>
        )}
      </div>

      {/* 主导航 */}
      <nav style={{ flex: 1, padding: collapsed ? '12px 8px' : '14px 12px', overflowY: 'auto' }}>
        {!collapsed && (
          <div
            style={{
              padding: '4px 12px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--subtle)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            导航 · NAV
          </div>
        )}
        {nav.map(item => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              title={item.shortcut ? `${item.label}  ·  ${item.shortcut}` : item.label}
              style={{
                width: '100%',
                textAlign: 'left',
                // 密度上调: 7px → 10px 垂直, 10px → 12px 水平, → 整体 40px 高点击区(Linear 风格)
                padding: collapsed ? '10px' : '10px 12px',
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent-2)' : 'var(--text-2)',
                border: 'none',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                borderRadius: 'var(--ui-radius)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? 0 : 12,
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                marginBottom: 'var(--ui-sidebar-gap)', // 用户可调(compact=1 / default=2 / comfortable=4)
                transition: 'background 0.1s',
                cursor: 'pointer',
                minHeight: 'var(--ui-sidebar-item-h)', // 用户可调(compact=36 / default=40 / comfortable=44)
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {item.icon && (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: active ? 'var(--accent-2)' : 'var(--muted)',
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </span>
              )}
              {!collapsed && (
                <>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  {item.shortcut && (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--faint)',
                        padding: '2px 6px',
                        background: 'var(--surface-2)',
                        borderRadius: 'var(--ui-radius)',
                        flexShrink: 0,
                      }}
                    >
                      {item.shortcut}
                    </span>
                  )}
                  {item.badge}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* bottom 区:展开态显示项目列表;collapsed 态不显示 bottom,但显示展开按钮 */}
      {!collapsed && bottom && (
        <div
          style={{
            borderTop: '1px solid var(--line)',
            padding: '12px',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {bottom}
        </div>
      )}

      {/* 底部展开按钮 — collapsed 态常驻,告诉用户"这能展开" */}
      {collapsed && onToggleCollapse && (
        <div
          style={{
            borderTop: '1px solid var(--line)',
            padding: '12px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <SidebarIconBtn onClick={onToggleCollapse} title="展开侧边栏 (⌘B)">
            <PanelLeftOpen size={16} strokeWidth={1.75} />
          </SidebarIconBtn>
        </div>
      )}

      {/* collapsed 态额外 affordance:右侧边缘 hover 时浮出"展开"小条 */}
      {/* 用 onMouseEnter/onMouseLeave 触发 hover 状态(纯 CSS 太长) */}
      {collapsed && onToggleCollapse && <ExpandHint onClick={onToggleCollapse} />}
    </aside>
  );
}

/**
 * 展开提示 — collapsed 态时在 sidebar 右侧边缘显示一个悬浮的小条,
 * hover 时高亮,点击即展开。给用户"还有东西藏着"的 affordance。
 */
function ExpandHint({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="展开侧边栏 (⌘B)"
      aria-label="展开侧边栏"
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--accent)';
        e.currentTarget.style.color = '#FFFFFF';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--faint)';
      }}
      style={{
        position: 'absolute',
        top: '50%',
        right: -10,
        transform: 'translateY(-50%)',
        width: 20,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderLeft: 'none',
        borderRadius: '0 4px 4px 0',
        color: 'var(--faint)',
        cursor: 'pointer',
        zIndex: 1,
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        ▸
      </span>
    </button>
  );
}
