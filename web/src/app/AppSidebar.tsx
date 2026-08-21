import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { NavigationModel } from './navigation';

interface AppSidebarProps {
  companyName: string;
  model: NavigationModel;
  activeId: string;
  activeProjectId?: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}

export function AppSidebar({
  companyName,
  model,
  activeId,
  activeProjectId,
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: AppSidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          className="app-sidebar-overlay"
          type="button"
          aria-label="关闭导航"
          onClick={onCloseMobile}
        />
      )}
      <aside className="app-sidebar" data-mobile-open={mobileOpen}>
        <div className="app-sidebar__brand">
            <img className="app-sidebar__mark" src="/app-icon.png" alt="" />
          <div className="app-sidebar__brand-copy">
            <div className="app-sidebar__brand-name">{companyName}</div>
            <div className="app-sidebar__brand-meta">AGENT COMPANY</div>
          </div>
            {!collapsed && (
              <button
                className="app-sidebar__collapse"
                type="button"
                title="收起侧边栏"
                aria-label="收起侧边栏"
                onClick={onToggleCollapse}
              >
                <ChevronLeft size={15} />
              </button>
            )}
          <button
              className="app-sidebar__mobile-close"
            type="button"
            aria-label="关闭导航"
            onClick={onCloseMobile}
          >
            <X size={16} />
          </button>
        </div>

        <div className="app-sidebar__body">
          <section>
            <div className="app-sidebar__section-label">工作空间</div>
            <nav className="app-sidebar__nav" aria-label="主导航">
              {model.primary.map((item) => (
                <button
                  key={item.id}
                  className="app-sidebar__nav-item"
                  type="button"
                  aria-current={activeId === item.id ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  onClick={() => {
                    item.onSelect();
                    onCloseMobile();
                  }}
                >
                  {item.icon}
                  <span className="app-sidebar__nav-label">{item.label}</span>
                </button>
              ))}
            </nav>
          </section>

          <section className="app-sidebar__projects-section">
            <div className="app-sidebar__section-label">最近项目</div>
            <div className="app-sidebar__projects">
              {model.recentProjects.length === 0 ? (
                <div className="app-sidebar__project-meta">暂无项目</div>
              ) : model.recentProjects.map((project) => (
                <button
                  key={project.id}
                  className="app-sidebar__project"
                  type="button"
                  aria-current={activeProjectId === project.id ? 'page' : undefined}
                  onClick={() => {
                    project.onSelect();
                    onCloseMobile();
                  }}
                >
                  <span className="app-sidebar__project-title">{project.label}</span>
                  <span className="app-sidebar__project-meta">
                    {project.phase} · {project.status}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
          {collapsed && (
            <div className="app-sidebar__expand-footer">
              <button
                className="app-sidebar__collapse"
                type="button"
                title="展开侧边栏"
                aria-label="展开侧边栏"
                onClick={onToggleCollapse}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
      </aside>
    </>
  );
}
