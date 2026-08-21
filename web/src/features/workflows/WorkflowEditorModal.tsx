import {
  Maximize2,
  Redo2,
  Save,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import type { WorkflowGraph } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import {
  type WorkflowProviderOption,
  type WorkflowAgentOption,
} from './WorkflowInspector';
import { WorkflowCanvas } from './WorkflowCanvas';

interface WorkflowEditorModalProps {
  open: boolean;
  name: string;
  graph: WorkflowGraph;
  providers: WorkflowProviderOption[];
  agents: WorkflowAgentOption[];
  providerLabel: (providerId: string, providers?: WorkflowProviderOption[]) => string;
  errors: string[];
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  layouting: boolean;
  onClose: () => void;
  onGraphChange: (graph: WorkflowGraph) => void;
  onError: (message: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onSave: () => void;
}

export function WorkflowEditorModal({
  open,
  name,
  graph,
  providers,
  agents,
  providerLabel,
  errors,
  canUndo,
  canRedo,
  saving,
  layouting,
  onClose,
  onGraphChange,
  onError,
  onUndo,
  onRedo,
  onAutoLayout,
  onSave,
}: WorkflowEditorModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="流程编排"
      size="full"
      height="viewport-90"
    >
      <div className="workflow-editor-modal">
        <div className="workflow-editor-modal__toolbar">
          <div className="workflow-editor-modal__identity">
            <Maximize2 size={15} aria-hidden="true" />
            <span>{name || '新流程'}</span>
          </div>
          <div className="workflow-editor-modal__actions">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="撤回"
              title="撤回"
              icon={<Undo2 size={14} />}
              disabled={!canUndo}
              onClick={onUndo}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="重做"
              title="重做"
              icon={<Redo2 size={14} />}
              disabled={!canRedo}
              onClick={onRedo}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={<WandSparkles size={14} />}
              loading={layouting}
              onClick={onAutoLayout}
            >
              自动布局
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              icon={<Save size={14} />}
              loading={saving}
              disabled={layouting}
              onClick={onSave}
            >
              保存
            </Button>
          </div>
        </div>
        <WorkflowCanvas
          graph={graph}
          providers={providers}
          agents={agents}
          providerLabel={providerLabel}
          errors={errors}
          onChange={onGraphChange}
          onError={onError}
        />
      </div>
    </Modal>
  );
}
