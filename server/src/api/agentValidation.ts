type AgentRequiredFields = {
  id?: unknown;
  department?: unknown;
  role?: unknown;
  llm?: unknown;
  executor?: unknown;
};

export function validateAgentRequiredFields(agent: AgentRequiredFields): string | undefined {
  if (!agent.id || !agent.department || !agent.role) {
    return '英文名称、部门和角色为必填项';
  }
  if (agent.executor !== 'cli' && !agent.llm) {
    return 'LLM Agent 必须选择 LLM Provider';
  }
  return undefined;
}
