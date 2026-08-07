"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatRangeLabel, type DateRange } from "@/lib/period";
import { fetchRankingVendedores } from "@/features/dashboard/services/dashboard.service";
import type { RankingVendedores } from "@/features/dashboard/types";

type RankingVendedoresSectionProps = {
  range: DateRange;
};

/**
 * Ranking de vendedores — exclusivo de perfis administrativos. O gate real é a
 * RPC (42501 para os demais); aqui a seção some silenciosamente em caso de
 * negativa ou erro. Mesma regra oficial de faturamento do painel do vendedor.
 */
export function RankingVendedoresSection({ range }: RankingVendedoresSectionProps) {
  const requestKey = `${range.inicio}|${range.fim}`;
  const [carga, setCarga] = useState<{ key: string; data: RankingVendedores | null } | null>(null);

  useEffect(() => {
    let active = true;
    const [inicio, fim] = requestKey.split("|");
    void fetchRankingVendedores({ inicio, fim }).then((resultado) => {
      if (active) setCarga({ key: requestKey, data: resultado.data });
    });
    return () => {
      active = false;
    };
  }, [requestKey]);

  const isLoading = !carga || carga.key !== requestKey;

  if (isLoading) {
    return (
      <div
        className="h-64 animate-pulse rounded-3xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      />
    );
  }

  // Sem dados (negado ou erro) → seção não existe para este usuário.
  if (!carga.data) return null;

  const { ranking } = carga.data;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        Ranking de vendedores
      </h2>
      <article
        className="rounded-3xl border p-5 shadow-sm"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className="text-sm" style={{ color: "var(--muted-subtle)" }}>
            Faturamento confirmado por vendedor em {formatRangeLabel(range)} — mesma regra oficial
            do painel do vendedor. Visível apenas para perfis administrativos.
          </p>
          <span className="rounded-2xl p-3 ring-1 bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800">
            <Trophy className="h-5 w-5" />
          </span>
        </div>
        {ranking.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            Nenhum faturamento atribuído a vendedores no período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr
                  className="text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "var(--muted)" }}
                >
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Vendedor</th>
                  <th className="px-3 py-2 text-right">Faturamento</th>
                  <th className="px-3 py-2 text-right">Pedidos</th>
                  <th className="px-3 py-2 text-right">Ticket médio</th>
                  <th className="px-3 py-2">Participação</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((linha) => (
                  <tr
                    key={linha.vendedor}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-3 py-2.5">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                        style={{
                          background: "var(--background)",
                          border: "1px solid var(--border)",
                          color: "var(--secondary)"
                        }}
                      >
                        {linha.posicao}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: "var(--foreground)" }}>
                      {linha.vendedor}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: "var(--foreground)" }}>
                      {formatCurrency(linha.valor)}
                    </td>
                    <td className="px-3 py-2.5 text-right" style={{ color: "var(--foreground)" }}>
                      {linha.pedidos}
                    </td>
                    <td className="px-3 py-2.5 text-right" style={{ color: "var(--foreground)" }}>
                      {linha.ticket === null ? "—" : formatCurrency(linha.ticket)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-24 overflow-hidden rounded-full"
                          style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                        >
                          <div
                            className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
                            style={{
                              width: `${Math.min(100, linha.participacao_pct ?? 0)}%`,
                              background: "var(--secondary)"
                            }}
                          />
                        </div>
                        <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                          {linha.participacao_pct === null
                            ? "—"
                            : `${String(linha.participacao_pct).replace(".", ",")}%`}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
