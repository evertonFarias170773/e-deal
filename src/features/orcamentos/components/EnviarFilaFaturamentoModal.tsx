import React from "react";
import { X, AlertTriangle } from "lucide-react";

type EnviarFilaFaturamentoModalProps = {
  propostaId: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
};

/**
 * Confirmação de "Enviar para Fila de Faturamento" (13/10/2026): o pedido vai só
 * para a Fila, sem passar pela Produção nem pela Expedição. O foco inicial fica no
 * "Cancelar": um Enter distraído não envia.
 */
export function EnviarFilaFaturamentoModal({
  propostaId,
  isOpen,
  onClose,
  onConfirm,
  isSubmitting = false
}: EnviarFilaFaturamentoModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Enviar para Fila de Faturamento?</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-slate-700">
          <p>
            Você vai enviar a proposta <strong>#{propostaId}</strong> só para a Fila de Faturamento, para emitir a nota.
          </p>

          <div className="bg-amber-50 text-amber-900 p-4 rounded-xl flex gap-3 text-sm border border-amber-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-1.5">
              <p><strong>O que acontece:</strong></p>
              <ul className="list-disc pl-4 space-y-1">
                <li>O pedido <strong>não passa pela Produção nem pela Expedição</strong>: não aparece em nenhum dos dois painéis.</li>
                <li>O status continua REVISAO ATENDENTE. Depois da nota, um administrador marca o pedido como entregue.</li>
                <li>Não existe &quot;tirar da fila&quot; por aqui. Seu nome e a data ficam registrados.</li>
              </ul>
              <p className="pt-1"><strong>Esta NÃO é a ação de liberar para a produção.</strong> Se o pedido precisa ser produzido, use &quot;Liberar para Produção&quot;.</p>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 p-5 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            autoFocus
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
            className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition disabled:opacity-50"
          >
            {isSubmitting ? "Enviando..." : "Enviar para a fila"}
          </button>
        </div>
      </div>
    </div>
  );
}
