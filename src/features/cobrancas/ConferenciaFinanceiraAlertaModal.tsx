"use client";

import { useEffect } from "react";
import { AlertTriangle, X, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { SituacaoQuitacaoResult } from "@/features/cobrancas/services/conferencia-financeira.service";

interface ConferenciaFinanceiraAlertaModalProps {
  isOpen: boolean;
  onClose: () => void;
  situacao: SituacaoQuitacaoResult;
  cobrancaAlvoId: string;
}

export function ConferenciaFinanceiraAlertaModal({ isOpen, onClose, situacao, cobrancaAlvoId }: ConferenciaFinanceiraAlertaModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen || !situacao) return null;

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

  const getStatusIcon = (status: string, confirmado: boolean, isAlvo: boolean) => {
    if (isAlvo) return <Clock className="h-4 w-4 text-amber-500" />;
    if (status === "PAID" || (status === "A_VENCER" && confirmado)) {
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    }
    if (["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"].includes(status.toUpperCase())) {
      return <XCircle className="h-4 w-4 text-rose-500" />;
    }
    return <Clock className="h-4 w-4 text-slate-400" />;
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/70 p-4 flex items-center justify-center animate-fade-in" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl flex flex-col transform transition-all scale-100 max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50/50 p-6 rounded-t-3xl">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Não é possível confirmar esta cobrança</h2>
              <p className="text-sm text-slate-600 mt-1">A soma das cobranças é inferior ao total da proposta.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 transition-colors">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
              <div className="text-sm text-slate-500 font-medium mb-1">Total da Proposta</div>
              <div className="text-2xl font-bold text-slate-900">{formatCurrency(situacao.valorTotalProposta)}</div>
            </div>
            <div className="rounded-2xl bg-rose-50 p-4 border border-rose-100">
              <div className="text-sm text-rose-600 font-medium mb-1">Saldo Pendente (Falta)</div>
              <div className="text-2xl font-bold text-rose-700">{formatCurrency(situacao.saldoPendente)}</div>
            </div>
          </div>

          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">Resumo das Cobranças</h3>
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {situacao.cobrancasAtivas.map(c => {
                  const isAlvo = c.id === cobrancaAlvoId;
                  const isQuitada = c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado);
                  return (
                    <tr key={c.id} className={isAlvo ? "bg-amber-50" : ""}>
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {c.tipo_cobranca}
                        {isAlvo && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Em conferência</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(c.status, c.confirmado, isAlvo)}
                          <span className="text-slate-600">
                            {isAlvo ? "Simulação (Pendente)" : isQuitada ? "Pago/Confirmado" : "Pendente"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(c.valor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={2} className="px-4 py-3 font-semibold text-slate-700 text-right">
                    Total Quitado (com simulação):
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-900 text-right text-base">
                    {formatCurrency(situacao.novoValorQuitado)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          
          <div className="mt-4 p-4 rounded-xl bg-slate-50 text-sm text-slate-600 border border-slate-200">
            <strong>Como resolver?</strong> Verifique se há cobranças não cadastradas para esta proposta ou se o valor total da proposta foi alterado indevidamente. O sistema exige que a soma das parcelas iguale o total da proposta para liberar o fluxo financeiro.
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 p-6 bg-slate-50/50 rounded-b-3xl flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-[#0b2f4a] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#123f61]"
          >
            Entendi, voltar
          </button>
        </div>
      </div>
    </div>
  );
}
