"use client";

import { Copy, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";

/**
 * "Ver conhecimento" (menus de Acoes da Expedicao e da lista de Pedidos).
 *
 * SO LEITURA: mostra o numero do conhecimento da transportadora ou do motoboy e deixa copiar,
 * do mesmo jeito da coluna "Rastreio". Nao consulta os Correios e nao grava nada; a edicao
 * continua em "Editar dados de expedicao".
 */
export function VerConhecimentoModal({
  idInt,
  numero,
  onClose
}: {
  idInt: number;
  numero: string;
  onClose: () => void;
}) {
  const { showToast } = useAppToast();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(numero);
      showToast({ type: "success", title: "Conhecimento copiado", description: numero });
    } catch {
      showToast({ type: "error", title: "Não foi possível copiar", description: numero });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Conhecimento">
      <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Conhecimento #{idInt}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="break-all rounded-2xl bg-slate-50 px-4 py-3 text-center font-mono text-base font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-100" data-testid="numero-conhecimento">
            {numero}
          </p>
          <button
            type="button"
            onClick={() => void copiar()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0f9f9a] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            <Copy className="h-4 w-4" /> Copiar
          </button>
          <p className="text-center text-[11px] text-slate-500">
            Número do conhecimento da transportadora. Para corrigir, use Editar dados de expedição.
          </p>
        </div>
      </div>
    </div>
  );
}
