"use client";

import { useState } from "react";
import { FileText, Lock } from "lucide-react";
import type { ObservacoesDoPedido } from "@/features/fiscal/services/observacoes-do-pedido.service";

/**
 * Os dois selos das observações do pedido (11/11/2026), na Fila de faturamento
 * e nas janelas da NF-e e da NFS-e:
 *
 *   "Obs. para a NF"  `obs_nota_fiscal`: vai para as Informações Complementares.
 *   "Obs. interna"    bloco "10. Observações e Condições": NÃO vai para a nota.
 *
 * O texto aparece ao passar o mouse (title) e, num clique, abre embaixo do selo.
 * Sem observação, não renderiza nada.
 */
export function SelosDeObservacao({ observacoes }: { observacoes: ObservacoesDoPedido | null | undefined }) {
  const [aberto, setAberto] = useState<"nota" | "interna" | null>(null);
  if (!observacoes || (!observacoes.paraNota && !observacoes.interna)) return null;
  const alternar = (qual: "nota" | "interna") => (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setAberto((atual) => (atual === qual ? null : qual));
  };
  const texto = aberto === "nota" ? observacoes.paraNota : aberto === "interna" ? observacoes.interna : "";
  return (
    <div className="flex max-w-full flex-col items-start gap-1" data-selos-observacao>
      <div className="flex flex-wrap items-center gap-1">
        {observacoes.paraNota ? (
          <button
            type="button"
            data-selo-obs-nota
            title={`Observação para a nota fiscal (vai nas Informações Complementares):\n${observacoes.paraNota}`}
            aria-expanded={aberto === "nota"}
            onClick={alternar("nota")}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-violet-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm ring-1 ring-inset ring-violet-700 hover:bg-violet-700"
          >
            <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
            Obs. para a NF
          </button>
        ) : null}
        {observacoes.interna ? (
          <button
            type="button"
            data-selo-obs-interna
            title={`Observações e Condições (bloco 10, interno, não vai para a nota):\n${observacoes.interna}`}
            aria-expanded={aberto === "interna"}
            onClick={alternar("interna")}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 ring-1 ring-inset ring-amber-400 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100"
          >
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            Obs. interna
          </button>
        ) : null}
      </div>
      {aberto ? (
        <div
          data-texto-observacao={aberto}
          onClick={(event) => event.stopPropagation()}
          className={`w-full max-w-xs rounded-lg border p-2 text-xs ${
            aberto === "nota"
              ? "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100"
              : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          }`}
        >
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide">
            {aberto === "nota" ? "Vai na nota (Informações Complementares)" : "Bloco 10 - interno, não vai na nota"}
          </p>
          <p className="whitespace-pre-wrap break-words">{texto}</p>
        </div>
      ) : null}
    </div>
  );
}
