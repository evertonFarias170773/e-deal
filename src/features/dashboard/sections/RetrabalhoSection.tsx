"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import type { DateRange } from "@/lib/period";
import { fetchCobrancasDeRetrabalho } from "@/features/dashboard/services/dashboard.service";
import { resumoDeRetrabalho, type ResumoDeRetrabalho } from "@/features/dashboard/utils/retrabalho-resumo";
import { getEmpresaExibicao } from "@/features/cobrancas/cobrancas-utils";

/** As tres empresas do quadro, na ordem pedida. O nome e o da Conferencia (`getEmpresaExibicao`). */
const EMPRESAS_DO_QUADRO = [1, 2, 3] as const;

type RetrabalhoSectionProps = {
  range: DateRange;
  companyId: number;
  companyNames: Record<number, string>;
};

/**
 * Quadro "Retrabalho" (19/10/2026): quantidade e valor das cobranças E-RETRABALHO
 * confirmadas no período, por empresa. SÓ informativo: retrabalho é cortesia e
 * NÃO entra nos totais de faturamento (`contaNoFaturamento`, 61a7b0f). Conta as
 * mesmas cobranças da lista "Retrabalhos" da aba Cobranças Confirmadas
 * (`resumoDeRetrabalho` → `retrabalhoConfirmadoParaLista`). Usa o período e a
 * empresa do Dashboard; leitura própria, como os widgets.
 */
export function RetrabalhoSection({ range, companyId, companyNames }: RetrabalhoSectionProps) {
  const chave = `${range.inicio}|${range.fim}|${companyId}`;
  const [carga, setCarga] = useState<{ chave: string; resumo: ResumoDeRetrabalho | null; erro: string | null } | null>(null);

  useEffect(() => {
    let ativo = true;
    const [inicio, fim, empresa] = chave.split("|");
    void fetchCobrancasDeRetrabalho({ inicio, fim }, Number(empresa)).then((r) => {
      if (!ativo) return;
      setCarga({ chave, resumo: r.data ? resumoDeRetrabalho(r.data, { inicio, fim }) : null, erro: r.error });
    });
    return () => {
      ativo = false;
    };
  }, [chave]);

  const carregando = !carga || carga.chave !== chave;
  const resumo = carregando ? null : carga.resumo;
  const empresas = companyId === 0 ? EMPRESAS_DO_QUADRO : EMPRESAS_DO_QUADRO.filter((id) => id === companyId);

  return (
    <section>
      <article
        data-quadro-retrabalho
        className="rounded-3xl border p-5 shadow-sm"
        style={{ background: "var(--card)", borderColor: "var(--retrabalho)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold" style={{ color: "var(--retrabalho)" }}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retrabalho
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-subtle)" }}>
              Cobranças E-Retrabalho confirmadas no período. Só informativo: retrabalho é cortesia e não entra no faturamento.
            </p>
          </div>
        </div>

        {carregando ? (
          <div className="h-24 animate-pulse rounded-2xl" style={{ background: "var(--card-hover)" }} />
        ) : !resumo ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Não foi possível carregar o retrabalho{carga?.erro ? ` (${carga.erro})` : ""}. Nenhum número é exibido para não confundir falha com zero.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Total no período
              </p>
              <p data-retrabalho-total className="mt-2 text-2xl font-bold" style={{ color: "var(--retrabalho)" }}>
                {formatCurrency(resumo.valor)}
              </p>
              <p data-retrabalho-qtd className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {resumo.quantidade} {resumo.quantidade === 1 ? "cobrança" : "cobranças"}
              </p>
            </div>
            {empresas.map((id) => {
              const e = resumo.porEmpresa[id] ?? { quantidade: 0, valor: 0 };
              return (
                <div key={id} data-retrabalho-empresa={id} className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    {getEmpresaExibicao({ id_empresa: id, empresa: companyNames[id] ?? null })}
                  </p>
                  <p className="mt-2 text-xl font-semibold" style={{ color: "var(--foreground)" }}>
                    {formatCurrency(e.valor)}
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                    {e.quantidade} {e.quantidade === 1 ? "cobrança" : "cobranças"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
