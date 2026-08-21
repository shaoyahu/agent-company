export type StageTone = 'draft' | 'running' | 'review' | 'risk';

export interface MetricItem {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: 'accent' | 'ok' | 'warn' | 'danger';
}

export interface QuickActionItem {
  id: string;
  label: string;
  description: string;
  count: string;
}

export interface ActivityItem {
  id: string;
  team: string;
  title: string;
  summary: string;
  time: string;
  tone: StageTone;
}

export interface QueueItem {
  id: string;
  label: string;
  count: number;
  change: string;
}

export interface FocusItem {
  id: string;
  title: string;
  owner: string;
  progress: number;
  due: string;
  tone: StageTone;
}

export interface TimelineItem {
  id: string;
  label: string;
  detail: string;
}

export interface WorkItem {
  id: string;
  name: string;
  owner: string;
  stage: StageTone;
  priority: 'P0' | 'P1' | 'P2';
  progress: number;
  due: string;
  summary: string;
  tags: string[];
  timeline: TimelineItem[];
}

export interface WorkspaceData {
  metrics: MetricItem[];
  quickActions: QuickActionItem[];
  activity: ActivityItem[];
  queues: QueueItem[];
  focus: FocusItem[];
  workItems: WorkItem[];
}

export interface StageMeta {
  label: string;
  chipClassName: string;
  dotClassName: string;
}

export interface WorkspaceViewModel {
  heroMetrics: MetricItem[];
  quickActions: QuickActionItem[];
  recentActivity: ActivityItem[];
  queues: QueueItem[];
  focusItems: FocusItem[];
  filteredItems: WorkItem[];
  selectedItem: WorkItem | null;
}

const STAGE_META: Record<StageTone, StageMeta> = {
  draft: {
    label: '待整理',
    chipClassName: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
    dotClassName: 'bg-slate-400',
  },
  running: {
    label: '执行中',
    chipClassName: 'bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200',
    dotClassName: 'bg-sky-500',
  },
  review: {
    label: '待评审',
    chipClassName: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    dotClassName: 'bg-emerald-500',
  },
  risk: {
    label: '有风险',
    chipClassName: 'bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200',
    dotClassName: 'bg-rose-500',
  },
};

const DEFAULT_STAGE_META = STAGE_META.draft;

function normalizeQuery(input: string | null | undefined): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

export function getStageMeta(stage: string | null | undefined): StageMeta {
  if (stage === 'draft' || stage === 'running' || stage === 'review' || stage === 'risk') {
    return STAGE_META[stage];
  }
  return DEFAULT_STAGE_META;
}

export function filterWorkItems(
  items: WorkItem[],
  query: string | null | undefined,
  stage: string | null | undefined,
): WorkItem[] {
  const normalizedQuery = normalizeQuery(query);
  const normalizedStage = normalizeQuery(stage);

  return items.filter((item) => {
    const stageMatches = normalizedStage === '' || item.stage === normalizedStage;
    if (!stageMatches) return false;
    if (normalizedQuery === '') return true;

    const searchFields = [
      item.name,
      item.owner,
      item.summary,
      ...item.tags,
    ];
    return searchFields.some((field) => field.toLowerCase().includes(normalizedQuery));
  });
}

export function findWorkItemById(
  items: WorkItem[],
  itemId: string | null | undefined,
): WorkItem | null {
  const normalizedId = normalizeQuery(itemId);
  if (normalizedId === '') return null;
  const item = items.find((entry) => entry.id === normalizedId);
  return item ?? null;
}

export function createWorkspaceViewModel(
  data: WorkspaceData,
  query: string | null | undefined,
  stage: string | null | undefined,
  selectedItemId: string | null | undefined,
): WorkspaceViewModel {
  const filteredItems = filterWorkItems(data.workItems, query, stage);
  const selectedItem = findWorkItemById(filteredItems, selectedItemId)
    ?? filteredItems[0]
    ?? null;

  return {
    heroMetrics: data.metrics,
    quickActions: data.quickActions,
    recentActivity: data.activity,
    queues: data.queues,
    focusItems: data.focus,
    filteredItems,
    selectedItem,
  };
}
