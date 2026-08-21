import { getStageMeta, type FocusItem } from '../dashboardModel';

export function FocusCard({ item }: { item: FocusItem }) {
  const meta = getStageMeta(item.tone);
  return (
    <article className="rounded-[24px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-950">{item.title}</div>
          <p className="mt-1 text-sm text-slate-500">{item.owner}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${meta.chipClassName}`}>
          {meta.label}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-[width] duration-500"
          style={{ width: `${item.progress}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
        <span>{item.progress}%</span>
        <span>{item.due}</span>
      </div>
    </article>
  );
}
