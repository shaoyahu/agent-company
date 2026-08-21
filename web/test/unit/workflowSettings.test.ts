import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type {
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowWriteInput,
} from '../../src/api/client.js';

const settingsSource = readFileSync(
  new URL('../../src/components/SettingsView.tsx', import.meta.url),
  'utf8',
);
const workflowSettingsSource = readFileSync(
  new URL('../../src/components/settings/WorkflowSettings.tsx', import.meta.url),
  'utf8',
);
const workflowCanvasSource = readFileSync(
  new URL('../../src/features/workflows/WorkflowCanvas.tsx', import.meta.url),
  'utf8',
);
const workflowInspectorSource = readFileSync(
  new URL('../../src/features/workflows/WorkflowInspector.tsx', import.meta.url),
  'utf8',
);
const workflowNodeSource = readFileSync(
  new URL('../../src/features/workflows/WorkflowNode.tsx', import.meta.url),
  'utf8',
);
const workflowCssSource = readFileSync(
  new URL('../../src/features/workflows/workflows.css', import.meta.url),
  'utf8',
);
const workflowEditorModalUrl = new URL(
  '../../src/features/workflows/WorkflowEditorModal.tsx',
  import.meta.url,
);
const workflowEditorModalSource = existsSync(workflowEditorModalUrl)
  ? readFileSync(workflowEditorModalUrl, 'utf8')
  : '';
const confirmSource = readFileSync(
  new URL('../../src/components/ui/useConfirm.tsx', import.meta.url),
  'utf8',
);
const chatInputBoxSource = readFileSync(
  new URL('../../src/components/dashboard/ChatInputBox.tsx', import.meta.url),
  'utf8',
);

async function settingsModule() {
  return import('../../src/components/settings/WorkflowSettings.js');
}

async function controllerModule() {
  return import('../../src/features/workflows/workflowSettingsController.js');
}

async function canvasModule() {
  return import('../../src/features/workflows/WorkflowCanvas.js');
}

async function inspectorModule() {
  return import('../../src/features/workflows/WorkflowInspector.js');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'standard',
    name: '标准流程',
    description: '内置流程',
    stages: [],
    templates: {},
    graph: {
      version: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'end', type: 'end', position: { x: 260, y: 0 } },
      ],
      edges: [
        { id: 'edge-start-end', source: 'start', target: 'end', type: 'default' },
      ],
    },
    legacyCompatible: true,
    builtIn: true,
    ...overrides,
  };
}

test('设置页包含公司流程 tab 并引用 WorkflowCanvas', () => {
  assert.match(settingsSource, /id: 'workflows'/);
  assert.match(settingsSource, /公司流程/);
  assert.match(workflowSettingsSource, /import\s+\{\s*WorkflowCanvas,?\s*\}/);
  assert.match(workflowSettingsSource, /<WorkflowCanvas/);
});

