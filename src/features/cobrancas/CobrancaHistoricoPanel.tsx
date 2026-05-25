import { formatDate } from "@/lib/formatters/date";
import type { Cobranca } from "@/features/cobrancas/types";

type CobrancaHistoricoPanelProps = {
  cobranca: Pick<Cobranca, "historico" | "propostasChat">;
};

const toneStyles = {
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-teal-200 bg-teal-50 text-teal-800",
  warning: "border-orange-200 bg-orange-50 text-orange-800",
  danger: "border-red-200 bg-red-50 text-red-800"
};

export function CobrancaHistoricoPanel({ cobranca }: CobrancaHistoricoPanelProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Histórico da cobrança</h3>
        <div className="mt-3 space-y-3">
          {cobranca.historico.map((evento) => (
            <div key={evento.id} className={`rounded-2xl border p-4 ${toneStyles[evento.tipo]}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{evento.titulo}</p>
                <span className="text-xs font-medium">{formatDate(evento.data)}</span>
              </div>
              <p className="mt-2 text-sm leading-6">{evento.descricao}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">propostas_chat mockado</h3>
        <div className="mt-3 space-y-3">
          {cobranca.propostasChat.length ? (
            cobranca.propostasChat.map((evento) => (
              <div key={evento.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-900">{evento.autor}</p>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    {evento.categoria}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{evento.mensagem}</p>
                <p className="mt-2 text-xs text-slate-500">{formatDate(evento.data)}</p>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              Nenhuma mensagem interna registrada para esta cobrança mockada.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
