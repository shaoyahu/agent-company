import { getStageMeta, type ActivityItem } from '../dashboardModel';

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => {
        const meta = getStageMeta(item.tone);
        return (
          <article key={item.id} className="rounded-[24px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">{item.team}</div>
              <div className="text-xs text-slate-400">{item.time}</div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClassName}`} />
              <h3 className="text-base font-semibold text-slate-950">{item.title}</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">{item.summary}</p>
          </article>
        );
      })}
    </div>
  );
}
