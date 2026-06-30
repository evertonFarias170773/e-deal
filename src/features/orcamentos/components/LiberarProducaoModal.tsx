import React from "react";
import { X, AlertTriangle } from "lucide-react";

type LiberarProducaoModalProps = {
  propostaId: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
};

export function LiberarProducaoModal({
  propostaId,
  isOpen,
  onClose,
  onConfirm,
  isSubmitting = false
}: LiberarProducaoModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Liberar proposta para Produção?</h2>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-4 text-slate-700">
          <p>
            Você está prestes a enviar a proposta <strong>#{propostaId}</strong> para a fila de Produção/Pedidos.
          </p>
          
          <div className="bg-amber-50 text-amber-900 p-4 rounded-xl flex gap-3 text-sm border border-amber-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-1.5">
              <p><strong>Atenção:</strong></p>
              <ul className="list-disc pl-4 space-y-1">
                <li>A proposta será enviada para <strong>REVISAO PRODUCAO</strong>.</li>
                <li>A entrada na fila de Produção será ativada.</li>
                <li>Certifique-se de que os pagamentos e artes já foram conferidos.</li>
              </ul>
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
            className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#123f61] transition disabled:opacity-50"
          >
            {isSubmitting ? "Liberando..." : "Confirmar liberação"}
          </button>
        </div>
      </div>
    </div>
  );
}
