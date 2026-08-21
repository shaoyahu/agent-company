import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CompanyInfo, type Project } from './api/client';
import { AppShell } from './app/AppShell';
import { buildNavigationModel } from './app/navigation';
import { parseRoute, routePath, type AppRoute } from './app/routing';
import { AgentsView } from './components/AgentsView';
import { KanbanBoard } from './components/KanbanBoard';
import { SettingsView } from './components/SettingsView';
import { CommandPalette, type CommandItem } from './components/ui/CommandPalette';
import { ToastProvider, useToast } from './components/ui/Toast';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { MessagesPage } from './features/messages/MessagesPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { loadUISettings } from './hooks/useUISettings';
import { useWebSocket } from './hooks/useWebSocket';

const SIDEBAR_STORAGE_KEY = 'agent-company:sidebar';

interface SidebarPreference {
  userToggled: boolean;
  collapsed: boolean;
}

function readSidebarPreference(): SidebarPreference {
  if (typeof localStorage === 'undefined') {
    return { userToggled: false, collapsed: false };
  }
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return { userToggled: false, collapsed: false };
    const parsed = JSON.parse(raw) as Partial<SidebarPreference>;
    return {
      userToggled: parsed.userToggled === true,
      collapsed: parsed.collapsed === true,
    };
  } catch {
    return { userToggled: false, collapsed: false };
  }
}

function writeSidebarPreference(preference: SidebarPreference): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // 浏览器禁用存储时，当前会话仍可正常使用。
  }
}

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 840px)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 840px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return narrow;
}

