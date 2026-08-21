type AgentEditorValue = {
  id?: unknown;
  name?: unknown;
  englishName?: unknown;
  department?: unknown;
  team?: unknown;
  role?: unknown;
  llm?: unknown;
  systemPrompt?: unknown;
  tools?: unknown;
  skills?: unknown;
  description?: unknown;
  avatar?: unknown;
  executor?: unknown;
  cliTool?: unknown;
  cliModel?: unknown;
};

type CliToolSummary = {
  name?: unknown;
};

export type CliToolSelectionNotice = {
  tone: 'warn' | 'danger';
  message: string;
};

const AGENT_ID_RE = /^[a-z0-9_-]+$/i;

export function canSaveAgentIdentity(input: { name: unknown; englishName: unknown }): boolean {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const englishName = typeof input.englishName === 'string' ? input.englishName.trim() : '';
  return name.length > 0 && AGENT_ID_RE.test(englishName);
}

export function buildAgentPayload(input: { existing: { id: string } | null; value: AgentEditorValue }) {
  const id = input.existing?.id ?? String(input.value.englishName ?? '').trim();
  const executor = input.value.executor === 'cli' ? 'cli' : 'llm';
  const payload: Record<string, unknown> = {
    ...input.value,
    id,
    name: typeof input.value.name === 'string' ? input.value.name.trim() : '',
    executor,
    llm: executor === 'cli' ? '' : input.value.llm,
  };

  delete payload.englishName;
  delete payload.team;
  return payload;
}

export function canSaveAgentEditor(
  agent: AgentEditorValue,
  cliModels: string[],
  cliModelsLoading: boolean,
): boolean {
  if (!agent.id || !agent.department || cliModelsLoading) return false;
  if (agent.executor !== 'cli') return !!agent.llm;
  return (
    typeof agent.cliTool === 'string'
    && agent.cliTool.length > 0
    && typeof agent.cliModel === 'string'
    && cliModels.includes(agent.cliModel)
  );
}

export function filterAvailableAgentTemplates<T extends { executor?: unknown; cliTool?: unknown }>(
  templates: T[],
  cliToolNames: string[],
): T[] {
  const availableCliTools = new Set(cliToolNames);
  return templates.filter(template => (
    template.executor !== 'cli'
    || (typeof template.cliTool === 'string' && availableCliTools.has(template.cliTool))
  ));
}

export function getCliToolSelectionNotice(
  cliTool: unknown,
  cliTools: CliToolSummary[],
): CliToolSelectionNotice | null {
  const selected = typeof cliTool === 'string' ? cliTool.trim() : '';
  const availableNames = new Set(
    cliTools
      .map(tool => typeof tool.name === 'string' ? tool.name : '')
      .filter(Boolean),
  );
  if (!selected) {
    return availableNames.size > 0
      ? { tone: 'warn', message: '请选择一个已配置的本机 CLI。' }
      : {
          tone: 'danger',
          message: '请先在「设置 → Tools → 添加本机 CLI」完成命令和模型探测配置，再返回选择。',
        };
  }
  if (!availableNames.has(selected)) {
    return {
      tone: 'danger',
      message: `所选 CLI「${selected}」当前不可用，请检查本机路径和模型探测配置。`,
    };
  }
  return null;
}
