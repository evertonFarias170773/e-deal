"use client";

import { useEffect, useRef, useState } from "react";
import { X, ShieldCheck } from "lucide-react";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Cobranca } from "@/features/cobrancas/types";
import { ConferenciaFinanceiraAlertaModal } from "./ConferenciaFinanceiraAlertaModal";
import { executarConfirmacaoDaConferencia, type TravaDeEnvio } from "./lib/confirmar-conferencia";

interface ConfirmarLiberacaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobranca: Cobranca;
  onSuccess?: () => void;
}

export function ConfirmarLiberacaoModal({ isOpen, onClose, cobranca, onSuccess }: ConfirmarLiberacaoModalProps) {
  const { confirmarConferenciaReal } = useCobrancas();
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bloqueioSituacao, setBloqueioSituacao] = useState<any>(null);
  // Uma chamada por vez, mesmo com dois cliques antes de o botão desligar.
  const travaDeEnvio = useRef<TravaDeEnvio>({ ocupada: false });

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  /**
   * A ordem está em `executarConfirmacaoDaConferencia`: a janela fecha assim
   * que a rota responde; a linha da lista, a recarga completa e a mensagem do
   * chat vêm depois, sem segurar a tela.
   */
  async function handleConfirm() {
    await executarConfirmacaoDaConferencia(travaDeEnvio.current, {
      confirmar: () => confirmarConferenciaReal(cobranca, user?.name || "Operador Financeiro"),
      aoMudarEnvio: setIsSubmitting,
      aoConfirmar: () => {
        showToast({
          type: "success",
          title: "Conferência confirmada",
          description: "Cobrança liberada com sucesso para os próximos fluxos operacionais."
        });

        onSuccess?.();
        onClose();
      },
      aoFalhar: (err: any) => {
        if (err === null) {
          showToast({
            type: "error",
            title: "Erro ao confirmar",
            description: "Não foi possível concluir a liberação. Tente novamente."
          });
        } else if (err?.name === "ConferenciaBloqueadaError" && err.situacao) {
          setBloqueioSituacao(err.situacao);
        } else {
          showToast({
            type: "error",
            title: "Erro inesperado",
            description: err instanceof Error ? err.message : (err?.message || "Erro desconhecido.")
          });
        }
      },
      gravarChat: async () => {
        const client = getSupabaseClient();
        if (!client) return;
        const { error } = await client.from("propostas_chat").insert([
          {
            id_int: cobranca.id_int,
            id_cliente: cobranca.id_cliente,
            mensagem: "Cobrança conferida e liberada para os próximos fluxos operacionais: expedição, fiscal, boletos e produção.",
            tipo: "SISTEMA",
            autor_nome: user?.name || "Sistema",
            autor_email: user?.email || null,
            setor: "Financeiro",
            visivel_externo: false
          }
        ]);
        if (error) throw error;
      },
      registrarFalhaDoChat: (chatErr) => {
        console.warn("[ConfirmarLiberacaoModal] Erro ao gravar mensagem no chat:", chatErr);
      }
    });
  }

  const formattedValor = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(cobranca.valor);

  return (
    <>
      <ConferenciaFinanceiraAlertaModal
        isOpen={!!bloqueioSituacao}
        onClose={() => setBloqueioSituacao(null)}
        situacao={bloqueioSituacao}
        cobrancaAlvoId={cobranca.id}
      />
      <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 flex items-center justify-center animate-fade-in" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-6 flex flex-col transform transition-all scale-100">
          
          <div className="flex items-start justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-teal-50 p-2.5 text-teal-600">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Confirmar Liberação Operacional</h2>
                <p className="text-xs text-slate-500 mt-0.5">Conclusão da conferência financeira operacional</p>
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

          <div className="space-y-4">
            <div className="text-sm text-slate-600 space-y-3 leading-relaxed">
              <p className="font-semibold text-slate-800">
                Esta ação remove a cobrança da Fila de Conferência.
              </p>
              <p>
                Após a confirmação, ela ficará disponível para os próximos fluxos operacionais (boletos, fiscal, expedição e produção).
              </p>
              <p className="font-medium text-slate-700">
                Deseja continuar?
              </p>
            </div>

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
          </div>

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
              className="rounded-2xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              {isSubmitting ? "Confirmando..." : "Confirmar Liberação"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