test('WorkflowSettings 订阅可注入 controller 状态', () => {
  assert.match(workflowSettingsSource, /createWorkflowSettingsController/);
  assert.match(workflowSettingsSource, /useSyncExternalStore/);
  assert.match(
    workflowSettingsSource,
    /useSyncExternalStore\(\s*controller\.subscribe,\s*controller\.getState/s,
  );
});

test('WorkflowSettings 移除 JSON textarea 和旧 JSON 文案', () => {
  assert.doesNotMatch(workflowSettingsSource, /<textarea/);
  assert.doesNotMatch(workflowSettingsSource, /编辑流程 JSON/);
  assert.doesNotMatch(workflowSettingsSource, /当前 JSON 编辑器不支持复杂流程图/);
  assert.doesNotMatch(workflowSettingsSource, /JSON\.parse/);
});

test('属性抽屉仅在 selectedElement 存在时打开', () => {
  assert.match(workflowCanvasSource, /selectedElement/);
  assert.match(
    workflowCanvasSource,
    /\{selectedElement\s*&&\s*\(\s*<WorkflowInspector/s,
  );
  assert.doesNotMatch(workflowCanvasSource, /<WorkflowInspector[^>]+open=/);
});

test('流程编辑器所有下拉使用 Select 且没有原生 select', () => {
  for (const source of [workflowSettingsSource, workflowCanvasSource, workflowInspectorSource]) {
    assert.doesNotMatch(source, /<select(?:\s|>)/);
  }
  assert.match(workflowSettingsSource, /<Select/);
  assert.match(workflowInspectorSource, /<Select/);
});

test('Inspector 边类型选项复用模型层 source、target 和单例规则', () => {
  assert.match(workflowInspectorSource, /availableWorkflowEdgeKinds/);
  assert.match(
    workflowInspectorSource,
    /availableWorkflowEdgeKinds\(\s*graph,\s*edge\.source,\s*edge\.target,\s*edge\.id/s,
  );
});

test('命令栏 Button 显式声明 type=button', () => {
  const buttons = workflowSettingsSource.match(/<Button\b[\s\S]*?>/g) ?? [];
  assert.ok(buttons.length >= 5);
  for (const button of buttons) assert.match(button, /type="button"/);
});

test('自动布局进行中禁用保存按钮', () => {
  assert.match(
    workflowSettingsSource,
    /icon=\{<Save\b[^>]*\/>\}\s*loading=\{saving\}\s*disabled=\{layouting\}/,
  );
});

test('命令栏按实际内容宽度换行，避免侧栏挤压后覆盖命令按钮', () => {
  assert.match(
    workflowCssSource,
    /\.workflow-settings\s*\{[\s\S]*?container-type:\s*inline-size/,
  );
  assert.match(
    workflowCssSource,
    /\.workflow-commandbar\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  );
  assert.match(
    workflowCssSource,
    /\.workflow-commandbar__identity\s*\{[\s\S]*?flex:\s*1 1 620px/,
  );
  assert.match(
    workflowCssSource,
    /@container\s*\(max-width:\s*620px\)[\s\S]*?\.workflow-commandbar__identity\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  );
});

test('属性面板分类文案使用中文', () => {
  assert.doesNotMatch(workflowInspectorSource, /['"](?:NODE|EDGE)['"]/);
  assert.match(workflowInspectorSource, /\{node \? '节点' : '连线'\}/);
});

test('每个流程 Handle 都提供中文可访问名称', () => {
  const handles = workflowNodeSource.match(/<Handle\b[\s\S]*?\/>/g) ?? [];
  assert.ok(handles.length >= 2);
  for (const handle of handles) assert.match(handle, /aria-label=/);
  assert.match(workflowNodeSource, /aria-description="拖动此连接点创建连线"/);
});

test('新建流程只有唯一 start/end', async () => {
  const module = await controllerModule();
  assert.equal(typeof module.createWorkflowDraft, 'function');
  const draft = module.createWorkflowDraft(1234);

  assert.equal(draft.id, 'workflow-1234');
  assert.equal(draft.graph.nodes.filter(node => node.type === 'start').length, 1);
  assert.equal(draft.graph.nodes.filter(node => node.type === 'end').length, 1);
  assert.equal(draft.graph.edges.length, 1);
});

test('加载内置流程保持只读身份且不共享 graph 引用', async () => {
  const module = await controllerModule();
  assert.equal(typeof module.workflowToDraft, 'function');
  const builtIn = workflow();
  const draft = module.workflowToDraft(builtIn);

  assert.equal(draft.id, 'standard');
  assert.equal(draft.name, '标准流程');
  assert.equal(draft.sourceId, 'standard');
  assert.equal(draft.builtInSource, true);
  assert.deepEqual(draft.graph, builtIn.graph);
  assert.notStrictEqual(draft.graph, builtIn.graph);
  assert.notStrictEqual(draft.graph.nodes, builtIn.graph.nodes);

  const custom = workflow({ id: 'custom', name: '自定义', builtIn: false });
  assert.equal(module.workflowToDraft(custom).id, 'custom');
});

test('保存前校验失败时不产生 API 入参', async () => {
  const module = await controllerModule();
  assert.equal(typeof module.prepareWorkflowSave, 'function');
  const draft = module.createWorkflowDraft(1);
  draft.graph.nodes = draft.graph.nodes.filter(node => node.type !== 'end');

  const result = module.prepareWorkflowSave(draft);
  assert.equal(result.input, undefined);
  assert.ok(result.errors.some(error => /end/.test(error)));
});

test('合法保存只发送 id/name/description/graph', async () => {
  const module = await controllerModule();
  const draft = module.createWorkflowDraft(2);
  draft.name = '交付流程';
  draft.description = '用于交付';

  assert.deepEqual(module.prepareWorkflowSave(draft), {
    input: {
      id: 'workflow-2',
      name: '交付流程',
      description: '用于交付',
      graph: draft.graph,
    },
    errors: [],
  });
});

test('删除使用自适应高度确认弹窗', () => {
  assert.match(workflowSettingsSource, /await confirm\(/);
  assert.match(confirmSource, /height="auto"/);
});

test('复制流程生成新 ID 并深拷贝图', async () => {
  const module = await controllerModule();
  assert.equal(typeof module.createWorkflowCopy, 'function');
  const source = workflow({ builtIn: false, id: 'release', name: '发布流程' });
  const copy = module.createWorkflowCopy(source, 88);

  assert.equal(copy.id, 'release-copy-88');
  assert.equal(copy.name, '发布流程 副本');
  assert.notStrictEqual(copy.graph, source.graph);
  assert.notStrictEqual(copy.graph.nodes, source.graph.nodes);
});

test('删除当前流程后选择剩余流程且不再引用已删除项', async () => {
  const module = await controllerModule();
  assert.equal(typeof module.workflowAfterDelete, 'function');
  const standard = workflow();
  const custom = workflow({ id: 'custom', name: '自定义', builtIn: false });

  assert.strictEqual(
    module.workflowAfterDelete([custom, standard], 'custom'),
    standard,
  );
  assert.equal(module.workflowAfterDelete([custom], 'custom'), undefined);
  assert.strictEqual(
    module.workflowAfterDelete([custom, standard], '__proto__'),
    custom,
  );
});

test('Provider 缺失或未知 providerId 时显示明确 fallback', async () => {
  const module = await controllerModule();
  assert.equal(typeof module.workflowProviderLabel, 'function');

  assert.equal(module.workflowProviderLabel('', []), '未选择 Provider');
  assert.equal(
    module.workflowProviderLabel('missing', undefined),
    'missing（Provider 不可用）',
  );
  assert.equal(
    module.workflowProviderLabel('known', [{ id: 'known', model: 'gpt-5' }]),
    'known · gpt-5',
  );
  assert.equal(
    module.workflowProviderLabel('__proto__', [{ id: 'known', model: 'gpt-5' }]),
    '__proto__（Provider 不可用）',
  );
});

test('空流程选择创建新草稿而不是返回流程不存在', async () => {
  const module = await controllerModule();
  const controller = module.createWorkflowSettingsController({
    now: () => 101,
    load: async () => ({ workflows: [workflow()], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  controller.selectOrCreateWorkflow('');

  assert.equal(controller.getState().selectedId, '');
  assert.equal(controller.getState().draft.id, 'workflow-101');
  assert.equal(controller.getState().draft.name, '新流程');
  assert.equal(controller.getState().canUndo, false);
  assert.equal(controller.getState().canRedo, false);
});

test('撤回重做只恢复当前流程草稿并在新编辑后清空重做', async () => {
  const module = await controllerModule();
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [workflow({ builtIn: false })], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  controller.editDraft({ name: '第一次' });
  controller.editDraft({ name: '第二次' });
  const revisionBeforeUndo = controller.getState().revision;
  controller.undo();
  assert.equal(controller.getState().draft.name, '第一次');
  assert.equal(controller.getState().canUndo, true);
  assert.equal(controller.getState().canRedo, true);
  assert.ok(controller.getState().revision > revisionBeforeUndo);

  controller.redo();
  assert.equal(controller.getState().draft.name, '第二次');
  controller.undo();
  controller.editDraft({ description: '新修改' });
  assert.equal(controller.getState().draft.name, '第一次');
  assert.equal(controller.getState().draft.description, '新修改');
  assert.equal(controller.getState().canRedo, false);
});

test('切换流程后清空历史，不允许撤回上一个流程', async () => {
  const module = await controllerModule();
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({
      workflows: [
        workflow({ builtIn: false }),
        workflow({ id: 'custom', name: '自定义', builtIn: false }),
      ],
      providers: [],
    }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();
  controller.editDraft({ name: '标准流程修改' });
  assert.equal(controller.getState().canUndo, true);

  controller.selectOrCreateWorkflow('custom');

  assert.equal(controller.getState().draft.id, 'custom');
  assert.equal(controller.getState().canUndo, false);
  assert.equal(controller.getState().canRedo, false);
  controller.undo();
  assert.equal(controller.getState().draft.id, 'custom');
  assert.equal(controller.getState().draft.name, '自定义');
});

test('历史最多保留 100 步', async () => {
  const module = await controllerModule();
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [workflow({ builtIn: false })], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  for (let index = 1; index <= 101; index += 1) {
    controller.editDraft({ name: `修改 ${index}` });
  }
  for (let index = 0; index < 100; index += 1) controller.undo();

  assert.equal(controller.getState().draft.name, '修改 1');
  assert.equal(controller.getState().canUndo, false);
});

test('保存成功后清空当前草稿的撤回和重做历史', async () => {
  const module = await controllerModule();
  const source = workflow({ builtIn: false });
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [source], providers: [] }),
    layout: async graph => graph,
    save: async input => workflow({
      id: input.id,
      name: input.name,
      description: input.description,
      graph: structuredClone(input.graph),
      builtIn: false,
    }),
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  controller.editDraft({ name: '待保存版本' });
  controller.editDraft({ name: '最新版本' });
  controller.undo();
  assert.equal(controller.getState().canUndo, true);
  assert.equal(controller.getState().canRedo, true);

  assert.equal((await controller.save()).ok, true);
  assert.equal(controller.getState().canUndo, false);
  assert.equal(controller.getState().canRedo, false);
});

test('自动布局成功写入历史，撤回提升 revision 并拒绝过期布局结果', async () => {
  const module = await controllerModule();
  const firstLayout = deferred<WorkflowGraph>();
  const secondLayout = deferred<WorkflowGraph>();
  let layoutCalls = 0;
  const source = workflow({ builtIn: false });
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [source], providers: [] }),
    layout: () => {
      layoutCalls += 1;
      return layoutCalls === 1 ? firstLayout.promise : secondLayout.promise;
    },
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  const pendingFirstLayout = controller.autoLayout();
  const firstGraph = structuredClone(source.graph);
  firstGraph.nodes[0]!.position = { x: 100, y: 100 };
  firstLayout.resolve(firstGraph);
  await pendingFirstLayout;
  assert.deepEqual(controller.getState().draft.graph, firstGraph);
  assert.equal(controller.getState().canUndo, true);

  controller.undo();
  controller.editDraft({ description: '布局前编辑' });
  const pendingSecondLayout = controller.autoLayout();
  const revisionBeforeUndo = controller.getState().revision;
  controller.undo();
  assert.ok(controller.getState().revision > revisionBeforeUndo);
  const staleGraph = structuredClone(source.graph);
  staleGraph.nodes[0]!.position = { x: 200, y: 200 };
  secondLayout.resolve(staleGraph);
  await pendingSecondLayout;

  assert.notDeepEqual(controller.getState().draft.graph, staleGraph);
});

test('流程设置下拉支持新建，命令栏提供可访问的撤回和重做图标按钮', () => {
  assert.match(workflowSettingsSource, /onChange=\{selectOrCreateWorkflow\}/);
  assert.match(workflowSettingsSource, /Undo2/);
  assert.match(workflowSettingsSource, /Redo2/);
  assert.match(workflowSettingsSource, /aria-label="撤回"/);
  assert.match(workflowSettingsSource, /title="撤回"/);
  assert.match(workflowSettingsSource, /aria-label="重做"/);
  assert.match(workflowSettingsSource, /title="重做"/);
});

test('设置页提供全屏编排入口并复用 WorkflowEditorModal', () => {
  assert.match(workflowSettingsSource, /WorkflowEditorModal/);
  assert.match(workflowSettingsSource, /aria-label="放大编排"/);
  assert.match(workflowSettingsSource, /<WorkflowEditorModal/);
});

test('全屏编辑层使用共享全尺寸 Modal 并保留 WorkflowCanvas', () => {
  assert.match(workflowEditorModalSource, /<Modal[\s\S]*?size="full"/);
  assert.match(workflowEditorModalSource, /height="viewport-90"/);
  assert.match(workflowEditorModalSource, /<WorkflowCanvas/);
  assert.match(workflowEditorModalSource, /onChange=\{onGraphChange\}/);
});

test('controller 加载并选择流程，反复选择内置流程不生成副本', async () => {
  const module = await controllerModule();
  let nowCalls = 0;
  const standard = workflow();
  const custom = workflow({ id: 'custom', name: '自定义', builtIn: false });
  const controller = module.createWorkflowSettingsController({
    now: () => {
      nowCalls += 1;
      return 1000 + nowCalls;
    },
    load: async () => ({
      workflows: [standard, custom],
      providers: [{ id: 'provider-main', model: 'gpt-5' }],
    }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });

  assert.equal(controller.getState().loading, true);
  assert.equal((await controller.load()).ok, true);
  assert.equal(controller.getState().selectedId, 'standard');
  assert.equal(controller.getState().draft.id, 'standard');
  assert.equal(controller.getState().draft.builtInSource, true);
  assert.equal(controller.getState().providers[0]?.id, 'provider-main');

  assert.equal(controller.selectWorkflow('custom').ok, true);
  assert.equal(controller.getState().draft.id, 'custom');
  assert.equal(controller.selectWorkflow('standard').ok, true);
  assert.equal(controller.getState().draft.id, 'standard');
  assert.equal(controller.selectWorkflow('standard').ok, true);
  assert.equal(controller.getState().draft.id, 'standard');
  assert.equal(nowCalls, 1);
});

test('controller 在内置流程首次实际编辑时只派生一次副本', async () => {
  const module = await controllerModule();
  let seed = 40;
  const controller = module.createWorkflowSettingsController({
    now: () => seed++,
    load: async () => ({ workflows: [workflow()], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  controller.editDraft({ name: '第一次编辑' });
  assert.equal(controller.getState().draft.id, 'standard-copy-41');
  assert.equal(controller.getState().draft.name, '第一次编辑');
  assert.equal(controller.getState().draft.builtInSource, false);
  assert.equal(controller.getState().selectedId, '');

  controller.editDraft({ description: '第二次编辑' });
  assert.equal(controller.getState().draft.id, 'standard-copy-41');
  assert.equal(controller.getState().draft.description, '第二次编辑');
});

test('拖动节点更新草稿位置但不写撤回历史', async () => {
  const controllerApi = await controllerModule();
  const canvas = await canvasModule();
  const model = await import('../../src/features/workflows/workflowModel.js');
  let nowCalls = 0;
  const controller = controllerApi.createWorkflowSettingsController({
    now: () => {
      nowCalls += 1;
      return 100 + nowCalls;
    },
    load: async () => ({ workflows: [workflow()], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();
  let positionUpdateCalls = 0;
  let graphUpdateCalls = 0;
  const updatePositions = (graph: WorkflowGraph) => {
    positionUpdateCalls += 1;
    controller.updatePositions(graph);
  };
  const updateGraph = (graph: WorkflowGraph) => {
    graphUpdateCalls += 1;
    controller.updateGraph(graph);
  };

  let flow = model.toReactFlow(controller.getState().draft.graph);
  canvas.handleWorkflowNodeChanges(
    flow.nodes,
    flow.edges,
    [{ id: 'start', type: 'position', position: { x: 123, y: 456 } }],
    updatePositions,
    updateGraph,
  );
  const derivedId = controller.getState().draft.id;

  flow = model.toReactFlow(controller.getState().draft.graph);
  canvas.handleWorkflowNodeChanges(
    flow.nodes,
    flow.edges,
    [{ id: 'end', type: 'position', position: { x: 654, y: 321 } }],
    updatePositions,
    updateGraph,
  );

  assert.equal(positionUpdateCalls, 2);
  assert.equal(graphUpdateCalls, 0);
  assert.equal(nowCalls, 2);
  assert.equal(derivedId, 'standard-copy-102');
  assert.equal(controller.getState().draft.id, derivedId);
  assert.equal(controller.getState().canUndo, false);
  assert.deepEqual(
    controller.getState().draft.graph.nodes.find(node => node.id === 'start')?.position,
    { x: 123, y: 456 },
  );
  assert.deepEqual(
    controller.getState().draft.graph.nodes.find(node => node.id === 'end')?.position,
    { x: 654, y: 321 },
  );
});

test('新增节点以当前 viewport 中心作为落点并避让已有节点', async () => {
  const canvas = await canvasModule();
  const viewport = { x: -400, y: -200, zoom: 1 };
  const position = canvas.findVisibleNodePosition([], viewport, {
    width: 800,
    height: 500,
  });

  assert.ok(position.x > 300);
  assert.ok(position.y > 150);

  const displaced = canvas.findVisibleNodePosition(
    [{ id: 'occupied', type: 'stage', position }],
    viewport,
    { width: 800, height: 500 },
  );
  assert.notDeepEqual(displaced, position);
});

test('新增节点保存 React Flow 实例并读取实时 viewport，避让搜索可越过旧固定网格', async () => {
  const canvas = await canvasModule();
  const viewport = { x: -400, y: -200, zoom: 1 };
  const canvasSize = { width: 800, height: 500 };
  const center = canvas.findVisibleNodePosition([], viewport, canvasSize);
  const occupied = Array.from({ length: 9 * 9 }, (_, index) => ({
    id: `occupied-${index}`,
    type: 'stage' as const,
    position: {
      x: center.x + ((index % 9) - 4) * 208,
      y: center.y + (Math.floor(index / 9) - 4) * 106,
    },
  }));

  const position = canvas.findVisibleNodePosition(occupied, viewport, canvasSize);

  assert.ok(
    Math.abs(position.x - center.x) > 4 * 208 || Math.abs(position.y - center.y) > 4 * 106,
  );
  assert.match(workflowCanvasSource, /const\s+flowInstanceRef\s*=\s*useRef/);
  assert.match(workflowCanvasSource, /flowInstanceRef\.current\?\.getViewport\(\)/);
  assert.match(workflowCanvasSource, /onInit=\{[^}]*flowInstanceRef\.current\s*=/);
  assert.match(workflowCanvasSource, /MAX_NODE_POSITION_SEARCH_ATTEMPTS/);
  assert.match(workflowCanvasSource, /throw new Error\('未能找到可用的节点位置'\)/);
});

test('所有 10,000 个环形候选位置均被占用时抛出中文安全上限错误', async () => {
  const canvas = await canvasModule();
  const viewport = { x: -400, y: -200, zoom: 1 };
  const canvasSize = { width: 800, height: 500 };
  const center = canvas.findVisibleNodePosition([], viewport, canvasSize);
  const occupied = [];

  for (let ring = 0; occupied.length < 10_000; ring += 1) {
    for (let row = -ring; row <= ring && occupied.length < 10_000; row += 1) {
      for (let column = -ring; column <= ring && occupied.length < 10_000; column += 1) {
        if (ring > 0 && Math.abs(row) !== ring && Math.abs(column) !== ring) continue;
        occupied.push({
          id: `occupied-${occupied.length}`,
          type: 'stage' as const,
          position: {
            x: center.x + column * 208,
            y: center.y + row * 106,
          },
        });
      }
    }
  }

  assert.throws(
    () => canvas.findVisibleNodePosition(occupied, viewport, canvasSize),
    /未能找到可用的节点位置/,
  );
});

test('画布工具栏使用报错图标与条件数字角标，并在左侧展开校验问题列表', () => {
  assert.match(workflowCanvasSource, /aria-label="添加节点"/);
  assert.match(workflowCanvasSource, /workflow-node-menu/);
  assert.match(workflowCanvasSource, /aria-label="查看校验问题"/);
  assert.match(workflowCanvasSource, /TriangleAlert/);
  assert.match(workflowCanvasSource, /<span>报错<\/span>/);
  assert.match(workflowCanvasSource, /errors\.length > 0 &&/);
  assert.match(workflowCanvasSource, /workflow-validation-badge/);
  assert.match(workflowCanvasSource, /workflow-validation-panel/);
  assert.doesNotMatch(workflowCanvasSource, /workflow-errors/);
});

test('画布工具栏的选择框点击空白处会关闭', () => {
  assert.match(workflowCanvasSource, /const paletteRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(workflowCanvasSource, /document\.addEventListener\('pointerdown', handlePointerDown\)/);
  assert.match(workflowCanvasSource, /paletteRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(workflowCanvasSource, /setNodeMenuOpen\(false\)/);
  assert.match(workflowCanvasSource, /setErrorsOpen\(false\)/);
});

test('嵌入设置页的流程编辑器保持完整高度，不受属性栏内容变化影响', () => {
  const settingsCss = readFileSync(
    new URL('../../src/features/settings/settings.css', import.meta.url),
    'utf8',
  );
  const shellCss = readFileSync(
    new URL('../../src/app/app-shell.css', import.meta.url),
    'utf8',
  );
  const workflowCss = readFileSync(
    new URL('../../src/features/workflows/workflows.css', import.meta.url),
    'utf8',
  );

  assert.match(shellCss, /\.app-content\s*\{(?=[^}]*display:\s*flex)(?=[^}]*min-height:\s*0)(?=[^}]*flex-direction:\s*column)(?=[^}]*flex:\s*1)/s);
  assert.match(settingsCss, /\.settings-page\s*\{(?=[^}]*min-height:\s*0)(?=[^}]*flex:\s*1)(?=[^}]*flex-direction:\s*column)/s);
  assert.match(settingsCss, /\.settings-layout\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1/s);
  assert.match(settingsCss, /\.settings-content\s*\{(?=[^}]*min-height:\s*0)(?=[^}]*flex:\s*1)(?=[^}]*flex-direction:\s*column)/s);
  assert.match(workflowCss, /\.workflow-settings\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1[^}]*flex-direction:\s*column/s);
  assert.match(workflowCss, /\.workflow-canvas-shell\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1/s);
});

test('窄屏应用壳仍保持单列 grid 高度，流程属性内容不会压缩画布', () => {
  const shellCss = readFileSync(
    new URL('../../src/app/app-shell.css', import.meta.url),
    'utf8',
  );

  assert.match(
    shellCss,
    /@media \(max-width: 840px\) \{[\s\S]*?\.app-shell,[\s\S]*?\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
  );
  assert.doesNotMatch(
    shellCss,
    /@media \(max-width: 840px\) \{[\s\S]*?\.app-shell,[\s\S]*?\{\s*display:\s*block;/s,
  );
});

test('Canvas 连线 handler 调用 updateGraph 且内置流程只派生一次并保留首次改动', async () => {
  const controllerApi = await controllerModule();
  const canvas = await canvasModule();
  const model = await import('../../src/features/workflows/workflowModel.js');
  let nowCalls = 0;
  const source = workflow({
    graph: {
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'condition', type: 'condition' },
        { id: 'end-default', type: 'end' },
        { id: 'end-first', type: 'end' },
        { id: 'end-second', type: 'end' },
      ],
      edges: [
        { id: 'edge-start', source: 'start', target: 'condition', type: 'default' },
        { id: 'edge-default', source: 'condition', target: 'end-default', type: 'default' },
      ],
    },
  });
  const controller = controllerApi.createWorkflowSettingsController({
    now: () => {
      nowCalls += 1;
      return 200 + nowCalls;
    },
    load: async () => ({ workflows: [source], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();
  let updateCalls = 0;
  const errors: string[] = [];
  const updateGraph = (graph: WorkflowGraph) => {
    updateCalls += 1;
    controller.updateGraph(graph);
  };

  let flow = model.toReactFlow(controller.getState().draft.graph);
  canvas.handleWorkflowConnection(
    flow.nodes,
    flow.edges,
    {
      source: 'condition',
      target: 'end-first',
      sourceHandle: 'condition',
      targetHandle: null,
    },
    updateGraph,
    error => errors.push(error),
  );
  const derivedId = controller.getState().draft.id;

  flow = model.toReactFlow(controller.getState().draft.graph);
  canvas.handleWorkflowConnection(
    flow.nodes,
    flow.edges,
    {
      source: 'condition',
      target: 'end-second',
      sourceHandle: 'condition',
      targetHandle: null,
    },
    updateGraph,
    error => errors.push(error),
  );

  assert.deepEqual(errors, []);
  assert.equal(updateCalls, 2);
  assert.equal(nowCalls, 2);
  assert.equal(controller.getState().draft.id, derivedId);
  assert.ok(controller.getState().draft.graph.edges.some(edge => (
    edge.source === 'condition' && edge.target === 'end-first'
  )));
  assert.ok(controller.getState().draft.graph.edges.some(edge => (
    edge.source === 'condition' && edge.target === 'end-second'
  )));
});

test('编号条件 Handle 创建条件出口而非默认出口', async () => {
  const canvas = await import('../../src/features/workflows/WorkflowCanvas.tsx');
  const workflowModel = await import('../../src/features/workflows/workflowModel.js');
  const graph = {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'condition', type: 'condition', name: '条件', description: '', inputNodeIds: [] },
      { id: 'end', type: 'end' },
    ],
    edges: [{ id: 'start-condition', source: 'start', target: 'condition', type: 'default' }],
  } as any;
  const flow = workflowModel.toReactFlow(graph);
  let next: any;
  canvas.handleWorkflowConnection(
    flow.nodes,
    flow.edges,
    { source: 'condition', sourceHandle: 'condition-1', target: 'end', targetHandle: 'target' },
    value => { next = value; },
    error => { throw new Error(error); },
  );
  assert.equal(next.edges.at(-1)?.type, 'condition');
});

test('循环回边的选择和删除事件均被画布忽略', async () => {
  const canvas = await canvasModule();
  const model = await import('../../src/features/workflows/workflowModel.js');
  const graph: WorkflowGraph = {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'stage', type: 'stage', stage: 'dev', templates: [] },
      {
        id: 'loop',
        type: 'loop',
        targetNodeId: 'stage',
        maxIterations: 2,
        exitCondition: { type: 'stage_result', operator: 'success' },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start-stage', source: 'start', target: 'stage', type: 'default' },
      { id: 'stage-loop', source: 'stage', target: 'loop', type: 'default' },
      { id: 'loop-return', source: 'loop', target: 'stage', type: 'loop_back' },
      { id: 'loop-exit', source: 'loop', target: 'end', type: 'default' },
    ],
  };
  const flow = model.toReactFlow(graph);
  const loopBack = flow.edges.find(edge => edge.id === 'loop-return');
  assert.ok(loopBack);

  const afterDelete = canvas.applyWorkflowEdgeChanges(
    flow.edges,
    [{ id: loopBack.id, type: 'remove' }],
  );
  const afterSelect = canvas.applyWorkflowEdgeChanges(
    flow.edges,
    [{ id: loopBack.id, type: 'select', selected: true }],
  );

  assert.equal(afterDelete.length, flow.edges.length);
  assert.equal(afterDelete.find(edge => edge.id === loopBack.id)?.id, loopBack.id);
  assert.equal(afterSelect.find(edge => edge.id === loopBack.id)?.selected, loopBack.selected);
});

test('Inspector 编辑 handler 调用 updateGraph 且内置流程只派生一次并保留首次改动', async () => {
  const controllerApi = await controllerModule();
  const inspector = await inspectorModule();
  let nowCalls = 0;
  const controller = controllerApi.createWorkflowSettingsController({
    now: () => {
      nowCalls += 1;
      return 300 + nowCalls;
    },
    load: async () => ({ workflows: [workflow()], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();
  let updateCalls = 0;
  const updateGraph = (graph: WorkflowGraph) => {
    updateCalls += 1;
    controller.updateGraph(graph);
  };

  const firstStart = controller.getState().draft.graph.nodes.find(node => node.id === 'start');
  assert.ok(firstStart);
  inspector.handleWorkflowInspectorNodeChange(
    controller.getState().draft.graph,
    { ...firstStart, name: '首次编辑' },
    updateGraph,
  );
  const derivedId = controller.getState().draft.id;

  const secondStart = controller.getState().draft.graph.nodes.find(node => node.id === 'start');
  assert.ok(secondStart);
  inspector.handleWorkflowInspectorNodeChange(
    controller.getState().draft.graph,
    { ...secondStart, description: '第二次编辑' },
    updateGraph,
  );

  const savedStart = controller.getState().draft.graph.nodes.find(node => node.id === 'start');
  assert.equal(updateCalls, 2);
  assert.equal(nowCalls, 2);
  assert.equal(controller.getState().draft.id, derivedId);
  assert.equal(savedStart?.name, '首次编辑');
  assert.equal(savedStart?.description, '第二次编辑');
});

test('Inspector 更新条件出口、选中边和循环 LLM 输入后按原样进入保存契约', async () => {
  const controllerApi = await controllerModule();
  const inspector = await inspectorModule();
  const savedInputs: WorkflowWriteInput[] = [];
  const graph: WorkflowGraph = {
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'condition', type: 'condition' },
      { id: 'stage', type: 'stage', stage: 'dev', templates: [] },
      { id: 'approval', type: 'scheduler_approval', providerId: 'main', prompt: '' },
      {
        id: 'loop',
        type: 'loop',
        targetNodeId: 'stage',
        maxIterations: 3,
        inputPrompt: '',
        exitCondition: { type: 'stage_result', operator: 'success' },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start-condition', source: 'start', target: 'condition', type: 'default' },
      {
        id: 'condition-stage',
        source: 'condition',
        target: 'stage',
        type: 'condition',
        condition: { type: 'stage_result', operator: 'success' },
      },
      { id: 'condition-end', source: 'condition', target: 'end', type: 'default' },
      { id: 'stage-approval', source: 'stage', target: 'approval', type: 'default' },
      { id: 'approval-loop', source: 'approval', target: 'loop', type: 'approved' },
      { id: 'approval-end', source: 'approval', target: 'end', type: 'rejected' },
      { id: 'loop-end', source: 'loop', target: 'end', type: 'default' },
      { id: 'loop-stage', source: 'loop', target: 'stage', type: 'loop_back' },
    ],
  };
  const conditionEdge = graph.edges.find(edge => edge.id === 'condition-stage');
  const loop = graph.nodes.find(
    (node): node is Extract<WorkflowGraph['nodes'][number], { type: 'loop' }> => node.id === 'loop',
  );
  assert.ok(conditionEdge);
  assert.ok(loop);

  const afterCondition = inspector.handleWorkflowInspectorGraphChange(
    graph,
    { kind: 'edge', id: 'condition-stage' },
    {
      ...conditionEdge,
      label: '选择 LLM',
      condition: {
        type: 'llm_judgment',
        providerId: 'provider-condition',
        prompt: '判断是否进入开发',
      },
    },
  );
  assert.equal(afterCondition.edges.find(edge => edge.id === 'condition-stage')?.label, '选择 LLM');
  assert.deepEqual(
    (afterCondition.edges.find(edge => edge.id === 'condition-stage') as any)?.condition,
    {
      type: 'llm_judgment',
      providerId: 'provider-condition',
      prompt: '判断是否进入开发',
    },
  );
  assert.strictEqual(afterCondition.edges.find(edge => edge.id === 'condition-end'), graph.edges[2]);

  const afterLoop = inspector.handleWorkflowInspectorGraphChange(
    afterCondition,
    { kind: 'node', id: 'loop' },
    {
      ...loop,
      inputPrompt: '汇总本轮修改并作为下一轮输入',
      exitCondition: {
        type: 'llm_judgment',
        providerId: 'provider-loop',
        prompt: '判断当前结果是否可以退出循环',
      },
    },
  );
  const changedLoop = afterLoop.nodes.find(node => node.id === 'loop');
  assert.deepEqual(changedLoop, {
    ...loop,
    inputPrompt: '汇总本轮修改并作为下一轮输入',
    exitCondition: {
      type: 'llm_judgment',
      providerId: 'provider-loop',
      prompt: '判断当前结果是否可以退出循环',
    },
  });

  const controller = controllerApi.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [workflow({ builtIn: false, graph })], providers: [] }),
    layout: async current => current,
    save: async input => {
      savedInputs.push(input);
      return workflow({ ...input, builtIn: false });
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();
  controller.updateGraph(afterLoop);

    assert.equal((await controller.save()).ok, false);
    assert.deepEqual(savedInputs, []);
});

test('controller 丢弃切换流程或后续编辑后的陈旧自动布局结果', async () => {
  const module = await controllerModule();
  const firstLayout = deferred<WorkflowGraph>();
  const secondLayout = deferred<WorkflowGraph>();
  const standard = workflow({ builtIn: false });
  const custom = workflow({ id: 'custom', name: '自定义', builtIn: false });
  let layoutCall = 0;
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [standard, custom], providers: [] }),
    layout: () => {
      layoutCall += 1;
      return layoutCall === 1 ? firstLayout.promise : secondLayout.promise;
    },
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  const pendingFirst = controller.autoLayout();
  controller.selectWorkflow('custom');
  const staleGraph = structuredClone(standard.graph);
  staleGraph.nodes[0]!.position = { x: 999, y: 999 };
  firstLayout.resolve(staleGraph);
  await pendingFirst;
  assert.equal(controller.getState().draft.id, 'custom');
  assert.notDeepEqual(controller.getState().draft.graph, staleGraph);

  controller.selectWorkflow('standard');
  const pendingSecond = controller.autoLayout();
  controller.editDraft({ name: '布局期间编辑' });
  const secondStaleGraph = structuredClone(standard.graph);
  secondStaleGraph.nodes[0]!.position = { x: 888, y: 888 };
  secondLayout.resolve(secondStaleGraph);
  await pendingSecond;
  assert.equal(controller.getState().draft.name, '布局期间编辑');
  assert.notDeepEqual(controller.getState().draft.graph, secondStaleGraph);
});

test('controller 后发布局使早发保存只合并列表且布局结果仍可应用', async () => {
  const module = await controllerModule();
  const saveResult = deferred<WorkflowDefinition>();
  const layoutResult = deferred<WorkflowGraph>();
  const standard = workflow({ builtIn: false });
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [standard], providers: [] }),
    layout: async () => layoutResult.promise,
    save: async () => saveResult.promise,
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  controller.editDraft({ name: '本地草稿' });
  const beforeLayoutRevision = controller.getState().revision;
  const pendingSave = controller.save();
  const pendingLayout = controller.autoLayout();
  assert.equal(controller.getState().revision, beforeLayoutRevision + 1);

  const saved = workflow({
    id: 'standard',
    name: '服务端已保存',
    builtIn: false,
  });
  saved.graph.nodes[0]!.position = { x: 111, y: 111 };
  saveResult.resolve(saved);
  assert.equal((await pendingSave).ok, true);
  assert.equal(controller.getState().draft.name, '本地草稿');
  assert.notDeepEqual(controller.getState().draft.graph, saved.graph);
  assert.equal(
    controller.getState().workflows.find(item => item.id === 'standard')?.name,
    '服务端已保存',
  );

  const laidOut = structuredClone(standard.graph);
  laidOut.nodes[0]!.position = { x: 999, y: 999 };
  layoutResult.resolve(laidOut);
  assert.equal((await pendingLayout).ok, true);
  assert.deepEqual(controller.getState().draft.graph, laidOut);
  assert.equal(controller.getState().draft.name, '本地草稿');
});

test('controller 先发布局时拒绝保存，布局完成后可保存布局结果', async () => {
  const module = await controllerModule();
  const layoutResult = deferred<WorkflowGraph>();
  const savedInputs: WorkflowWriteInput[] = [];
  const standard = workflow({ builtIn: false });
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [standard], providers: [] }),
    layout: async () => layoutResult.promise,
    save: async (input) => {
      savedInputs.push(input);
      return workflow({
        id: input.id,
        name: input.name,
        description: input.description,
        graph: structuredClone(input.graph),
        builtIn: false,
      });
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  const pendingLayout = controller.autoLayout();
  assert.equal(controller.getState().layouting, true);

  const saveWhileLayouting = await controller.save();
  assert.equal(saveWhileLayouting.ok, false);
  assert.match(
    `${saveWhileLayouting.title} ${saveWhileLayouting.description ?? ''}`,
    /自动布局进行中，请稍后保存/,
  );
  assert.equal(savedInputs.length, 0);

  const laidOut = structuredClone(standard.graph);
  laidOut.nodes[0]!.position = { x: 999, y: 999 };
  layoutResult.resolve(laidOut);
  assert.equal((await pendingLayout).ok, true);
  assert.equal(controller.getState().layouting, false);
  assert.deepEqual(controller.getState().draft.graph, laidOut);

  const savedAfterLayout = await controller.save();
  assert.equal(savedAfterLayout.ok, true);
  assert.equal(savedInputs.length, 1);
  assert.deepEqual(savedInputs[0]?.graph, laidOut);
});

test('controller 校验错误不调用 API，合法保存发送精确 graph', async () => {
  const module = await controllerModule();
  const savedInputs: WorkflowWriteInput[] = [];
  const controller = module.createWorkflowSettingsController({
    now: () => 10,
    load: async () => ({ workflows: [], providers: [] }),
    layout: async graph => graph,
    save: async (input) => {
      savedInputs.push(input);
      return workflow({
        id: input.id,
        name: input.name,
        description: input.description,
        graph: structuredClone(input.graph),
        builtIn: false,
      });
    },
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  const invalidGraph = structuredClone(controller.getState().draft.graph);
  invalidGraph.nodes = invalidGraph.nodes.filter(node => node.type !== 'end');
  controller.updateGraph(invalidGraph);
  const invalidResult = await controller.save();
  assert.equal(invalidResult.ok, false);
  assert.equal(savedInputs.length, 0);
  assert.match(controller.getState().validationErrors.join('；'), /end/);

  const exactGraph = module.createWorkflowGraph();
  exactGraph.nodes[0]!.position = { x: 321, y: 654 };
  controller.updateGraph(exactGraph);
  controller.editDraft({ name: '精确保存' });
  const validResult = await controller.save();
  assert.equal(validResult.ok, true);
  assert.equal(savedInputs.length, 1);
  assert.deepEqual(savedInputs[0], {
    id: 'workflow-10',
    name: '精确保存',
    description: '',
    graph: exactGraph,
  });
  assert.notStrictEqual(savedInputs[0]!.graph, exactGraph);
});

test('controller 保存期间的后续编辑和切换不被保存结果覆盖', async () => {
  const module = await controllerModule();
  const saveResult = deferred<WorkflowDefinition>();
  const standard = workflow({ builtIn: false });
  const custom = workflow({ id: 'custom', name: '自定义', builtIn: false });
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [standard, custom], providers: [] }),
    layout: async graph => graph,
    save: async () => saveResult.promise,
    delete: async () => {
      throw new Error('本用例不应删除');
    },
  });
  await controller.load();

  controller.editDraft({ name: '待保存版本' });
  const pendingSave = controller.save();
  controller.editDraft({ name: '保存后的新编辑' });
  controller.selectWorkflow('custom');
  saveResult.resolve(workflow({
    id: 'standard',
    name: '服务端已保存',
    builtIn: false,
  }));
  assert.equal((await pendingSave).ok, true);
  assert.equal(controller.getState().draft.id, 'custom');
  assert.equal(controller.getState().draft.name, '自定义');
  assert.equal(controller.getState().selectedId, 'custom');
  assert.equal(
    controller.getState().workflows.find(item => item.id === 'standard')?.name,
    '服务端已保存',
  );
});

test('controller 删除当前自定义流程并选择剩余流程', async () => {
  const module = await controllerModule();
  const deletedIds: string[] = [];
  const custom = workflow({ id: 'custom', name: '自定义', builtIn: false });
  const standard = workflow();
  const controller = module.createWorkflowSettingsController({
    now: () => 1,
    load: async () => ({ workflows: [custom, standard], providers: [] }),
    layout: async graph => graph,
    save: async () => {
      throw new Error('本用例不应保存');
    },
    delete: async (id) => {
      deletedIds.push(id);
    },
  });
  await controller.load();

  assert.equal(controller.getState().draft.id, 'custom');
  assert.equal((await controller.deleteCurrent()).ok, true);
  assert.deepEqual(deletedIds, ['custom']);
  assert.equal(controller.getState().draft.id, 'standard');
  assert.equal(controller.getState().draft.builtInSource, true);
  assert.equal(controller.getState().selectedId, 'standard');
});

  test('WorkflowInspector 不再渲染已移除的旧循环节点配置', async () => {
  const vite = await createServer({
    root: new URL('../..', import.meta.url).pathname,
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
    resolve: { dedupe: ['react', 'react-dom'] },
    ssr: { noExternal: ['lucide-react'] },
  });
  try {
    const inspector = await vite.ssrLoadModule(
      '/src/features/workflows/WorkflowInspector.tsx',
    );
    const malformedExitConditions = [null, undefined, 'broken', []];

    for (const exitCondition of malformedExitConditions) {
      const graph = {
        version: 1,
        nodes: [
          { id: 'stage', type: 'stage', stage: 'dev', tasks: [] },
          {
            id: 'loop',
            type: 'loop',
            targetNodeId: 'stage',
            maxIterations: 3,
            ...(exitCondition === undefined ? {} : { exitCondition }),
          },
        ],
        edges: [],
      } as unknown as WorkflowGraph;

      const html = renderToStaticMarkup(createElement(inspector.WorkflowInspector, {
        graph,
        selectedElement: { kind: 'node', id: 'loop' },
        providers: [],
        providerLabel: (id: string) => id,
        onChange: () => {},
        onClose: () => {},
        onDelete: () => {},
      }));

        assert.doesNotMatch(html, /调度器|Provider|循环输入提示词/);
    }
  } finally {
    await vite.close();
  }
});

  test('WorkflowInspector 使用 Agent 配置 LLM 条件与循环判断', () => {
  assert.match(workflowInspectorSource, /value: 'llm_judgment', label: 'LLM 判断'/);
    assert.match(workflowInspectorSource, /label="选择 Agent"/);
  assert.match(workflowInspectorSource, /label="判断提示词"/);
  assert.match(workflowInspectorSource, /type === 'llm_judgment'/);
    assert.match(workflowInspectorSource, /循环判断方式/);
});

  test('循环属性使用固定次数并移除循环输入提示词', () => {
    assert.match(workflowInspectorSource, /小于 3 次/);
    assert.match(workflowInspectorSource, /不限次数/);
    assert.match(workflowInspectorSource, /aria-label="循环次数"/);
    assert.doesNotMatch(workflowInspectorSource, /循环输入提示词/);
  assert.doesNotMatch(workflowInspectorSource, /并行循环/);
    assert.match(workflowNodeSource, /最多/);
});

test('ChatInputBox 流程菜单使用窄展示类型且不绕过 graph 必填合约', () => {
  assert.doesNotMatch(chatInputBoxSource, /as WorkflowDefinition/);
  assert.match(chatInputBoxSource, /workflows:\s*WorkflowMenuItem\[\]/);
});
