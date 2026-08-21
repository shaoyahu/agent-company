import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Copy,
  Loader2,
  Maximize2,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import { api } from '../../api/client';
import {
  WorkflowCanvas,
} from '../../features/workflows/WorkflowCanvas';
import {
  WorkflowEditorModal,
} from '../../features/workflows/WorkflowEditorModal';
import {
  autoLayoutWorkflow,
} from '../../features/workflows/workflowModel';
import {
  createWorkflowSettingsController,
  workflowProviderLabel,
  type WorkflowOperationResult,
  type WorkflowSettingsController,
} from '../../features/workflows/workflowSettingsController';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/useConfirm';

function createController(): WorkflowSettingsController {
  return createWorkflowSettingsController({
    now: Date.now,
    load: async () => {
        const [workflowData, providerData, agentData] = await Promise.all([
        api.workflows(),
        api.providers(),
          api.agents(),
      ]);
      return {
        workflows: workflowData.workflows,
        providers: providerData.providers,
          agents: agentData.active.map(agent => ({
            id: agent.id,
            name: agent.name ?? agent.id,
            role: agent.role,
          })),
      };
    },
    layout: autoLayoutWorkflow,
    save: async input => (await api.upsertWorkflow(input)).workflow,
    delete: async id => {
      await api.deleteWorkflow(id);
    },
  });
}

export function WorkflowSettings() {
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editorOpen, setEditorOpen] = useState(false);
  const controllerRef = useRef<WorkflowSettingsController>();
  if (!controllerRef.current) controllerRef.current = createController();
  const controller = controllerRef.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const {
    workflows,
    providers,
      agents,
    selectedId,
    draft,
    validationErrors,
    loading,
    saving,
    layouting,
    canUndo,
    canRedo,
  } = state;

  const persistedDraft = useMemo(
    () => workflows.find(workflow => workflow.id === draft.id),
    [draft.id, workflows],
  );

  const showResult = (
    result: WorkflowOperationResult,
    successTone: 'ok' | 'warn' = 'ok',
  ): void => {
    toast.push({
      title: result.title,
      description: result.description,
      tone: result.ok ? successTone : 'danger',
    });
  };

  useEffect(() => {
    void controller.load().then((result) => {
      if (!result.ok) showResult(result);
    });
  }, [controller]);

  const selectOrCreateWorkflow = (id: string): void => {
    const result = controller.selectOrCreateWorkflow(id);
    if (result && !result.ok) showResult(result);
  };

  const layoutGraph = async (): Promise<void> => {
    showResult(await controller.autoLayout());
  };

  const saveWorkflow = async (): Promise<void> => {
    showResult(await controller.save());
  };

  const deleteWorkflow = async (): Promise<void> => {
    if (!persistedDraft) {
      showResult({ ok: false, title: '当前流程尚未保存' }, 'warn');
      return;
    }
    if (persistedDraft.builtIn) {
      showResult({ ok: false, title: '内置流程不能删除' }, 'warn');
      return;
    }
    const accepted = await confirm({
      title: '删除公司流程',
      message: `确定删除“${persistedDraft.name}”吗？`,
      confirmText: '删除',
      danger: true,
    });
    if (!accepted) return;
    showResult(await controller.deleteCurrent());
  };

  if (loading) {
    return (
      <div className="workflow-settings" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={18} className="animate-spin" />
        <span style={{ marginTop: 8, color: 'var(--subtle)', fontSize: 12 }}>加载流程中</span>
      </div>
    );
  }

  return (
    <div className="workflow-settings">
      <div className="workflow-commandbar">
        <div className="workflow-commandbar__identity">
          <div className="workflow-commandbar__title">公司流程</div>
          <div className="workflow-commandbar__select">
            <Select
              aria-label="选择流程"
              value={selectedId}
              placeholder="新建流程"
              size="sm"
              options={workflows.map(workflow => ({
                value: workflow.id,
                label: `${workflow.name}${workflow.builtIn ? ' · 内置' : ''}`,
              }))}
              onChange={selectOrCreateWorkflow}
            />
          </div>
          <div className="workflow-commandbar__field">
            <Input
              aria-label="流程名称"
              value={draft.name}
              placeholder="请输入"
              size="sm"
              onChange={event => controller.editDraft({
                name: event.target.value,
              })}
            />
          </div>
          <div className="workflow-commandbar__field workflow-commandbar__field--description">
            <Input
              aria-label="流程说明"
              value={draft.description}
              placeholder="请输入"
              size="sm"
              onChange={event => controller.editDraft({
                description: event.target.value,
              })}
            />
          </div>
          {draft.builtInSource && (
            <span className="workflow-commandbar__badge">内置 · 编辑时创建副本</span>
          )}
        </div>
        <div className="workflow-commandbar__actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<Plus size={13} />}
            onClick={controller.createWorkflow}
          >
            新建
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<Copy size={13} />}
            onClick={controller.copyWorkflow}
          >
            新建副本
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="撤回"
            title="撤回"
            icon={<Undo2 size={14} />}
            disabled={!canUndo}
            onClick={controller.undo}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="重做"
            title="重做"
            icon={<Redo2 size={14} />}
            disabled={!canRedo}
            onClick={controller.redo}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="放大编排"
            title="放大编排"
            icon={<Maximize2 size={14} />}
            onClick={() => setEditorOpen(true)}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<WandSparkles size={13} />}
            loading={layouting}
            onClick={() => void layoutGraph()}
          >
            自动布局
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            icon={<Save size={13} />}
            loading={saving}
            disabled={layouting}
            onClick={() => void saveWorkflow()}
          >
            保存
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            icon={<Trash2 size={13} />}
            disabled={!persistedDraft || !!persistedDraft.builtIn}
            onClick={() => void deleteWorkflow()}
          >
            删除
          </Button>
        </div>
      </div>

      <WorkflowCanvas
        graph={draft.graph}
        providers={providers}
          agents={agents}
        providerLabel={workflowProviderLabel}
        errors={validationErrors}
        onChange={controller.updateGraph}
        onError={message => toast.push({
          title: '无法连接',
          description: message,
          tone: 'danger',
        })}
      />
      <WorkflowEditorModal
        open={editorOpen}
        name={draft.name}
        graph={draft.graph}
        providers={providers}
          agents={agents}
        providerLabel={workflowProviderLabel}
        errors={validationErrors}
        canUndo={canUndo}
        canRedo={canRedo}
        saving={saving}
        layouting={layouting}
        onClose={() => setEditorOpen(false)}
        onGraphChange={controller.updateGraph}
        onError={message => toast.push({
          title: '无法连接',
          description: message,
          tone: 'danger',
        })}
        onUndo={controller.undo}
        onRedo={controller.redo}
        onAutoLayout={() => void layoutGraph()}
        onSave={() => void saveWorkflow()}
      />
      {confirmDialog}
    </div>
  );
}
