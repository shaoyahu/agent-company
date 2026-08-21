import { getStageMeta, type WorkItem } from '../dashboardModel';

interface DetailPanelProps {
  item: WorkItem | null;
  open: boolean;
  onClose: () => void;
}

export function DetailPanel({ item, open, onClose }: DetailPanelProps) {
  const meta = getStageMeta(item?.stage);

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/30 transition duration-300 lg:hidden ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-x-0 bottom-0 z-40 max-h-[82vh] overflow-y-auto rounded-t-[32px] border border-white/70 bg-white/95 p-6 shadow-[0_-24px_60px_rgba(15,23,42,0.22)] backdrop-blur transition duration-300 lg:static lg:max-h-none lg:rounded-[30px] lg:border-slate-200/80 lg:p-6 lg:shadow-[0_20px_50px_rgba(15,23,42,0.06)] ${
          open ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 lg:translate-y-0 lg:opacity-100'
        }`}
      >
        {item ? (
          <>
            <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-200 lg:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  详情
                </div>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">{item.name}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 lg:hidden"
              >
                关闭
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${meta.chipClassName}`}>
                {meta.label}
              </span>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                {item.priority}
              </span>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {item.progress}%
              </span>
            </div>
            <p className="mt-5 text-sm leading-7 text-slate-600">{item.summary}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-[22px] bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">负责人</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{item.owner}</div>
              </div>
              <div className="rounded-[22px] bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">截止时间</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{item.due}</div>
              </div>
            </div>
            <div className="mt-6">
              <div className="text-sm font-semibold text-slate-900">时间线</div>
              <div className="mt-4 space-y-4">
                {item.timeline.map((timeline) => (
                  <div key={timeline.id} className="flex gap-3">
                    <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{timeline.label}</div>
                      <div className="mt-1 text-sm leading-6 text-slate-500">{timeline.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            当前没有可展示的任务详情。
          </div>
        )}
      </aside>
    </>
  );
}
