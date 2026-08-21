import type { MetricItem } from '../dashboardModel';

export function HeroMetricCard({ item, index }: { item: MetricItem; index: number }) {
  const toneClassName = {
    accent: 'from-blue-600/14 to-cyan-400/12 text-blue-700 ring-blue-100',
    ok: 'from-emerald-500/14 to-lime-300/12 text-emerald-700 ring-emerald-100',
    warn: 'from-amber-500/14 to-orange-300/12 text-amber-700 ring-amber-100',
    danger: 'from-rose-500/14 to-red-300/12 text-rose-700 ring-rose-100',
  }[item.tone];

  return (
    <article
      className="animate-rise rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur"
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className={`inline-flex rounded-full bg-gradient-to-r px-3 py-1 text-xs font-semibold ring-1 ring-inset ${toneClassName}`}>
        {item.label}
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{item.value}</div>
        <div className="h-12 w-12 rounded-2xl bg-slate-950/5 p-3">
          <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-950 to-blue-600 opacity-90" />
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-500">{item.hint}</p>
    </article>
  );
}
