// ROUTE: src/app/(erp)/producao/page.tsx
// Descrição: Rota inicial e segura para o painel de Produção/Artes da Fase 1 integrado ao Supabase

"use client";

import { useSearchParams } from "next/navigation";
import { ProducaoArtesPanel } from "@/features/producao";
import { PageHeader } from "@/components/common/PageHeader";
import { FileText, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

function ProducaoContent() {
  const searchParams = useSearchParams();
  const idIntParam = searchParams.get("id_int") || searchParams.get("id");
  const idInt = idIntParam ? Number(idIntParam) : null;

  return (
    <div className="space-y-6">
      {idInt ? (
        <div className="space-y-6">
          <div className="bg-slate-105 p-4 rounded-2xl border border-slate-200 text-xs">
            <span className="font-semibold text-slate-650">Pedido ID_INT de Produção Ativo:</span> <strong className="text-blue-700">{idInt}</strong>
          </div>
          <ProducaoArtesPanel idInt={idInt} />
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-350 bg-slate-50 p-8 text-center max-w-md mx-auto mt-12">
          <FileText className="mx-auto h-12 w-12 text-slate-400" />
          <h3 className="mt-4 text-base font-semibold text-slate-900">ID do Pedido Não Informado</h3>
          <p className="mt-2 text-sm text-slate-500">
            Para visualizar o painel operacional de produção com dados reais do Supabase, informe o parâmetro <code className="bg-slate-200 px-1 py-0.5 rounded">?id_int=ID</code> na URL.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/producao?id_int=17796"
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl text-xs transition"
            >
              Testar com Proposta #17796
            </Link>
            <Link
              href="/producao?id_int=17797"
              className="bg-slate-800 hover:bg-slate-900 text-white font-bold py-2 px-4 rounded-xl text-xs transition"
            >
              Testar com Proposta #17797
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProducaoArtesRoute() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/pedidos"
          className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar para Pedidos</span>
        </Link>
      </div>

      <PageHeader
        title="Controle de Artes e Modelos de Produção"
        subtitle="Fase 1 - Versionamento de arquivos de pré-impressão integrado com o Supabase."
      />

      <Suspense fallback={
        <div className="flex h-48 items-center justify-center rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Carregando parâmetros...</p>
        </div>
      }>
        <ProducaoContent />
      </Suspense>
    </div>
  );
}
