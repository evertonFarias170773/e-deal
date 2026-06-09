"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { PropostaCobrancaSelector } from "@/features/cobrancas/PropostaCobrancaSelector";
import { PanelCard } from "@/features/cobrancas/form-ui";
import { getEligiblePropostas } from "@/features/orcamentos/services/orcamentos.service";
import type { Proposta } from "@/features/orcamentos/types";

type CriarCobrancaFormProps = {
  propostaIdInt?: number;
};

export function CriarCobrancaForm({ propostaIdInt }: CriarCobrancaFormProps) {
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdInt, setSelectedIdInt] = useState<number | null>(propostaIdInt ?? null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setLoading(true);
        const data = await getEligiblePropostas();
        if (!active) return;
        setPropostas(data);
        if (data.length > 0) {
          setSelectedIdInt((prev) => prev ?? data[0].id_int);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Erro ao carregar propostas.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const proposta = propostas.find((item) => item.id_int === selectedIdInt);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">
        <h3 className="font-bold">Erro operacional</h3>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  if (propostas.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Criar cobrança pela proposta"
          subtitle="Atalho secundário para o fluxo financeiro."
          context="Financeiro / Nova cobrança"
          action={
            <Link href="/cobrancas" className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              Voltar para conferência
            </Link>
          }
        />
        <div className="rounded-3xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500">Nenhuma proposta aguardando faturamento.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Criar cobrança pela proposta"
        subtitle="Atalho secundário para o fluxo financeiro. A criação principal continua acontecendo dentro da proposta e usa o mesmo modal de cobrança."
        context="Financeiro / Nova cobrança"
        action={
          <Link href="/cobrancas" className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            Voltar para faturados
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
