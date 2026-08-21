import type { AgentConfig } from '../types/company.js';
import type { WorkflowGraph } from './model.js';

export type WorkflowAgentAvailable = (agentId: string) => boolean;

export function findUnavailableWorkflowAgent(
  graph: WorkflowGraph,
  agentAvailable: WorkflowAgentAvailable,
): string | null {
  const required = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type === 'stage') required.add(node.agentId);
    if (node.type === 'loop_end') required.add(node.exitCondition.agentId);
  }
  for (const edge of graph.edges) {
    if (edge.type === 'condition') required.add(edge.condition.agentId);
  }
  for (const agentId of required) {
    if (!agentAvailable(agentId)) return `流程 Agent “${agentId}”不存在、未启用或其 LLM 不可用`;
  }
  return null;
}

export function workflowAgentAvailable(agents: AgentConfig[], llmAvailable: (llmId: string) => boolean): WorkflowAgentAvailable {
  return (agentId) => {
    const agent = agents.find(item => item.id === agentId);
    return Boolean(agent?.enabled && agent.llm && llmAvailable(agent.llm));
  };
}
