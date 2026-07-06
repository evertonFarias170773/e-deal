'use client';

interface CardItem {
  label: string;
  value: string;
  type?: 'badge-success' | 'badge-warning' | 'badge-danger' | 'progress';
}

interface CardData {
  title: string;
  items: CardItem[];
}

export function MaestroCardRenderer({ data }: { data: Record<string, unknown> }) {
  const { title, items } = data as unknown as CardData;

  return (
    <div className="rounded-xl border border-[var(--border)] dark:border-white/10 bg-[var(--card)] dark:bg-white/3 overflow-hidden shadow-sm">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-[var(--border)] dark:border-white/10 bg-[var(--background)] dark:bg-white/5">
        <p className="font-semibold text-sm text-[var(--foreground)] dark:text-white">{title}</p>
      </div>

      {/* Items grid */}
      <div className="grid grid-cols-2">
        {items.map((item, i) => {
          const isLastRow = i >= items.length - (items.length % 2 === 0 ? 2 : 1);
          const isRightCol = i % 2 === 1;

          return (
            <div
              key={i}
              className={[
                'px-4 py-3',
                !isLastRow && 'border-b border-[var(--border)] dark:border-white/5',
                !isRightCol && 'border-r border-[var(--border)] dark:border-white/5',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)] dark:text-white/35 mb-1">
                {item.label}
              </p>

              {item.type === 'badge-success' && (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {item.value}
                </span>
              )}
              {item.type === 'badge-warning' && (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {item.value}
                </span>
              )}
              {item.type === 'badge-danger' && (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                  {item.value}
                </span>
              )}
              {item.type === 'progress' && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--secondary)] transition-all"
                      style={{ width: item.value }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-[var(--foreground)] dark:text-white tabular-nums">
                    {item.value}
                  </span>
                </div>
              )}
              {!item.type && (
                <p className="text-xs font-medium text-[var(--foreground)] dark:text-white/90 leading-snug">
                  {item.value}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
