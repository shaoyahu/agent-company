import {
  Bot,
  BriefcaseBusiness,
  Cpu,
} from 'lucide-react';
import type { CompanyInfo, Project } from '../../api/client';
import { ChatInputBox } from '../../components/dashboard/ChatInputBox';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { buildDashboardSummary } from './dashboardModel';
import './dashboard.css';

interface DashboardPageProps {
  company: CompanyInfo;
  projects: Project[];
  onProjectCreated: (id: string) => void | Promise<void>;
}

export function DashboardPage({
  company,
  projects,
  onProjectCreated,
}: DashboardPageProps) {
  const summary = buildDashboardSummary(company, projects);

  const stats = [
    {
      icon: <Bot size={16} />,
      value: summary.agentCount,
      label: '可用 Agent',
    },
    {
      icon: <Cpu size={16} />,
      value: summary.providerCount,
      label: 'LLM Provider',
    },
    {
      icon: <BriefcaseBusiness size={16} />,
      value: summary.activeProjectCount,
      label: '进行中项目',
    },
  ];

  return (
    <div className="dashboard-page">
      <div className="page-container">
        <div className="dashboard-hero-compose">
          <div className="dashboard-opening">等你好久了，现在想推进什么？</div>
          <ChatInputBox company={company} onCreated={onProjectCreated} />
        </div>

        <section className="dashboard-section">
          <SectionHeader eyebrow="OVERVIEW" title="运行概况" count={3} />
          <div className="dashboard-stats">
            {stats.map((stat) => (
              <article className="dashboard-stat" key={stat.label}>
                <div className="dashboard-stat__top">{stat.icon}</div>
                <div className="dashboard-stat__value">{stat.value}</div>
                <div className="dashboard-stat__label">{stat.label}</div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
