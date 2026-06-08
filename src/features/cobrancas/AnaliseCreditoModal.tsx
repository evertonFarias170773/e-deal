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
}

export function AnaliseCreditoModal({ isOpen, onClose, cobranca }: AnaliseCreditoModalProps) {
  const [creditAnalysis, setCreditAnalysis] = useState<CreditAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasNoClient = !cobranca.id_cliente;
  const displayError = error || (hasNoClient ? "Cliente não identificado para análise de crédito." : null);

  useEffect(() => {
    if (!isOpen || !cobranca.id_cliente) return;

    let active = true;
    async function fetchCredit() {
      setIsLoading(true);
      try {
        const client = getSupabaseClient();
        if (!client) {
          setError("Cliente Supabase não inicializado.");
          return;
        }

        const { data, error: rpcError } = await client.rpc("fn_analise_credito_cliente", {
          p_id_cliente: Number(cobranca.id_cliente)
        });

        if (active) {
          if (rpcError) {
            console.error("Erro na RPC de crédito:", rpcError);
            setError("Não foi possível carregar os dados de crédito no banco.");
          } else if (data && data.length > 0) {
            setCreditAnalysis(data[0] as CreditAnalysisResult);
          } else {
            setError("Nenhum registro de análise de crédito encontrado para este cliente.");
          }
        }
      } catch (err) {
        console.error("Exceção ao buscar análise de crédito:", err);
        if (active) {
          setError("Ocorreu um erro ao consultar as informações financeiras.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void fetchCredit();
    return () => {
      active = false;
      setCreditAnalysis(null);
      setError(null);
    };
  }, [isOpen, cobranca.id_cliente]);

  // Prevent background scrolling when open
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

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
          {isLoading ? (
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

              {/* Status Alert */}
              {(() => {
                const isAprovado = creditAnalysis.status_credito?.toUpperCase() === "APROVADO" || (creditAnalysis.limite_disponivel >= cobranca.valor && creditAnalysis.qtd_pagamentos_atrasados === 0);
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
