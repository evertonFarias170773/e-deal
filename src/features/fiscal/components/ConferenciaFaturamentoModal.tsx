"use client";

import { AlertTriangle, ArrowRight, Info, Loader2, RefreshCw, X } from "lucide-react";
import type { PendenciaFaturamento, ResultadoConferencia } from "../services/conferencia-faturamento";

/**
 * O que a conferência do Faturar mostra quando falta dado.
 *
 * Cada pendência diz quatro coisas, porque é isso que evita a ida e volta: o que
 * está errado, o valor encontrado, quem corrige e onde. O botão leva à tela de
 * origem — a correção acontece lá, nunca no fiscal.
 */

interface ConferenciaFaturamentoModalProps {
  pedido: string;
  resultado: ResultadoConferencia;
  reconferindo: boolean;
  onReconferir: () => void;
  onIrPara: (rota: string) => void;
  onFechar: () => void;
}

const CORES_SETOR: Record<string, string> = {
  Comercial: "bg-indigo-50 text-indigo-800 border-indigo-200",
  Financeiro: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Fiscal: "bg-slate-100 text-slate-700 border-slate-200"
};

function LinhaPendencia({
  pendencia,
  tom,
  onIrPara
}: {
  pendencia: PendenciaFaturamento;
  tom: "bloqueio" | "aviso";
  onIrPara: (rota: string) => void;
}) {
  const borda = tom === "bloqueio" ? "border-rose-200 bg-rose-50/40" : "border-amber-200 bg-amber-50/40";
  return (
    <li className={`rounded-2xl border p-4 space-y-2 ${borda}`}>
      <p className="text-sm font-semibold text-slate-900">{pendencia.titulo}</p>

      {pendencia.encontrado ? (
        <p className="text-xs text-slate-600">
          <span className="text-slate-400">Encontrado: </span>
          <span className="font-mono break-words">{pendencia.encontrado}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <span
          className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${
            CORES_SETOR[pendencia.setor] || CORES_SETOR.Fiscal
          }`}
        >
          {pendencia.setor}
        </span>
        <span className="text-xs text-slate-600">{pendencia.onde}</span>
      </div>

      {pendencia.rota ? (
        <button
          type="button"
          onClick={() => onIrPara(pendencia.rota!)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          Abrir para corrigir
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}

export function ConferenciaFaturamentoModal({
  pedido,
  resultado,
  reconferindo,
  onReconferir,
  onIrPara,
  onFechar
}: ConferenciaFaturamentoModalProps) {
  const { bloqueios, avisos } = resultado;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-6 pt-6 pb-4 flex items-start gap-3 border-b border-slate-100">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl shrink-0">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-900 leading-tight">
              A nota não pode ser aberta ainda
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pedido <span className="font-mono font-semibold">{pedido}</span> ·{" "}
              {bloqueios.length} {bloqueios.length === 1 ? "pendência" : "pendências"} a corrigir na
              origem
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-5">
          <ul className="space-y-3">
            {bloqueios.map((pendencia) => (
              <LinhaPendencia
                key={pendencia.codigo + pendencia.encontrado}
                pendencia={pendencia}
                tom="bloqueio"
                onIrPara={onIrPara}
              />
            ))}
          </ul>

          {avisos.length > 0 ? (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Info className="h-3.5 w-3.5" />
                Também vale conferir — não impede a nota
              </p>
              <ul className="space-y-3">
                {avisos.map((pendencia) => (
                  <LinhaPendencia
                    key={pendencia.codigo + pendencia.encontrado}
                    pendencia={pendencia}
                    tom="aviso"
                    onIrPara={onIrPara}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3">
          <span className="text-xs text-slate-500">
            Corrigido na origem? Reconfira sem recomeçar.
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onFechar}
              className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={onReconferir}
              disabled={reconferindo}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] rounded-xl shadow-sm transition disabled:opacity-50"
            >
              {reconferindo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Reconferir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