function AppController() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(location.pathname));
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const initialSidebar = useMemo(() => readSidebarPreference(), []);
  const [sidebarUserToggled, setSidebarUserToggled] = useState(initialSidebar.userToggled);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebar.collapsed);
  const narrowViewport = useNarrowViewport();
  const { lastEvent, connected, connectionGeneration } = useWebSocket();
  const toast = useToast();
  const routeRef = useRef(route);
  const handledMessageToastIdsRef = useRef(new Set<string>());
  const conversationToastIdsRef = useRef(new Set<string>());

  const navigate = useCallback((next: AppRoute) => {
    const path = routePath(next);
    if (location.pathname !== path) {
      history.pushState(next, '', path);
    }
    setRoute(next);
    setMobileNavOpen(false);
  }, []);

  const refresh = useCallback(async (notify = false) => {
    try {
      const [nextCompany, nextProjects] = await Promise.all([
        api.company(),
        api.projects(),
      ]);
      setCompany(nextCompany);
      setProjects(nextProjects);
      if (notify) toast.push({ title: '数据已刷新', tone: 'ok' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      toast.push({
        title: '刷新失败',
        description: message,
        tone: 'danger',
      });
    }
  }, [toast]);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    void refresh();
    loadUISettings();
  }, [refresh]);

  useEffect(() => {
    if (route.view !== 'messages') return;
    void refresh();
  }, [refresh, route.view]);

  useEffect(() => {
    if (
      lastEvent?.type === 'project_update'
      || lastEvent?.type === 'task_update'
      || lastEvent?.type === 'message'
      || lastEvent?.type === 'provider_added'
      || lastEvent?.type === 'provider_updated'
      || lastEvent?.type === 'provider_deleted'
    ) {
      void refresh();
    }

    if (lastEvent?.type === 'message') {
      const currentRoute = routeRef.current;
      const message = lastEvent.message;
      const messageToastKey = `${lastEvent.projectId ?? message?.projectId ?? ''}:${message?.id ?? ''}`;
      const isCurrentProject = currentRoute.view === 'project'
        && currentRoute.projectId === lastEvent.projectId;
      if (!isCurrentProject && message?.fromId !== 'boss') {
        if (handledMessageToastIdsRef.current.has(messageToastKey)) return;
        handledMessageToastIdsRef.current.add(messageToastKey);
        toast.push({
          title: '收到 Agent 回复',
          description: `${message?.fromName ?? message?.fromId ?? 'Agent'}: ${String(message?.content ?? '').slice(0, 80)}`,
          tone: 'info',
        });
      }
    }

    if (lastEvent?.type === 'conversation_message') {
      const currentRoute = routeRef.current;
      const isCurrentConversation = currentRoute.view === 'messages'
        && currentRoute.conversationId === lastEvent.conversationId;
      if (
        !isCurrentConversation
        && lastEvent.message.senderType !== 'human'
        && !conversationToastIdsRef.current.has(lastEvent.message.id)
      ) {
        conversationToastIdsRef.current.add(lastEvent.message.id);
        const sender = company?.agents.find(
          (agent) => agent.id === lastEvent.message.senderId,
        );
        toast.push({
          title: '收到会话消息',
          description: `${sender?.name || lastEvent.message.senderId}: ${lastEvent.message.content.slice(0, 80)}`,
          tone: 'info',
        });
      }
    }
  }, [company?.agents, lastEvent, refresh, toast]);

  useEffect(() => {
    writeSidebarPreference({
      userToggled: sidebarUserToggled,
      collapsed: sidebarCollapsed,
    });
  }, [sidebarUserToggled, sidebarCollapsed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'b') {
        event.preventDefault();
        setSidebarUserToggled(true);
        setSidebarCollapsed((collapsed) => !collapsed);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const effectiveSidebarCollapsed = !narrowViewport
    && (sidebarUserToggled ? sidebarCollapsed : false);
  const navigation = useMemo(
    () => buildNavigationModel(projects, navigate),
    [projects, navigate],
  );
  const commandItems: CommandItem[] = useMemo(() => [
    ...navigation.primary.map((item) => ({
      id: `nav-${item.id}`,
      label: item.label,
      group: '导航',
      icon: item.icon,
      onSelect: item.onSelect,
    })),
    ...navigation.recentProjects.map((project) => ({
      id: `project-${project.id}`,
      label: project.label,
      group: '最近项目',
      keywords: [project.id, project.phase, project.status],
      onSelect: project.onSelect,
    })),
  ], [navigation]);

  const onProjectCreated = useCallback(async (
    projectId: string,
    options?: { autoStart: boolean },
  ) => {
    navigate({ view: 'project', projectId });
    if (!options?.autoStart) return;
    try {
      await api.tick(projectId);
      await refresh();
    } catch (error) {
      toast.push({
        title: '自动开始失败',
        description: error instanceof Error ? error.message : '未知错误',
        tone: 'warn',
      });
    }
  }, [navigate, refresh, toast]);

  const handleDeleteProject = useCallback(async (project: Project) => {
    try {
      await api.deleteProject(project.id);
      setProjects(prev => prev.filter(item => item.id !== project.id));
      if (route.view === 'project' && route.projectId === project.id) {
        navigate({ view: 'projects' });
      }
      toast.push({
        title: '项目记录已删除',
        description: '项目目录和文件已保留',
        tone: 'ok',
      });
      void refresh();
    } catch (error) {
      toast.push({
        title: '删除项目失败',
        description: error instanceof Error ? error.message : '未知错误',
        tone: 'danger',
      });
    }
  }, [navigate, refresh, route, toast]);

  let page;
  if (!company && route.view !== 'settings' && route.view !== 'project') {
    page = (
      <div className="page-loading" role="status">
        <span className="page-loading__dot" />
        正在加载工作空间
      </div>
    );
  } else {
    switch (route.view) {
      case 'messages':
        page = company ? (
          <MessagesPage
            agents={company.agents}
            providers={company.providers}
            conversationId={route.conversationId}
            lastEvent={lastEvent}
            connected={connected}
            connectionGeneration={connectionGeneration}
          />
        ) : null;
        break;
      case 'organization':
        page = company ? <AgentsView company={company} /> : null;
        break;
      case 'projects':
        page = (
          <ProjectsPage
            projects={projects}
            onSelectProject={(project) => navigate({
              view: 'project',
              projectId: project.id,
            })}
            onDeleteProject={handleDeleteProject}
          />
        );
        break;
      case 'settings':
        page = <SettingsView />;
        break;
      case 'project':
        page = (
          <KanbanBoard
            projectId={route.projectId}
            lastEvent={lastEvent}
            connected={connected}
          />
        );
        break;
      case 'dashboard':
      default:
        page = company ? (
          <DashboardPage
            company={company}
            projects={projects}
            onProjectCreated={onProjectCreated}
          />
        ) : null;
    }
  }

  return (
    <>
      <AppShell
        route={route}
            companyName={'Agent Company'}
        connected={connected}
        agentCount={company?.agents?.length ?? 0}
        providerCount={company?.providers?.length ?? 0}
        navigation={navigation}
        sidebarCollapsed={effectiveSidebarCollapsed}
        mobileNavOpen={mobileNavOpen}
        onToggleSidebar={() => {
          setSidebarUserToggled(true);
          setSidebarCollapsed((collapsed) => !collapsed);
        }}
        onCloseMobileNav={() => setMobileNavOpen(false)}
        onOpenCommand={() => setCommandOpen(true)}
        onRefresh={() => void refresh(true)}
      >
        {page}
      </AppShell>
      <CommandPalette
        open={commandOpen}
        items={commandItems}
        onClose={() => setCommandOpen(false)}
      />
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppController />
    </ToastProvider>
  );
}
