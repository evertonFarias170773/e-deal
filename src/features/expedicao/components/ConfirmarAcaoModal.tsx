"use client";

import { AlertTriangle, X } from "lucide-react";

/**
 * Confirmação de ação de expedição no desenho do sistema.
 *
 * Substitui `window.confirm`, que abre o diálogo nativo do navegador — sem
 * identidade visual, sem dark mode e com o domínio "localhost:3000 diz" no
 * topo. Marcar pronto e marcar entregue mudam o status oficial do pedido; a
 * confirmação precisa parecer parte do sistema.
 */
export function ConfirmarAcaoModal({
  titulo,
  descricao,
  detalhe,
  rotuloConfirmar,
  salvando,
  onConfirmar,
  onClose
}: {
  titulo: string;
  descricao: string;
  detalhe?: string;
  rotuloConfirmar: string;
  salvando: boolean;
  onConfirmar: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!salvando) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-6">
          <p className="text-sm text-slate-700 dark:text-slate-300">{descricao}</p>
          {detalhe ? (
            <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {detalhe}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={salvando}
            className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#123f61] disabled:opacity-50"
          >
            {salvando ? "Salvando..." : rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
