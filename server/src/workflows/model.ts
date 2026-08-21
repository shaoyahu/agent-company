export type WorkflowNodeType =
  | 'start'
  | 'stage'
  | 'condition'
  | 'loop_start'
  | 'loop_end'
  | 'end';

interface WorkflowNodeBase {
  id: string;
  type: WorkflowNodeType;
  position?: { x: number; y: number };
}

export type LlmCondition = {
  type: 'llm_judgment';
  agentId: string;
  prompt: string;
  inputNodeIds: string[];
};

export type WorkflowNode =
  | (WorkflowNodeBase & { type: 'start' })
  | (WorkflowNodeBase & {
      type: 'stage';
      stage: string;
      name: string;
      description: string;
      agentId: string;
      inputNodeIds: string[];
      prompt: string;
    })
  | (WorkflowNodeBase & {
      type: 'condition';
      name: string;
      description: string;
      inputNodeIds: string[];
    })
  | (WorkflowNodeBase & {
      type: 'loop_start';
      loopId: string;
      maxIterations: 3 | 10 | 20 | 40 | 100 | null;
    })
  | (WorkflowNodeBase & {
      type: 'loop_end';
      loopId: string;
      startNodeId: string;
      name: string;
      description: string;
      inputNodeIds: string[];
      exitCondition: LlmCondition;
    })
  | (WorkflowNodeBase & { type: 'end' });

export type WorkflowCondition = LlmCondition;
export type LoopExitCondition = LlmCondition;

interface WorkflowEdgeBase {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export type WorkflowEdge =
  | (WorkflowEdgeBase & { type: 'default' })
  | (WorkflowEdgeBase & {
      type: 'condition';
      condition: LlmCondition;
    })
  | (WorkflowEdgeBase & { type: 'loop_back' });

export interface WorkflowGraph {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowConditionContext {
  output?: string;
}
