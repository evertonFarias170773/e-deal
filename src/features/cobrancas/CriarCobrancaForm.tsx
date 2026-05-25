"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { PropostaCobrancaSelector } from "@/features/cobrancas/PropostaCobrancaSelector";
import { PanelCard } from "@/features/cobrancas/form-ui";
import { getEligiblePropostasForCobranca } from "@/lib/mocks/pagamentos.mock";

type CriarCobrancaFormProps = {
  propostaIdInt?: number;
};

export function CriarCobrancaForm({ propostaIdInt }: CriarCobrancaFormProps) {
  const propostas = getEligiblePropostasForCobranca();
  const [selectedIdInt, setSelectedIdInt] = useState<number | null>(propostaIdInt ?? propostas[0]?.id_int ?? null);
  const proposta = propostas.find((item) => item.id_int === selectedIdInt) ?? propostas[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Criar cobrança pela proposta"
        subtitle="Atalho secundário para o fluxo financeiro. A criação principal continua acontecendo dentro da proposta e usa o mesmo modal centralizado."
        context="Financeiro / Nova cobrança"
        action={
          <Link href="/cobrancas" className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            Voltar para conferência
          </Link>
        }
      />

      <PanelCard title="1. Seleção da proposta" description="Use esta tela apenas como atalho quando precisar iniciar a cobrança fora do detalhe da proposta.">
        <PropostaCobrancaSelector propostas={propostas} selectedIdInt={selectedIdInt} onSelect={setSelectedIdInt} />
      </PanelCard>

      {proposta ? <PropostaCobrancaPanel proposta={proposta} defaultModalOpen /> : null}
    </div>
  );
}
