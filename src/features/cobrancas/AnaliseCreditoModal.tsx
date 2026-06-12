"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/formatters/currency";
import type { Cobranca, CreditAnalysisResult } from "@/features/cobrancas/types";
import { X, ShieldAlert, ShieldCheck, AlertCircle } from "lucide-react";

interface AnaliseCreditoModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobranca: Cobranca;
  onCreditApproved?: () => void;
}

export function AnaliseCreditoModal({ isOpen, onClose, cobranca, onCreditApproved }: AnaliseCreditoModalProps) {
  const [creditAnalysis, setCreditAnalysis] = useState<CreditAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [novoLimite, setNovoLimite] = useState("");
  const [isUpdatingLimit, setIsUpdatingLimit] = useState(false);
  const [warningPending, setWarningPending] = useState(false);

  const handleNovoLimiteChange = (val: string) => {
    setNovoLimite(val);
    setWarningPending(false);
  };

  const hasNoClient = !cobranca.id_cliente;
  const displayError = error || (hasNoClient ? "Cliente não identificado para análise de crédito." : null);

  async function fetchCredit(isUpdate = false) {
    if (!cobranca.id_cliente) return;
    setIsLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      if (!client) {
        setError("Cliente Supabase não inicializado.");
        return;
      }

      const { data, error: rpcError } = await client.rpc("fn_analise_credito_cliente", {
        p_id_cliente: Number(cobranca.id_cliente)
      });

      if (rpcError) {
        console.error("Erro na RPC de crédito:", rpcError);
        setError("Não foi possível carregar os dados de crédito no banco.");
      } else if (data && data.length > 0) {
        const result = data[0] as CreditAnalysisResult;
        setCreditAnalysis(result);

        const limitDisp = Number(result.limite_disponivel) || 0;
        const statusCred = (result.status_credito || "").trim().toUpperCase();
        
        const msg = result.mensagem || "";
        const msgLower = msg.toLowerCase();
        const temMensagemImpeditiva =
          msgLower.includes("restrição") ||
          msgLower.includes("restricao") ||
          msgLower.includes("bloqueado") ||
          msgLower.includes("atraso") ||
          msgLower.includes("excedido") ||
          msgLower.includes("pendente") ||
          msgLower.includes("vencido") ||
          msgLower.includes("sem limite") ||
          msgLower.includes("requer avaliação") ||
          msgLower.includes("requer avaliacao") ||
          msgLower.includes("financeiro");

        const hasEnoughLimit = limitDisp >= Number(cobranca.valor);
        const isStatusAprovado = statusCred === "APROVADO";

        const isAprovado = hasEnoughLimit && isStatusAprovado && !temMensagemImpeditiva;

        if (isUpdate) {
          if (isAprovado) {
            onCreditApproved?.();
          } else {
            setWarningPending(true);
          }
        }
      } else {
        setError("Nenhum registro de análise de crédito encontrado para este cliente.");
      }
    } catch (err) {
      console.error("Exceção ao buscar análise de crédito:", err);
      setError("Ocorreu um erro ao consultar as informações financeiras.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !cobranca.id_cliente) return;
    setWarningPending(false);
    void fetchCredit(false);

    return () => {
      setCreditAnalysis(null);
      setError(null);
      setWarningPending(false);
    };
  }, [isOpen, cobranca.id_cliente]);

  useEffect(() => {
    if (creditAnalysis) {
      setNovoLimite(String(creditAnalysis.limite_credito ?? 0));
    }
  }, [creditAnalysis]);

  // Prevent background scrolling when open
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  async function handleUpdateLimit() {
    if (!cobranca.id_cliente) return;
    const limitNum = Number(String(novoLimite).replace(",", "."));
    if (isNaN(limitNum) || limitNum < 0) {
      alert("Informe um limite numérico válido (maior ou igual a zero).");
      return;
    }

    setIsUpdatingLimit(true);
    setWarningPending(false);
    try {
      const client = getSupabaseClient();
      if (!client) {
        alert("Cliente Supabase não inicializado.");
        return;
      }

      const { error: updateError } = await client
        .from("clientes")
        .update({ limite_credito: limitNum })
        .eq("id_cliente", Number(cobranca.id_cliente));

      if (updateError) {
        console.error("Erro ao atualizar limite de crédito:", updateError);
        alert("Erro ao atualizar o limite de crédito: " + updateError.message);
      } else {
        await fetchCredit(true);
      }
    } catch (err) {
      console.error("Erro ao atualizar limite:", err);
      alert("Ocorreu um erro ao atualizar o limite de crédito.");
    } finally {
      setIsUpdatingLimit(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl space-y-6 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Análise de Crédito</h2>
            <p className="text-sm text-slate-500 mt-1">Dados reais consolidados do cliente.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {isLoading && !creditAnalysis ? (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent" />
              <span className="text-sm text-slate-600 font-semibold">Buscando informações financeiras do cliente...</span>
            </div>
          ) : displayError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 flex gap-3 items-start">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Aviso de Crédito</p>
                <p className="mt-1 text-sm leading-relaxed">{displayError}</p>
              </div>
            </div>
          ) : creditAnalysis ? (
            <div className="space-y-6">
              {/* Cliente */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</p>
                <p className="text-base font-bold text-slate-900 mt-1">{cobranca.cliente}</p>
                <p className="text-xs text-slate-500 mt-1">ID Cliente: {cobranca.id_cliente} • Documento: {cobranca.documento || "-"}</p>
              </div>

              {/* Editor de Limite de Crédito */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
                <div className="flex-1 space-y-1">
                  <label htmlFor="credit_limit_input" className="text-xs font-semibold text-slate-700 block">
                    Atualizar Limite de Crédito
                  </label>
                  <input
                    id="credit_limit_input"
                    type="text"
                    value={novoLimite}
                    onChange={(e) => handleNovoLimiteChange(e.target.value)}
                    disabled={isUpdatingLimit}
                    placeholder="Digite o novo limite..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f9f9a] focus:ring-2 focus:ring-[#dff8f6] disabled:opacity-50"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleUpdateLimit}
                  disabled={isUpdatingLimit || !novoLimite.trim()}
                  className="rounded-xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50 h-[38px] shrink-0"
                >
                  {isUpdatingLimit ? "Atualizando..." : "Atualizar Limite"}
                </button>
              </div>

              {/* Grid de Informações */}
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                <InfoBox label="Limite de Crédito" value={formatCurrency(creditAnalysis.limite_credito)} />
                <InfoBox label="Utilizado" value={formatCurrency(creditAnalysis.utilizado)} />
                <InfoBox label="Disponível" value={formatCurrency(creditAnalysis.limite_disponivel)} />
                <InfoBox label="Saldo de Carteira" value={formatCurrency(creditAnalysis.saldo_carteira)} />
                <InfoBox 
                  label="Faturamentos Vencidos" 
                  value={creditAnalysis.qtd_pagamentos_atrasados > 0 ? `${creditAnalysis.qtd_pagamentos_atrasados} pendente(s)` : "Nenhum atraso"}
                  detail={creditAnalysis.qtd_pagamentos_atrasados > 0 ? "Requer avaliação do financeiro" : "Histórico regular"}
                />
                <InfoBox label="Risco de Crédito" value={creditAnalysis.risco_credito || "-"} />
              </div>

              {/* Alerta de Impedimento Financeiro Pós-Atualização */}
              {warningPending && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start text-amber-800 animate-in fade-in slide-in-from-top-1 duration-200">
                  <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold text-xs uppercase tracking-wider text-amber-950">Aviso Financeiro</p>
                    <p className="mt-1 text-sm leading-relaxed font-semibold">
                      Limite atualizado, mas a cobrança permanece pendente por impedimento financeiro.
                    </p>
                  </div>
                </div>
              )}

              {/* Status Alert */}
              {(() => {
                const limitDisp = Number(creditAnalysis.limite_disponivel) || 0;
                const statusCred = (creditAnalysis.status_credito || "").trim().toUpperCase();
                
                const msgLower = (creditAnalysis.mensagem || "").toLowerCase();
                const temMensagemImpeditiva = msgLower.includes("restrição") || msgLower.includes("bloqueado") || msgLower.includes("atraso") || msgLower.includes("excedido");

                const isAprovado = (statusCred === "APROVADO" || limitDisp >= Number(cobranca.valor)) && !temMensagemImpeditiva;
                return (
                  <div className={`rounded-2xl border p-4 flex gap-3 items-start ${isAprovado ? "border-teal-200 bg-teal-50 text-teal-800" : "border-orange-200 bg-orange-50 text-orange-800"}`}>
                    {isAprovado ? (
                      <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" />
                    ) : (
                      <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold">{isAprovado ? "Crédito Operacional Disponível" : "Aguardando Análise Financeira"}</p>
                      <p className="mt-1 text-sm leading-relaxed">{creditAnalysis.mensagem || (isAprovado ? "Cliente com limite disponível e sem restrições em aberto." : "Solicitação sujeita a liberação pelo time financeiro.")}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-3 text-slate-500">
              <AlertCircle className="h-8 w-8 text-slate-400" />
              <span className="text-sm">Nenhum dado pôde ser recuperado para esta análise.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100/50">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-900 truncate">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}
