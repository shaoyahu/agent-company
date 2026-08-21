import { useState, type ReactNode } from 'react';
import { Archive, BookOpen, Brain, GitBranch, Palette, Wrench } from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import { useViewport } from './ui/useViewport';
import { LLMSettings } from './settings/LLMSettings';
import { ToolsSettings } from './settings/ToolsSettings';
import { SkillsSettings } from './settings/SkillsSettings';
import { UISettings } from './settings/UISettings';
import { WorkflowSettings } from './settings/WorkflowSettings';
import { DataSettings } from './settings/DataSettings';

type Tab = 'llm' | 'tools' | 'skills' | 'workflows' | 'ui' | 'data';

interface SettingsTab {
  id: Tab;
  label: string;
  description: string;
  icon: ReactNode;
}

const TABS: SettingsTab[] = [
  {
    id: 'llm',
    label: 'LLM Providers',
    description: '模型与 API 端点',
    icon: <Brain size={14} />,
  },
  {
    id: 'tools',
    label: 'Tools',
    description: '内置与自定义工具',
    icon: <Wrench size={14} />,
  },
  {
    id: 'skills',
    label: 'Skills',
    description: '可复用技能包',
    icon: <BookOpen size={14} />,
  },
    {
      id: 'workflows',
      label: '公司流程',
      description: '创造模式任务编排',
      icon: <GitBranch size={14} />,
    },
  {
    id: 'ui',
    label: '界面',
    description: '主题、密度与字号',
    icon: <Palette size={14} />,
  },
  {
    id: 'data',
    label: '数据',
    description: '备份、恢复与还原',
    icon: <Archive size={14} />,
  },
];

const TAB_STORAGE_KEY = 'agent-company:settings-tab';
const VALID_TABS = new Set<Tab>(TABS.map((tab) => tab.id));

function readLastTab(): Tab {
  if (typeof localStorage === 'undefined') return 'llm';
  try {
    const value = localStorage.getItem(TAB_STORAGE_KEY) as Tab | null;
    return value && VALID_TABS.has(value) ? value : 'llm';
  } catch {
    return 'llm';
  }
}

function writeLastTab(tab: Tab): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // 禁用持久化时仅保持当前会话状态。
  }
}

export function SettingsView() {
  const [tab, setTabState] = useState<Tab>(readLastTab);
  const viewport = useViewport();

  const setTab = (next: Tab) => {
    setTabState(next);
    writeLastTab(next);
  };

  return (
    <div className="settings-page">
      <PageHeader
        vp={viewport}
        breadcrumb={<><span>公司</span><span>/</span><span>设置</span></>}
        title="设置"
        description="管理 Agent 使用的模型、工具、技能和本地界面偏好"
      />

      <div className="settings-layout">
        <aside className="settings-nav" aria-label="设置分类">
          <div className="settings-nav__label">能力与偏好</div>
          {TABS.map((item) => (
            <button
              className="settings-nav__item"
              type="button"
              key={item.id}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              <span className="settings-nav__icon">{item.icon}</span>
              <span className="settings-nav__copy">
                <span className="settings-nav__title">{item.label}</span>
                <span className="settings-nav__description">{item.description}</span>
              </span>
            </button>
          ))}
        </aside>

        <div className="settings-content">
          {tab === 'llm' && <LLMSettings />}
          {tab === 'tools' && <ToolsSettings onJumpToLLM={() => setTab('llm')} />}
          {tab === 'skills' && <SkillsSettings onJumpToLLM={() => setTab('llm')} />}
          {tab === 'workflows' && <WorkflowSettings />}
          {tab === 'ui' && <UISettings />}
          {tab === 'data' && <DataSettings />}
        </div>
      </div>
    </div>
  );
}
