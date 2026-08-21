import {
  BriefcaseBusiness,
  Building2,
  LayoutDashboard,
  MessageSquare,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project } from '../api/client';
import type { AppRoute } from './routing';

export interface PrimaryNavigationItem {
  id: 'dashboard' | 'messages' | 'organization' | 'projects' | 'settings';
  label: string;
  icon: ReactNode;
  route: AppRoute;
  onSelect: () => void;
}

export interface RecentProjectItem {
  id: string;
  label: string;
  status: string;
  phase: string;
  onSelect: () => void;
}

export interface NavigationModel {
  primary: PrimaryNavigationItem[];
  recentProjects: RecentProjectItem[];
}

export function buildNavigationModel(
  projects: Project[],
  navigate: (route: AppRoute) => void,
): NavigationModel {
  const primary: PrimaryNavigationItem[] = [
    {
      id: 'dashboard',
      label: '工作台',
      icon: <LayoutDashboard size={17} strokeWidth={1.8} />,
      route: { view: 'dashboard' },
      onSelect: () => navigate({ view: 'dashboard' }),
    },
    {
      id: 'messages',
      label: '消息',
      icon: <MessageSquare size={17} strokeWidth={1.8} />,
      route: { view: 'messages' },
      onSelect: () => navigate({ view: 'messages' }),
    },
    {
      id: 'organization',
      label: '组织',
      icon: <Building2 size={17} strokeWidth={1.8} />,
      route: { view: 'organization' },
      onSelect: () => navigate({ view: 'organization' }),
    },
    {
      id: 'projects',
      label: '项目',
      icon: <BriefcaseBusiness size={17} strokeWidth={1.8} />,
      route: { view: 'projects' },
      onSelect: () => navigate({ view: 'projects' }),
    },
    {
      id: 'settings',
      label: '设置',
      icon: <Settings size={17} strokeWidth={1.8} />,
      route: { view: 'settings' },
      onSelect: () => navigate({ view: 'settings' }),
    },
  ];

  const recentProjects = [...(Array.isArray(projects) ? projects : [])]
    .sort((a, b) => {
      const bTime = Number.isFinite(b?.updatedAt) ? b.updatedAt : 0;
      const aTime = Number.isFinite(a?.updatedAt) ? a.updatedAt : 0;
      return bTime - aTime;
    })
    .slice(0, 5)
    .map((project) => {
      const id = typeof project?.id === 'string' ? project.id : '';
      return {
        id,
        label: typeof project?.title === 'string' && project.title.trim()
          ? project.title
          : '未命名项目',
        status: typeof project?.status === 'string' ? project.status : 'unknown',
        phase: typeof project?.phase === 'string' ? project.phase : 'unknown',
        onSelect: () => navigate({ view: 'project', projectId: id }),
      };
    });

  return { primary, recentProjects };
}
