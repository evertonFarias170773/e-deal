import React from "react";
import { X, AlertTriangle } from "lucide-react";

type RetirarProducaoModalProps = {
  propostaId: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
};

/**
 * Confirmacao de "Retirar da Producao" (13/10/2026). Antes era um `window.confirm`
 * (na lista) e uma pergunta curta (na tela da proposta), faceis de confirmar no
 * automatico — quatro pedidos ficaram parados em oito dias, e quem retirou diz nao
 * ter clicado. O modal diz o que acontece, deixa claro que NAO e a acao de liberar
 * e poe o foco no "Cancelar": um Enter distraido nao retira.
 */
export function RetirarProducaoModal({
  propostaId,
  isOpen,
  onClose,
  onConfirm,
  isSubmitting = false
}: RetirarProducaoModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Retirar da Produção?</h2>
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
            Você vai retirar a proposta <strong>#{propostaId}</strong> da fila de Produção.
          </p>

          <div className="bg-amber-50 text-amber-900 p-4 rounded-xl flex gap-3 text-sm border border-amber-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-1.5">
              <p><strong>O que acontece:</strong></p>
              <ul className="list-disc pl-4 space-y-1">
                <li>O pedido <strong>volta ao atendente</strong> (status REVISAO ATENDENTE) e <strong>sai da fila de Produção</strong>.</li>
                <li>Para ele voltar à produção, o atendente precisa liberá-lo de novo.</li>
                <li>Só vale antes de a produção começar. Depois disso, quem devolve o pedido é a produção.</li>
                <li>Seu nome e a data ficam registrados.</li>
              </ul>
              <p className="pt-1"><strong>Esta NÃO é a ação de liberar.</strong> Se você acabou de liberar, o pedido já está na produção.</p>
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
            className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition disabled:opacity-50"
          >
            {isSubmitting ? "Retirando..." : "Retirar da produção"}
          </button>
        </div>
      </div>
    </div>
  );
}
