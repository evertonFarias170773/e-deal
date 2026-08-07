"use client";

import { useRouter } from "next/navigation";
import { FileCheck2, FileClock, FileX2 } from "lucide-react";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatRangeLabel, type DateRange } from "@/lib/period";
import { formatTrend } from "@/features/dashboard/utils/trend";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type FiscalSectionProps = {
  fiscal: DashboardExecutivoPayload["fiscal"];
  range: DateRange;
};

export function FiscalSection({ fiscal, range }: FiscalSectionProps) {
  const router = useRouter();
  const { nfe, nfse } = fiscal;

  const emitidasQtd = nfe.emitidas.atual.qtd + nfse.emitidas.atual.qtd;
  const emitidasValor = nfe.emitidas.atual.valor + nfse.emitidas.atual.valor;
  const emitidasAnterior = nfe.emitidas.anterior.qtd + nfse.emitidas.anterior.qtd;
  const trendEmitidas = formatTrend(emitidasQtd, emitidasAnterior);

  const pendentes = nfe.pendentes + nfse.pendentes;
  const rejeitadas = nfe.rejeitadas + nfse.rejeitadas;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        Fiscal
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="NF emitidas"
          value={String(emitidasQtd)}
          description={`${formatCurrency(emitidasValor)} · NFe ${nfe.emitidas.atual.qtd} · NFSe ${nfse.emitidas.atual.qtd} · ${formatRangeLabel(range)}`}
          tone="success"
          trend={trendEmitidas?.label}
          trendTone={trendEmitidas?.tone}
          icon={FileCheck2}
          onClick={() => router.push("/notas-fiscais")}
        />
        <SummaryCard
          title="NF pendentes"
          value={String(pendentes)}
          description={`Aguardando envio ou processamento · NFe ${nfe.pendentes} · NFSe ${nfse.pendentes}`}
          tone={pendentes > 0 ? "warning" : "neutral"}
          icon={FileClock}
          onClick={() => router.push("/notas-fiscais")}
        />
        <SummaryCard
          title="NF rejeitadas"
          value={String(rejeitadas)}
          description={`Com erro ou denegadas · NFe ${nfe.rejeitadas} · NFSe ${nfse.rejeitadas}`}
          tone={rejeitadas > 0 ? "danger" : "neutral"}
          icon={FileX2}
          onClick={() => router.push("/notas-fiscais")}
        />
      </div>
    </section>
  );
}
