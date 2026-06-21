import type { ReactNode } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";

type Column<T> = {
  header: string;
  align?: "left" | "center" | "right";
  cell: (item: T) => ReactNode;
};

type ResponsiveListProps<T> = {
  items: T[];
  columns: Column<T>[];
  renderCard: (item: T) => ReactNode;
  getKey: (item: T) => string;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (item: T) => void;
};

const alignClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right"
};

export function ResponsiveList<T>({
  items,
  columns,
  renderCard,
  getKey,
  isLoading,
  emptyTitle,
  emptyDescription,
  onRowClick
}: ResponsiveListProps<T>) {
  if (isLoading) {
    return (
      <>
        <div className="hidden lg:block">
          <LoadingSkeleton variant="table" />
        </div>
        <div className="lg:hidden">
          <LoadingSkeleton variant="cards" />
        </div>
      </>
    );
  }

  if (!items.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      {/* Tabela — desktop */}
      <div
        className="hidden overflow-hidden rounded-2xl shadow-sm lg:block"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)"
        }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ background: "var(--background)" }}>
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={`px-5 py-4 text-xs font-semibold uppercase tracking-wide ${alignClass[column.align ?? "left"]}`}
                  style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={getKey(item)}
                className={`transition ${onRowClick ? "cursor-pointer" : ""}`}
                style={{ borderBottom: "1px solid var(--border)" }}
                onClick={(e) => {
                  // Se o clique for em um botao, a ou dropdown, ignoramos para nao acionar a linha (opcional)
                  const target = e.target as HTMLElement;
                  if (target.closest('button') || target.closest('a') || target.closest('.prevent-row-click')) return;
                  if (onRowClick) onRowClick(item);
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "var(--card-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "transparent";
                }}
              >
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={`px-5 py-4 align-middle ${alignClass[column.align ?? "left"]}`}
                    style={{ color: "var(--foreground)" }}
                  >
                    {column.cell(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile */}
      <div className="grid gap-4 lg:hidden">
        {items.map((item) => renderCard(item))}
      </div>
    </>
  );
}
