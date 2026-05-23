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
  emptyDescription
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
      <div className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:block">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={`px-5 py-4 font-semibold ${alignClass[column.align ?? "left"]}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={getKey(item)} className="transition hover:bg-slate-50">
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={`px-5 py-4 align-middle text-slate-700 ${
                      alignClass[column.align ?? "left"]
                    }`}
                  >
                    {column.cell(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:hidden">{items.map((item) => renderCard(item))}</div>
    </>
  );
}
