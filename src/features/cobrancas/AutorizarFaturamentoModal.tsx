"use client";

import { useEffect, useState } from "react";
import { X, AlertTriangle, ShieldCheck } from "lucide-react";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Cobranca } from "@/features/cobrancas/types";

interface AutorizarFaturamentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobranca: Cobranca;
  onSuccess?: () => void;
}

export function AutorizarFaturamentoModal({ isOpen, onClose, cobranca, onSuccess }: AutorizarFaturamentoModalProps) {
  const { liberarCobrancaReal } = useCobrancas();
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const [observacao, setObservacao] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setObservacao("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      const operador = user?.name || "Administrador";
      // Update pagamentos_v2 table (confirmado = false, status = 'A_VENCER')
      const success = await liberarCobrancaReal(cobranca.id, operador, "A_VENCER", false, "autorizar_faturamento");

      if (success) {
        // Log to propostas_chat table on Supabase
        const client = getSupabaseClient();
        if (client) {
          const obsSuffix = observacao.trim() ? ` Obs: ${observacao.trim()}` : "";
          const mensagemChat = `Faturamento autorizado manualmente por administrador para esta cobrança. Exceção pontual, sem alteração da regra global do cliente. Encaminhado para conferência humana antes da liberação da OS.${obsSuffix}`;

          const { error: chatError } = await client
            .from("propostas_chat")
            .insert([
              {
                id_int: cobranca.id_int,
                id_cliente: cobranca.id_cliente,
                mensagem: mensagemChat,
                tipo: "SISTEMA",
                autor_nome: user?.name || "Sistema",
                autor_email: user?.email || null,
                setor: "Financeiro",
                visivel_externo: false
              }
            ]);

          if (chatError) {
            console.warn("[AutorizarFaturamentoModal] Erro ao gravar mensagem no chat:", chatError);
          }
        }

        showToast({
          type: "success",
          title: "Faturamento autorizado",
          description: "A cobrança foi autorizada com sucesso e enviada para a fila de conferência."
        });

        onSuccess?.();
        onClose();
      } else {
        showToast({
          type: "error",
          title: "Erro ao autorizar",
          description: "Não foi possível realizar a liberação no banco de dados."
        });
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: err instanceof Error ? err.message : "Erro desconhecido."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const formattedValor = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(cobranca.valor);

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 flex items-center justify-center animate-fade-in" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-6 flex flex-col transform transition-all scale-100">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-50 p-2.5 text-amber-600">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Autorizar Faturamento</h2>
              <p className="text-xs text-slate-500 mt-0.5">Liberação manual de pendência financeira</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Summary Box */}
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">Cliente:</span>
              <span className="text-slate-900 font-semibold text-right">{cobranca.cliente}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">Proposta:</span>
              <span className="text-slate-900 font-semibold">#{cobranca.id_int}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">Valor:</span>
              <span className="text-emerald-700 font-bold">{formattedValor}</span>
            </div>
          </div>

          {/* Alert Box */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-amber-900 flex gap-3 items-start">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
            <div className="text-xs">
              <p className="font-bold">Aviso de Autorização Pontual</p>
              <p className="mt-1 leading-relaxed">
                Essa autorização vale apenas para esta cobrança. Não altera o limite de crédito ou padrão de pagamento global do cliente.
              </p>
            </div>
          </div>

          {/* Observation Input */}
          <div className="space-y-1.5">
            <label htmlFor="observacao_autorizacao" className="text-xs font-semibold text-slate-700">
              Observação <span className="text-slate-400 font-normal">(Opcional)</span>
            </label>
            <textarea
              id="observacao_autorizacao"
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              disabled={isSubmitting}
              placeholder="Descreva o motivo ou termos acordados para esta liberação..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="rounded-2xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {isSubmitting ? "Autorizando..." : "Confirmar Autorização"}
          </button>
        </div>
      </div>
    </div>
  );
}
