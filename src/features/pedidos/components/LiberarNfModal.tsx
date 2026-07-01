import React from "react";
import { X, FileCheck } from "lucide-react";

type LiberarNfModalProps = {
  propostaId: number;
  clienteNome: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
};

export function LiberarNfModal({
  propostaId,
  clienteNome,
  isOpen,
  onClose,
  onConfirm,
  isSubmitting = false
}: LiberarNfModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Liberar para Faturamento Fiscal?</h2>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-4 text-slate-700">
          <p>
            Deseja enviar o pedido <strong>#{propostaId}</strong> ({clienteNome}) para a Fila de Faturamento Fiscal?
          </p>
          <div className="bg-emerald-50 text-emerald-900 p-4 rounded-xl flex gap-3 text-sm border border-emerald-200">
            <FileCheck className="h-5 w-5 shrink-0 text-emerald-600" />
            <div className="space-y-1.5">
              <p>O pedido será encaminhado para emissão de Nota Fiscal (NF-e/NFS-e).</p>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 p-5 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
          >
            {isSubmitting ? "Liberando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
