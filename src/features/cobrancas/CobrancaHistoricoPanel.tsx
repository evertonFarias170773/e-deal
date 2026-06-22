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
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            Histórico ainda não disponível.
          </div>
        </div>
      </div>
    </div>
  );
}
