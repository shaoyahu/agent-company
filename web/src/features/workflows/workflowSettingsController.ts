import type {
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowWriteInput,
} from '../../api/client';
import type { WorkflowAgentOption, WorkflowProviderOption } from './WorkflowInspector';
import {
  cloneWorkflowGraph,
  createWorkflowGraph,
  validateWorkflowDraft,
} from './workflowModel';

export { createWorkflowGraph };

export interface WorkflowDraft {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  sourceId?: string;
  builtInSource?: boolean;
}

type WorkflowHistoryEntry = WorkflowDraft;

type WorkflowSource = Pick<
  WorkflowDefinition,
  'id' | 'name' | 'description' | 'graph'
>;

export interface WorkflowSettingsState {
  workflows: WorkflowDefinition[];
  providers: WorkflowProviderOption[];
  agents: WorkflowAgentOption[];
  selectedId: string;
  draft: WorkflowDraft;
  validationErrors: string[];
  loading: boolean;
  saving: boolean;
  layouting: boolean;
  revision: number;
  activeLoadToken: number;
  activeLayoutToken: number;
  activeSaveToken: number;
  canUndo: boolean;
  canRedo: boolean;
}

export type WorkflowSettingsAction =
  | { type: 'loadStarted'; token: number }
  | {
      type: 'loadSucceeded';
      token: number;
      baseRevision: number;
      workflows: WorkflowDefinition[];
      providers: WorkflowProviderOption[];
        agents: WorkflowAgentOption[];
      preferredId?: string;
    }
  | { type: 'loadFailed'; token: number }
  | { type: 'replaceDraft'; draft: WorkflowDraft; selectedId: string }
  | { type: 'updateDraft'; draft: WorkflowDraft; validationErrors: string[] }
  | { type: 'setValidationErrors'; errors: string[] }
  | { type: 'setHistoryAvailability'; canUndo: boolean; canRedo: boolean }
  | {
      type: 'layoutStarted';
      token: number;
    }
  | {
      type: 'layoutSucceeded';
      token: number;
      draftId: string;
      revision: number;
      graph: WorkflowGraph;
    }
  | { type: 'layoutFailed'; token: number }
  | { type: 'saveStarted'; token: number }
  | {
      type: 'saveSucceeded';
      token: number;
      draftId: string;
      revision: number;
      workflow: WorkflowDefinition;
    }
  | { type: 'saveFailed'; token: number }
  | { type: 'deleteSucceeded'; deletedId: string };

export interface WorkflowSettingsDependencies {
  now: () => number;
  load: () => Promise<{
    workflows: WorkflowDefinition[];
    providers: WorkflowProviderOption[];
    agents: WorkflowAgentOption[];
  }>;
  layout: (graph: WorkflowGraph) => Promise<WorkflowGraph>;
  save: (input: WorkflowWriteInput) => Promise<WorkflowDefinition>;
  delete: (id: string) => Promise<void>;
}

export interface WorkflowOperationResult {
  ok: boolean;
  title: string;
  description?: string;
}

export function createWorkflowDraft(seed = Date.now()): WorkflowDraft {
  return {
    id: `workflow-${seed}`,
    name: '新流程',
    description: '',
    graph: createWorkflowGraph(),
  };
}

export function createWorkflowCopy(
  source: WorkflowSource,
  seed = Date.now(),
): WorkflowDraft {
  return {
    id: `${source.id}-copy-${seed}`,
    name: `${source.name} 副本`,
    description: source.description ?? '',
    graph: cloneWorkflowGraph(source.graph),
    sourceId: source.id,
    builtInSource: false,
  };
}

export function workflowToDraft(
  workflow: WorkflowDefinition,
): WorkflowDraft {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? '',
    graph: cloneWorkflowGraph(workflow.graph),
    sourceId: workflow.id,
    builtInSource: workflow.builtIn,
  };
}

function snapshotDraft(draft: WorkflowDraft): WorkflowHistoryEntry {
  return { ...draft, graph: cloneWorkflowGraph(draft.graph) };
}

function graphWithoutPositions(graph: WorkflowGraph): {
  version: number;
  nodes: Array<Omit<WorkflowGraph['nodes'][number], 'position'>>;
  edges: WorkflowGraph['edges'];
} {
  return {
    version: graph.version,
    nodes: graph.nodes.map(({ position: _position, ...node }) => node),
    edges: graph.edges,
  };
}

function differsOnlyByPositions(
  current: WorkflowGraph,
  next: WorkflowGraph,
): boolean {
  return JSON.stringify(graphWithoutPositions(current))
    === JSON.stringify(graphWithoutPositions(next));
}

