import type { CompanyInfo, Project } from '../../api/client';

export interface DashboardSummary {
  agentCount: number;
  providerCount: number;
  activeProjectCount: number;
}

export function buildDashboardSummary(
  company: Partial<CompanyInfo> | null | undefined,
  projects: Project[] | null | undefined,
): DashboardSummary {
  const safeProjects = (Array.isArray(projects) ? projects : [])
    .filter((project): project is Project => !!project && typeof project === 'object');
  const activeProjects = safeProjects.filter(
    (project) => !['done', 'failed'].includes(project.status),
  );

  return {
    agentCount: Array.isArray(company?.agents) ? company.agents.length : 0,
    providerCount: Array.isArray(company?.providers) ? company.providers.length : 0,
    activeProjectCount: activeProjects.length,
  };
}
