'use client';

interface TableData {
  headers: string[];
  rows: string[][];
}

const STATUS_STYLES: Record<string, string> = {
  'Aguardando aprovação': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  'Em negociação': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'Pendente de arte': 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  'Aprovado': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  'Vencido': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  'A vencer': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  'Em produção': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'Rodoviário': 'bg-slate-100 text-slate-700 dark:bg-slate-700/30 dark:text-slate-300',
};

function isStatus(value: string): boolean {
  return value in STATUS_STYLES;
}

function isMonetary(value: string): boolean {
  return value.startsWith('R$');
}

function isRef(value: string): boolean {
  return value.startsWith('#');
}

export function MaestroTableRenderer({ data }: { data: Record<string, unknown> }) {
  const { headers, rows } = data as unknown as TableData;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] dark:border-white/10 bg-[var(--card)] dark:bg-white/3 shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--background)] dark:bg-white/5 border-b border-[var(--border)] dark:border-white/10">
            {headers.map((h, i) => (
              <th
                key={i}
                className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] dark:text-white/40"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b last:border-0 border-[var(--border)] dark:border-white/5 hover:bg-[var(--background)] dark:hover:bg-white/3 transition-colors"
            >
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-3">
                  {isStatus(cell) ? (
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[cell]}`}>
                      {cell}
                    </span>
                  ) : isRef(cell) ? (
                    <span className="font-mono text-[var(--primary)] dark:text-blue-400 font-semibold text-xs">{cell}</span>
                  ) : isMonetary(cell) ? (
                    <span className="font-semibold text-[var(--foreground)] dark:text-white text-xs tabular-nums">{cell}</span>
                  ) : (
                    <span className="text-xs text-[var(--foreground)] dark:text-white/80">{cell}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
