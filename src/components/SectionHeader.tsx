interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  meta?: string;
  count?: string | number;
}

export function SectionHeader({ eyebrow, title, meta, count }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
          {eyebrow}
        </div>
        <h2 className="mt-2 text-lg font-semibold text-slate-950 sm:text-xl">{title}</h2>
        {meta ? <p className="mt-1 text-sm text-slate-500">{meta}</p> : null}
      </div>
      {count !== undefined ? (
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
          {count}
        </div>
      ) : null}
    </div>
  );
}
