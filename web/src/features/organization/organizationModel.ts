export interface OrganizationDepartment {
  id?: unknown;
  parentId?: unknown;
}

export interface OrganizationAgent {
  id?: unknown;
  name?: unknown;
  department?: unknown;
  llm?: unknown;
  description?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function descendantIds(
  departments: OrganizationDepartment[],
  rootId: string,
): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const department of departments) {
      const id = text(department?.id);
      const parentId = text(department?.parentId);
      if (id && result.has(parentId) && !result.has(id)) {
        result.add(id);
        changed = true;
      }
    }
  }
  return result;
}

export function filterAgents<T extends OrganizationAgent>(
  agents: T[] | null | undefined,
  departments: OrganizationDepartment[] | null | undefined,
  query: unknown,
  departmentId: unknown,
): T[] {
  const safeAgents = (Array.isArray(agents) ? agents : [])
    .filter((agent): agent is T => !!agent && typeof agent === 'object');
  const normalizedQuery = text(query).trim().toLocaleLowerCase();
  const selectedDepartment = text(departmentId);
  const allowedDepartments = selectedDepartment
    ? descendantIds(Array.isArray(departments) ? departments : [], selectedDepartment)
    : null;

  return safeAgents.filter((agent) => {
    if (allowedDepartments && !allowedDepartments.has(text(agent.department))) {
      return false;
    }
    if (!normalizedQuery) return true;
    return [
      agent.id,
      agent.name,
      agent.description,
      agent.llm,
    ].some((value) => text(value).toLocaleLowerCase().includes(normalizedQuery));
  });
}

export function groupAgentsByDepartment<T extends OrganizationAgent>(
  agents: T[] | null | undefined,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!agent || typeof agent !== 'object') continue;
    const department = text(agent.department) || 'unknown';
    const list = grouped.get(department) ?? [];
    list.push(agent);
    grouped.set(department, list);
  }
  return grouped;
}
