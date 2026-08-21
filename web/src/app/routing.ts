export type AppRoute =
  | { view: 'dashboard' }
  | { view: 'messages'; conversationId?: string }
  | { view: 'organization' }
  | { view: 'projects' }
  | { view: 'settings' }
  | { view: 'project'; projectId: string };

const DASHBOARD: AppRoute = { view: 'dashboard' };

export function parseRoute(pathname: string): AppRoute {
  if (pathname === '/' || pathname === '' || pathname === '/dashboard') return DASHBOARD;
  if (pathname === '/messages') return { view: 'messages' };
  if (pathname === '/agents') return { view: 'organization' };
  if (pathname === '/projects') return { view: 'projects' };
  if (pathname === '/settings') return { view: 'settings' };

  const messagesMatch = pathname.match(/^\/messages\/([^/]+)$/);
  if (messagesMatch) {
    try {
      const conversationId = decodeURIComponent(messagesMatch[1]);
      return conversationId
        ? { view: 'messages', conversationId }
        : DASHBOARD;
    } catch {
      return DASHBOARD;
    }
  }

  const projectMatch = pathname.match(/^\/project\/([^/]+)$/);
  if (!projectMatch) return DASHBOARD;
  try {
    const projectId = decodeURIComponent(projectMatch[1]);
    return projectId ? { view: 'project', projectId } : DASHBOARD;
  } catch {
    return DASHBOARD;
  }
}

export function routePath(route: AppRoute): string {
  switch (route.view) {
    case 'messages':
      return route.conversationId
        ? `/messages/${encodeURIComponent(route.conversationId)}`
        : '/messages';
    case 'organization':
      return '/agents';
    case 'projects':
      return '/projects';
    case 'settings':
      return '/settings';
    case 'project':
      return `/project/${encodeURIComponent(route.projectId)}`;
    case 'dashboard':
    default:
      return '/';
  }
}
