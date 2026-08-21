import { useEffect, useMemo, useState } from 'react';
import { createWorkspaceViewModel } from './dashboardModel';
import { workspaceData } from './mockData';
import { ActivityFeed } from './components/ActivityFeed';
import { DetailPanel } from './components/DetailPanel';
import { FocusCard } from './components/FocusCard';
import { HeroMetricCard } from './components/HeroMetricCard';
import { LogoMark } from './components/LogoMark';
import { QuickActionCard } from './components/QuickActionCard';
import { QueueCard } from './components/QueueCard';
import { SectionHeader } from './components/SectionHeader';
import { Select } from './components/Select';
import { WorkTable } from './components/WorkTable';

type StageFilter = '' | 'draft' | 'running' | 'review' | 'risk';

export default function App() {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<StageFilter>('');
  const [selectedId, setSelectedId] = useState<string | null>(workspaceData.workItems[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const viewModel = useMemo(
    () => createWorkspaceViewModel(workspaceData, query, stage, selectedId),
    [query, selectedId, stage],
  );

  useEffect(() => {
    if (viewModel.selectedItem && selectedId !== viewModel.selectedItem.id) {
      setSelectedId(viewModel.selectedItem.id);
    }
  }, [selectedId, viewModel.selectedItem]);

  const handleSelectItem = (itemId: string) => {
    setSelectedId(itemId);
    setMobileDetailOpen(true);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(21,194,216,0.22),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(31,79,255,0.14),_transparent_28%),linear-gradient(180deg,_#eef4ff_0%,_#f6f8fc_42%,_#f2f5fb_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[linear-gradient(135deg,_rgba(255,255,255,0.55),_transparent_56%)]" />
      <main className="relative mx-auto max-w-[1440px] px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pb-16 lg:pt-8">
        <section className="overflow-hidden rounded-[32px] border border-white/70 bg-slate-950 px-5 py-6 text-white shadow-[0_32px_80px_rgba(15,23,42,0.24)] sm:px-8 sm:py-8">
          <div className="absolute inset-0 hidden bg-[radial-gradient(circle_at_top_right,_rgba(21,194,216,0.28),_transparent_32%),linear-gradient(135deg,_rgba(31,79,255,0.3),_transparent_55%)] lg:block" />
          <div className="relative flex flex-col gap-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex items-start gap-4">
                <LogoMark />
                <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    控制台蓝图
                  </div>
                  <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                    面向多团队协作的 Agent 控制台
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                    按“控制台蓝图”方案落地移动端优先首页，聚合指标、任务与风险信号，确保信息密度和操作节奏同时在线。
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 self-stretch sm:grid-cols-4 lg:min-w-[420px]">
                {viewModel.heroMetrics.map((item, index) => (
                  <HeroMetricCard key={item.id} item={item} index={index} />
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {viewModel.quickActions.map((item, index) => (
                <QuickActionCard key={item.id} item={item} index={index} />
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
          <div className="space-y-6">
            <section className="rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.06)] backdrop-blur sm:p-6">
              <SectionHeader
                eyebrow="工作台"
                title="任务总览"
                meta="左侧列表用于快速筛查，右侧详情承接上下文，不打断浏览路径。"
                count={viewModel.filteredItems.length}
              />
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <label className="flex-1">
                  <span className="mb-2 block text-sm font-medium text-slate-600">搜索任务</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索任务、负责人或标签"
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  />
                </label>
                <label className="sm:w-[220px]">
                  <span className="mb-2 block text-sm font-medium text-slate-600">阶段筛选</span>
                  <Select
                    value={stage}
                    onChange={(value) => setStage(value as StageFilter)}
                    options={[
                      { value: '', label: '全部阶段' },
                      { value: 'draft', label: '待整理' },
                      { value: 'running', label: '执行中' },
                      { value: 'review', label: '待评审' },
                      { value: 'risk', label: '有风险' },
                    ]}
                  />
                </label>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {viewModel.queues.map((item) => (
                  <QueueCard key={item.id} item={item} />
                ))}
              </div>
              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <WorkTable
                  items={viewModel.filteredItems}
                  selectedId={viewModel.selectedItem?.id ?? null}
                  onSelect={handleSelectItem}
                />
                <div className="hidden xl:block">
                  <DetailPanel item={viewModel.selectedItem} open onClose={() => setMobileDetailOpen(false)} />
                </div>
              </div>
            </section>

            <section className="rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.06)] backdrop-blur sm:p-6">
              <SectionHeader
                eyebrow="动态"
                title="最近动态"
                meta="把热修、动画接入和发布风险放进同一条观察链，方便跟踪。"
              />
              <div className="mt-5">
                <ActivityFeed items={viewModel.recentActivity} />
              </div>
            </section>
          </div>

          <section className="rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.06)] backdrop-blur sm:p-6">
            <SectionHeader
              eyebrow="推进"
              title="关键推进"
              meta="集中展示需要被盯紧的主线工作。"
              count={viewModel.focusItems.length}
            />
            <div className="mt-5 space-y-4">
              {viewModel.focusItems.map((item) => (
                <FocusCard key={item.id} item={item} />
              ))}
            </div>
            <div className="mt-6 rounded-[28px] border border-blue-100 bg-[linear-gradient(135deg,_rgba(31,79,255,0.08),_rgba(21,194,216,0.14))] p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-600">
                视觉模式
              </div>
              <div className="mt-3 text-xl font-semibold text-slate-950">控制台蓝图</div>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                以浅背景、深色顶部和高可读卡片层级承接密集信息；详情使用抽屉而非跳转，移动端仍能保持单页上下文。
              </p>
            </div>
          </section>
        </section>
      </main>

      <div className="xl:hidden">
        <DetailPanel
          item={viewModel.selectedItem}
          open={mobileDetailOpen}
          onClose={() => setMobileDetailOpen(false)}
        />
      </div>
    </div>
  );
}
