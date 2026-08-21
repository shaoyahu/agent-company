import { RefreshCw, Search } from 'lucide-react';
import type { AppRoute } from './routing';

interface AppTopbarProps {
  route: AppRoute;
  connected: boolean;
  agentCount: number;
  providerCount: number;
  onOpenCommand: () => void;
  onRefresh: () => void;
}

function routeTitle(route: AppRoute): string {
  switch (route.view) {
    case 'messages':
      return '消息';
    case 'organization':
      return '组织';
    case 'projects':
      return '项目';
    case 'settings':
      return '设置';
    case 'project':
      return '项目协作';
    case 'dashboard':
    default:
      return '工作台';
  }
}

function routeContext(route: AppRoute): string {
  if (route.view === 'project') return `project/${route.projectId}`;
  if (route.view === 'messages' && route.conversationId) {
    return `messages/${route.conversationId}`;
  }
  return `company/${route.view}`;
}

export function AppTopbar({
  route,
  connected,
  agentCount,
  providerCount,
  onOpenCommand,
  onRefresh,
}: AppTopbarProps) {
  return (
    <header className="app-topbar">
      <div className="app-topbar__context">
        <div className="app-topbar__title">{routeTitle(route)}</div>
        <div className="app-topbar__meta">
          <span>{routeContext(route)}</span>
          <span
            className="app-topbar__status"
            data-connected={connected}
          >
            {connected ? '● 已连接' : '○ 已断开'}
          </span>
          <span>{agentCount} Agent · {providerCount} LLM</span>
        </div>
      </div>

      <div className="app-topbar__actions">
        <button
          className="app-topbar__search"
          type="button"
          onClick={onOpenCommand}
        >
          <Search size={14} />
          <span>搜索页面和项目</span>
          <span className="app-topbar__kbd">⌘K</span>
        </button>
        <button
          className="app-topbar__icon"
          type="button"
          title="刷新数据"
          aria-label="刷新数据"
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
        </button>
      </div>
    </header>
  );
}