export function prepareWorkflowSave(draft: WorkflowDraft): {
  input?: WorkflowWriteInput;
  errors: string[];
} {
  const errors = validateWorkflowDraft(draft.graph);
  if (!draft.id.trim()) errors.unshift('流程 ID 不能为空');
  if (!draft.name.trim()) errors.unshift('流程名称不能为空');
  if (errors.length > 0) return { errors };
  return {
    input: {
      id: draft.id.trim(),
      name: draft.name.trim(),
      description: draft.description,
      graph: draft.graph,
    },
    errors: [],
  };
}

export function workflowProviderLabel(
  providerId: string,
  providers?: WorkflowProviderOption[],
): string {
  if (!providerId) return '未选择 Provider';
  const provider = providers?.find(candidate => candidate.id === providerId);
  if (!provider) return `${providerId}（Provider 不可用）`;
  return provider.model ? `${provider.id} · ${provider.model}` : provider.id;
}

export function workflowAfterDelete(
  workflows: WorkflowDefinition[],
  deletedId: string,
): WorkflowDefinition | undefined {
  return workflows.find(workflow => workflow.id !== deletedId);
}

export function createWorkflowSettingsState(seed = Date.now()): WorkflowSettingsState {
  return {
    workflows: [],
    providers: [],
    agents: [],
    selectedId: '',
    draft: createWorkflowDraft(seed),
    validationErrors: [],
    loading: true,
    saving: false,
    layouting: false,
    revision: 0,
    activeLoadToken: 0,
    activeLayoutToken: 0,
    activeSaveToken: 0,
    canUndo: false,
    canRedo: false,
  };
}

function replaceWorkflow(
  workflows: WorkflowDefinition[],
  workflow: WorkflowDefinition,
): WorkflowDefinition[] {
  const index = workflows.findIndex(candidate => candidate.id === workflow.id);
  if (index < 0) return [...workflows, workflow];
  return workflows.map((candidate, candidateIndex) => (
    candidateIndex === index ? workflow : candidate
  ));
}

