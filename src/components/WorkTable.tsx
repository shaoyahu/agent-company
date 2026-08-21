import { getStageMeta, type WorkItem } from '../dashboardModel';

interface WorkTableProps {
  items: WorkItem[];
  selectedId: string | null;
  onSelect: (itemId: string) => void;
}

export function WorkTable({ items, selectedId, onSelect }: WorkTableProps) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
      <div className="hidden grid-cols-[1.6fr_0.9fr_0.8fr_0.8fr] gap-4 border-b border-slate-200 px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 md:grid">
        <div>任务</div>
        <div>负责人</div>
        <div>进度</div>
        <div>截止</div>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((item) => {
          const meta = getStageMeta(item.stage);
          const selected = selectedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`grid w-full gap-3 px-5 py-5 text-left transition duration-300 md:grid-cols-[1.6fr_0.9fr_0.8fr_0.8fr] md:px-6 ${
                selected ? 'bg-blue-50/70' : 'bg-white hover:bg-slate-50'
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-slate-950">{item.name}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${meta.chipClassName}`}>
                    {meta.label}
                  </span>
                  <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                    {item.priority}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{item.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-sm text-slate-600 md:self-center">{item.owner}</div>
              <div className="md:self-center">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-[width] duration-500"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <div className="mt-2 text-sm text-slate-500">{item.progress}%</div>
              </div>
              <div className="text-sm text-slate-500 md:self-center">{item.due}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
