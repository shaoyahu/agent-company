import type { QueueItem } from '../dashboardModel';

export function QueueCard({ item }: { item: QueueItem }) {
  return (
    <article className="rounded-[24px] border border-slate-200/80 bg-white/85 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
      <div className="text-sm text-slate-500">{item.label}</div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-3xl font-semibold tracking-tight text-slate-950">{item.count}</div>
        <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          {item.change}
        </div>
      </div>
    </article>
  );
}