export function workflowSettingsReducer(
  state: WorkflowSettingsState,
  action: WorkflowSettingsAction,
): WorkflowSettingsState {
  switch (action.type) {
    case 'loadStarted':
      return {
        ...state,
        loading: true,
        activeLoadToken: action.token,
      };
    case 'loadSucceeded': {
      if (state.activeLoadToken !== action.token) return state;
      if (state.revision !== action.baseRevision) {
        return {
          ...state,
          workflows: action.workflows,
          providers: action.providers,
          agents: action.agents,
          loading: false,
        };
      }
      const targetId = action.preferredId ?? state.selectedId;
      const target = action.workflows.find(workflow => workflow.id === targetId)
        ?? action.workflows[0];
      if (!target) {
        return {
          ...state,
          workflows: action.workflows,
          providers: action.providers,
            agents: action.agents,
          selectedId: '',
          loading: false,
        };
      }
      const draft = workflowToDraft(target);
      return {
        ...state,
        workflows: action.workflows,
        providers: action.providers,
          agents: action.agents,
        selectedId: target.id,
        draft,
        validationErrors: validateWorkflowDraft(draft.graph),
        loading: false,
        revision: state.revision + 1,
      };
    }
    case 'loadFailed':
      return state.activeLoadToken === action.token
        ? { ...state, loading: false }
        : state;
    case 'replaceDraft':
      return {
        ...state,
        selectedId: action.selectedId,
        draft: action.draft,
        validationErrors: validateWorkflowDraft(action.draft.graph),
        revision: state.revision + 1,
      };
    case 'updateDraft':
      return {
        ...state,
        draft: action.draft,
        validationErrors: action.validationErrors,
        revision: state.revision + 1,
      };
    case 'setValidationErrors':
      return { ...state, validationErrors: action.errors };
    case 'setHistoryAvailability':
      return state.canUndo === action.canUndo && state.canRedo === action.canRedo
        ? state
        : { ...state, canUndo: action.canUndo, canRedo: action.canRedo };
    case 'layoutStarted':
      return {
        ...state,
        layouting: true,
        activeLayoutToken: action.token,
        revision: state.revision + 1,
      };
    case 'layoutSucceeded':
      if (state.activeLayoutToken !== action.token) return state;
      if (
        state.draft.id !== action.draftId
        || state.revision !== action.revision
      ) {
        return { ...state, layouting: false };
      }
      return {
        ...state,
        draft: {
          ...state.draft,
          graph: cloneWorkflowGraph(action.graph),
        },
        validationErrors: validateWorkflowDraft(action.graph),
        layouting: false,
        revision: state.revision + 1,
      };
    case 'layoutFailed':
      return state.activeLayoutToken === action.token
        ? { ...state, layouting: false }
        : state;
    case 'saveStarted':
      return {
        ...state,
        saving: true,
        activeSaveToken: action.token,
      };
    case 'saveSucceeded': {
      if (state.activeSaveToken !== action.token) return state;
      const workflows = replaceWorkflow(state.workflows, action.workflow);
      if (
        state.draft.id !== action.draftId
        || state.revision !== action.revision
      ) {
        return { ...state, workflows, saving: false };
      }
      const draft = workflowToDraft(action.workflow);
      return {
        ...state,
        workflows,
        selectedId: action.workflow.id,
        draft,
        validationErrors: validateWorkflowDraft(draft.graph),
        saving: false,
        revision: state.revision + 1,
      };
    }
    case 'saveFailed':
      return state.activeSaveToken === action.token
        ? { ...state, saving: false }
        : state;
    case 'deleteSucceeded': {
      const workflows = state.workflows.filter(
        workflow => workflow.id !== action.deletedId,
      );
      if (state.draft.id !== action.deletedId) {
        return { ...state, workflows };
      }
      const target = workflows[0];
      if (!target) {
        const draft = createWorkflowDraft();
        return {
          ...state,
          workflows,
          selectedId: '',
          draft,
          validationErrors: [],
          revision: state.revision + 1,
        };
      }
      const draft = workflowToDraft(target);
      return {
        ...state,
        workflows,
        selectedId: target.id,
        draft,
        validationErrors: validateWorkflowDraft(draft.graph),
        revision: state.revision + 1,
      };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkflowSettingsController(
  dependencies: WorkflowSettingsDependencies,
) {
  const MAX_HISTORY_ENTRIES = 100;
  let state = createWorkflowSettingsState(dependencies.now());
  let nextToken = 1;
  let undoStack: WorkflowHistoryEntry[] = [];
  let redoStack: WorkflowHistoryEntry[] = [];
  const listeners = new Set<() => void>();

  const dispatch = (action: WorkflowSettingsAction): void => {
    const nextState = workflowSettingsReducer(state, action);
    if (nextState === state) return;
    state = nextState;
    for (const listener of listeners) listener();
  };

  const syncHistoryAvailability = (): void => {
    dispatch({
      type: 'setHistoryAvailability',
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    });
  };

  const clearHistory = (): void => {
    undoStack = [];
    redoStack = [];
    syncHistoryAvailability();
  };

  const recordDraftEdit = (): void => {
    undoStack.push(snapshotDraft(state.draft));
    if (undoStack.length > MAX_HISTORY_ENTRIES) undoStack.shift();
    redoStack = [];
    syncHistoryAvailability();
  };

  const ensureEditableDraft = (): WorkflowDraft => {
    if (!state.draft.builtInSource) return state.draft;
    const draft = createWorkflowCopy(state.draft, dependencies.now());
    clearHistory();
    dispatch({ type: 'replaceDraft', draft, selectedId: '' });
    return state.draft;
  };

  const controller = {
    getState: (): WorkflowSettingsState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: async (preferredId?: string): Promise<WorkflowOperationResult> => {
      const token = nextToken++;
      const baseRevision = state.revision;
      dispatch({ type: 'loadStarted', token });
      try {
        const result = await dependencies.load();
          if (
            state.activeLoadToken === token
            && state.revision === baseRevision
          ) {
            clearHistory();
          }
        dispatch({
          type: 'loadSucceeded',
          token,
          baseRevision,
          workflows: result.workflows,
          providers: result.providers,
            agents: result.agents,
          preferredId,
        });
        return { ok: true, title: '流程已加载' };
      } catch (error) {
        dispatch({ type: 'loadFailed', token });
        return {
          ok: false,
          title: '加载流程失败',
          description: errorMessage(error),
        };
      }
    },
    selectWorkflow: (id: string): WorkflowOperationResult => {
      const workflow = state.workflows.find(candidate => candidate.id === id);
      if (!workflow) {
        return { ok: false, title: '流程不存在', description: id };
      }
        clearHistory();
      dispatch({
        type: 'replaceDraft',
        draft: workflowToDraft(workflow),
        selectedId: workflow.id,
      });
      return { ok: true, title: '流程已选择' };
    },
      selectOrCreateWorkflow: (id: string): WorkflowOperationResult | void => {
        if (!id) {
          controller.createWorkflow();
          return;
        }
        return controller.selectWorkflow(id);
      },
    createWorkflow: (): void => {
        clearHistory();
      dispatch({
        type: 'replaceDraft',
        draft: createWorkflowDraft(dependencies.now()),
        selectedId: '',
      });
    },
    copyWorkflow: (): void => {
        clearHistory();
      dispatch({
        type: 'replaceDraft',
        draft: createWorkflowCopy(state.draft, dependencies.now()),
        selectedId: '',
      });
    },
    editDraft: (
      patch: Partial<Pick<WorkflowDraft, 'name' | 'description'>>,
    ): void => {
      const draft = ensureEditableDraft();
        recordDraftEdit();
      dispatch({
        type: 'updateDraft',
        draft: { ...draft, ...patch },
        validationErrors: state.validationErrors,
      });
    },
    updateGraph: (graph: WorkflowGraph): void => {
      if (differsOnlyByPositions(state.draft.graph, graph)) {
        controller.updatePositions(graph);
        return;
      }
      const draft = ensureEditableDraft();
      recordDraftEdit();
      dispatch({
        type: 'updateDraft',
        draft: { ...draft, graph: cloneWorkflowGraph(graph) },
        validationErrors: validateWorkflowDraft(graph),
      });
    },
    updatePositions: (graph: WorkflowGraph): void => {
      const draft = ensureEditableDraft();
      dispatch({
        type: 'updateDraft',
        draft: { ...draft, graph: cloneWorkflowGraph(graph) },
        validationErrors: validateWorkflowDraft(graph),
      });
    },
    autoLayout: async (): Promise<WorkflowOperationResult> => {
      const draft = ensureEditableDraft();
      const token = nextToken++;
      dispatch({ type: 'layoutStarted', token });
      const revision = state.revision;
      try {
        const graph = await dependencies.layout(cloneWorkflowGraph(draft.graph));
          if (
            state.activeLayoutToken === token
            && state.draft.id === draft.id
            && state.revision === revision
          ) {
            recordDraftEdit();
          }
        dispatch({
          type: 'layoutSucceeded',
          token,
          draftId: draft.id,
          revision,
          graph,
        });
        return { ok: true, title: '自动布局完成' };
      } catch (error) {
        dispatch({ type: 'layoutFailed', token });
        return {
          ok: false,
          title: '自动布局失败',
          description: errorMessage(error),
        };
      }
    },
      undo: (): void => {
        const previous = undoStack.pop();
        if (!previous) return;
        redoStack.push(snapshotDraft(state.draft));
        syncHistoryAvailability();
        dispatch({
          type: 'updateDraft',
          draft: previous,
          validationErrors: validateWorkflowDraft(previous.graph),
        });
      },
      redo: (): void => {
        const next = redoStack.pop();
        if (!next) return;
        undoStack.push(snapshotDraft(state.draft));
        syncHistoryAvailability();
        dispatch({
          type: 'updateDraft',
          draft: next,
          validationErrors: validateWorkflowDraft(next.graph),
        });
      },
    save: async (): Promise<WorkflowOperationResult> => {
      if (state.layouting) {
        return {
          ok: false,
          title: '自动布局进行中，请稍后保存',
        };
      }
      const draft = ensureEditableDraft();
      const prepared = prepareWorkflowSave(draft);
      if (!prepared.input) {
        dispatch({ type: 'setValidationErrors', errors: prepared.errors });
        return {
          ok: false,
          title: '流程校验失败',
          description: prepared.errors[0],
        };
      }
      const token = nextToken++;
      const revision = state.revision;
      const input = {
        ...prepared.input,
        graph: cloneWorkflowGraph(prepared.input.graph),
      };
      dispatch({ type: 'saveStarted', token });
      try {
        const saved = await dependencies.save(input);
        const savedCurrentDraft = (
          state.activeSaveToken === token
          && state.draft.id === draft.id
          && state.revision === revision
        );
        dispatch({
          type: 'saveSucceeded',
          token,
          draftId: draft.id,
          revision,
          workflow: saved,
        });
        if (savedCurrentDraft) clearHistory();
        return {
          ok: true,
          title: '流程已保存',
          description: saved.name,
        };
      } catch (error) {
        dispatch({ type: 'saveFailed', token });
        return {
          ok: false,
          title: '保存失败',
          description: errorMessage(error),
        };
      }
    },
    deleteCurrent: async (): Promise<WorkflowOperationResult> => {
      const persisted = state.workflows.find(
        workflow => workflow.id === state.draft.id,
      );
      if (!persisted) {
        return { ok: false, title: '当前流程尚未保存' };
      }
      if (persisted.builtIn) {
        return { ok: false, title: '内置流程不能删除' };
      }
      try {
        await dependencies.delete(persisted.id);
          if (state.draft.id === persisted.id) clearHistory();
        dispatch({ type: 'deleteSucceeded', deletedId: persisted.id });
        return {
          ok: true,
          title: '流程已删除',
          description: persisted.name,
        };
      } catch (error) {
        return {
          ok: false,
          title: '删除失败',
          description: errorMessage(error),
        };
      }
    },
  };

  return controller;
}

export type WorkflowSettingsController = ReturnType<
  typeof createWorkflowSettingsController
>;
