import type { QuickActionItem } from '../dashboardModel';

export function QuickActionCard({ item, index }: { item: QuickActionItem; index: number }) {
  return (
    <button
      type="button"
      className="animate-rise group rounded-[26px] border border-slate-200/80 bg-white/90 p-5 text-left shadow-[0_18px_40px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_24px_48px_rgba(31,79,255,0.16)]"
      style={{ animationDelay: `${180 + index * 90}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{item.label}</div>
          <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
        </div>
        <span className="rounded-full bg-slate-950 px-3 py-1 text-sm font-semibold text-white transition group-hover:bg-blue-600">
          {item.count}
        </span>
      </div>
    </button>
  );
}
