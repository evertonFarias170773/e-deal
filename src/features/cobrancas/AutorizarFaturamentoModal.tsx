"use client";

import { useEffect, useState } from "react";
import { X, AlertTriangle, ShieldCheck, RefreshCw, XCircle } from "lucide-react";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Cobranca, ModeloCobranca } from "@/features/cobrancas/types";

interface AutorizarFaturamentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobranca: Cobranca;
  onSuccess?: () => void;
}

type TabType = "aprovar" | "alterar" | "reprovar";

export function AutorizarFaturamentoModal({ isOpen, onClose, cobranca, onSuccess }: AutorizarFaturamentoModalProps) {
  const { liberarCobrancaReal, alterarCondicaoCobrancaReal, reprovarCondicaoCobrancaReal } = useCobrancas();
  const { user } = useAuth();
  const { showToast } = useAppToast();
  
  const [activeTab, setActiveTab] = useState<TabType>("aprovar");
  const [observacao, setObservacao] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modelosCobranca, setModelosCobranca] = useState<ModeloCobranca[]>([]);
  const [novoModeloId, setNovoModeloId] = useState("");

  useEffect(() => {
    if (isOpen) {
      setObservacao("");
      setActiveTab("aprovar");
      setNovoModeloId("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchModelos = async () => {
      const client = getSupabaseClient();
      if (!client) return;
      const { data, error } = await client
        .from("modelos_cobranca")
        .select("*")
        .order("modelo", { ascending: true })
        .order("inicio", { ascending: true })
        .order("qtd_parcela", { ascending: true })
        .order("intervalo", { ascending: true });
      if (!error && data) {
        setModelosCobranca(data as ModeloCobranca[]);
      }
    };
    void fetchModelos();
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

  async function handleAprovarAtual() {
    setIsSubmitting(true);
    try {
      const operador = user?.name || "Administrador";
      const success = await liberarCobrancaReal(cobranca.id, operador, "A_VENCER", false, "autorizar_faturamento");

      if (success) {
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

          if (chatError) console.warn("[AutorizarFaturamentoModal] Erro ao gravar mensagem no chat:", chatError);
        }

        showToast({
          type: "success",
          title: "Faturamento autorizado",
          description: "A cobrança foi autorizada com sucesso."
        });

        onSuccess?.();
        onClose();
      } else {
        showToast({ type: "error", title: "Erro ao autorizar", description: "Não foi possível realizar a liberação no banco de dados." });
      }
    } catch (err) {
      showToast({ type: "error", title: "Erro inesperado", description: err instanceof Error ? err.message : "Erro desconhecido." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAlterar() {
    if (!novoModeloId) {
      showToast({ type: "warning", title: "Selecione uma condição", description: "Por favor, escolha uma nova condição de pagamento." });
      return;
    }
    const novoModelo = modelosCobranca.find(m => String(m.id) === String(novoModeloId));
    if (!novoModelo) return;

    setIsSubmitting(true);
    try {
      const operador = user?.name || "Administrador";
      const { success, errorMessage } = await alterarCondicaoCobrancaReal(cobranca.id, novoModelo, operador, observacao);

      if (success) {
        showToast({
          type: "success",
          title: "Condição alterada",
          description: "A condição foi alterada e a cobrança permanece aguardando análise."
        });
        onSuccess?.();
        onClose();
      } else {
        showToast({ type: "error", title: "Erro ao alterar", description: errorMessage || "Falha na atualização." });
      }
    } catch (err) {
      showToast({ type: "error", title: "Erro inesperado", description: err instanceof Error ? err.message : "Erro desconhecido." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReprovar() {
    if (!observacao.trim()) {
      showToast({ type: "warning", title: "Motivo obrigatório", description: "Por favor, preencha o motivo da reprovação." });
      return;
    }
    setIsSubmitting(true);
    try {
      const operador = user?.name || "Administrador";
      const { success, errorMessage } = await reprovarCondicaoCobrancaReal(cobranca.id, observacao, operador);

      if (success) {
        showToast({
          type: "success",
          title: "Condição reprovada",
          description: "A condição solicitada foi reprovada e registrada."
        });
        onSuccess?.();
        onClose();
      } else {
        showToast({ type: "error", title: "Erro ao reprovar", description: errorMessage || "Falha na reprovação." });
      }
    } catch (err) {
      showToast({ type: "error", title: "Erro inesperado", description: err instanceof Error ? err.message : "Erro desconhecido." });
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
            <div className={`rounded-2xl p-2.5 ${activeTab === 'reprovar' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Análise de Faturamento</h2>
              <p className="text-xs text-slate-500 mt-0.5">Gestão da condição de pagamento</p>
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

        {/* Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab("aprovar")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-semibold transition ${activeTab === "aprovar" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <ShieldCheck className="h-4 w-4" />
            Aprovar
          </button>
          <button
            onClick={() => setActiveTab("alterar")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-semibold transition ${activeTab === "alterar" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <RefreshCw className="h-4 w-4" />
            Alterar
          </button>
          <button
            onClick={() => setActiveTab("reprovar")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-semibold transition ${activeTab === "reprovar" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <XCircle className="h-4 w-4" />
            Reprovar
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
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
            <div className="flex justify-between text-sm pt-2 border-t border-slate-200 mt-2">
              <span className="text-slate-500 font-medium">Condição Solicitada:</span>
              <span className="text-slate-900 font-semibold text-right text-amber-700">{cobranca.forma_pgto || cobranca.forma_fatu || "Não informada"}</span>
            </div>
          </div>

          {activeTab === "aprovar" && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-amber-900 flex gap-3 items-start">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
              <div className="text-xs">
                <p className="font-bold">Aviso de Autorização Pontual</p>
                <p className="mt-1 leading-relaxed">
                  Essa autorização aprova a condição solicitada pelo vendedor. Não altera o limite de crédito do cliente de forma global.
                </p>
              </div>
            </div>
          )}

          {activeTab === "alterar" && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Nova Condição de Pagamento</label>
              <select
                value={novoModeloId}
                onChange={(e) => setNovoModeloId(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
              >
                <option value="">Selecione a nova condição...</option>
                {modelosCobranca.map((m) => (
                  <option key={m.id} value={m.id}>{m.resultado}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="observacao_autorizacao" className="text-xs font-semibold text-slate-700">
              {activeTab === "reprovar" ? "Motivo da Reprovação (Obrigatório)" : "Observação (Opcional)"}
            </label>
            <textarea
              id="observacao_autorizacao"
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              disabled={isSubmitting}
              placeholder={activeTab === "reprovar" ? "Descreva por que a condição foi recusada..." : "Descreva o motivo ou termos acordados..."}
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
          {activeTab === "aprovar" && (
            <button
              type="button"
              onClick={handleAprovarAtual}
              disabled={isSubmitting}
              className="rounded-2xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
            >
              {isSubmitting ? "Autorizando..." : "Confirmar Autorização"}
            </button>
          )}
          {activeTab === "alterar" && (
            <button
              type="button"
              onClick={handleAlterar}
              disabled={isSubmitting || !novoModeloId}
              className="rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Alterando..." : "Alterar Condição"}
            </button>
          )}
          {activeTab === "reprovar" && (
            <button
              type="button"
              onClick={handleReprovar}
              disabled={isSubmitting || !observacao.trim()}
              className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {isSubmitting ? "Reprovando..." : "Reprovar e cancelar cobrança"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
