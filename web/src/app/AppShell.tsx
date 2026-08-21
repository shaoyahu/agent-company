import type { ReactNode } from 'react';
import type { AppRoute } from './routing';
import type { NavigationModel } from './navigation';
import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';
import './app-shell.css';

interface AppShellProps {
  route: AppRoute;
  companyName: string;
  connected: boolean;
  agentCount: number;
  providerCount: number;
  navigation: NavigationModel;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  onToggleSidebar: () => void;
  onCloseMobileNav: () => void;
  onOpenCommand: () => void;
  onRefresh: () => void;
  children: ReactNode;
}

export function AppShell({
  route,
  companyName,
  connected,
  agentCount,
  providerCount,
  navigation,
  sidebarCollapsed,
  mobileNavOpen,
  onToggleSidebar,
  onCloseMobileNav,
  onOpenCommand,
  onRefresh,
  children,
}: AppShellProps) {
  const activeId = route.view === 'project' ? 'projects' : route.view;
  const activeProjectId = route.view === 'project' ? route.projectId : undefined;

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <AppSidebar
        companyName={companyName}
        model={navigation}
        activeId={activeId}
        activeProjectId={activeProjectId}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onToggleCollapse={onToggleSidebar}
        onCloseMobile={onCloseMobileNav}
      />
      <main className="app-main">
        <AppTopbar
          route={route}
          connected={connected}
          agentCount={agentCount}
          providerCount={providerCount}
          onOpenCommand={onOpenCommand}
          onRefresh={onRefresh}
        />
        <div className="app-content" data-view={route.view}>{children}</div>
      </main>
    </div>
  );
}
