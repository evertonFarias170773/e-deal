"use client";

import { AlertTriangle, X } from "lucide-react";

interface ConfirmarInativacaoModalProps {
  isOpen: boolean;
  nomeCliente: string;
  idCliente: number;
  isProcessando: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirmação antes de inativar um cadastro. A ação some da lista (a view mostra
 * só ativos), então o passo é obrigatório para não inativar por clique errado.
 */
export function ConfirmarInativacaoModal({
  isOpen,
  nomeCliente,
  idCliente,
  isProcessando,
  onClose,
  onConfirm
}: ConfirmarInativacaoModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar inativação do cadastro"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-red-50 p-2.5 text-red-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold leading-tight text-slate-900">Inativar cadastro</h3>
              <p className="mt-0.5 font-mono text-xs text-slate-500">ID {idCliente}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessando}
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 text-sm text-slate-700">
          <p>
            Confirma inativar <strong className="font-semibold text-slate-900">{nomeCliente}</strong>?
          </p>
          <p className="mt-2 text-xs text-slate-500">
            O cadastro deixa de aparecer na lista e fica indisponível para novas propostas. Nenhum
            dado é apagado — o histórico é preservado.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessando}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessando}
            className="rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {isProcessando ? "Inativando..." : "Inativar cadastro"}
          </button>
        </div>
      </div>
    </div>
  );
}
