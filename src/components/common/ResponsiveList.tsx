import type { KeyboardEvent, ReactNode } from "react";
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
  /**
   * Destaque de fundo por linha (desktop). Precisa vir por prop, e não por
   * classe: o hover da linha é aplicado em `style` inline, que venceria
   * qualquer classe e apagaria o destaque assim que o mouse saísse.
   * Retorne `null` para deixar a linha com o fundo padrão.
   */
  getRowHighlight?: (item: T) => { base: string; hover: string } | null;
};

const alignClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right"
};

/**
 * Controles que "consomem" o evento: a linha clicável não deve navegar quando o
 * usuário interage com eles. `.prevent-row-click` permite marcar um bloco
 * inteiro (um menu aberto em portal, por exemplo).
 */
function isElementoInterativo(target: HTMLElement | null) {
  return Boolean(
    target?.closest(
      "button, a, input, select, textarea, label, [role='button'], [role='menu'], [role='menuitem'], [role='checkbox'], .prevent-row-click"
    )
  );
}

export function ResponsiveList<T>({
  items,
  columns,
  renderCard,
  getKey,
  isLoading,
  emptyTitle,
  emptyDescription,
  onRowClick,
  getRowHighlight
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
                style={{ borderBottom: "1px solid var(--border)", background: getRowHighlight?.(item)?.base }}
                // Acessibilidade: linha clicável é focável e responde a Enter/Espaço.
                {...(onRowClick
                  ? {
                      // tabIndex sem role: a linha continua sendo `row` para
                      // leitores de tela, mas fica alcançável pelo teclado.
                      tabIndex: 0,
                      onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        // Tecla disparada dentro de um controle pertence a ele.
                        if (isElementoInterativo(e.target as HTMLElement)) return;
                        e.preventDefault();
                        onRowClick(item);
                      }
                    }
                  : {})}
                onClick={(e) => {
                  // Clique em controle (botão, link, checkbox, select, menu…) é do
                  // controle, não da linha — não navega.
                  if (isElementoInterativo(e.target as HTMLElement)) return;
                  if (onRowClick) onRowClick(item);
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    getRowHighlight?.(item)?.hover ?? "var(--card-hover)";
                }}
                onMouseLeave={(e) => {
                  // Volta ao destaque da linha, não ao transparente: sem isso o
                  // hover apagaria a marcação ao tirar o mouse.
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    getRowHighlight?.(item)?.base ?? "transparent";
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
