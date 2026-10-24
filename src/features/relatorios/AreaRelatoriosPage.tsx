"use client";

import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { AREAS, relatoriosDaArea } from "./registro";
import type { AreaRelatorio } from "./types";

/** Lista os relatórios de uma área que o usuário pode abrir. */
export function AreaRelatoriosPage({ area }: { area: AreaRelatorio }) {
  const { user } = useAuth();
  const dados = AREAS.find((a) => a.id === area);
  const visiveis = relatoriosDaArea(area).filter(
    (r) => Boolean(user?.isSuperAdmin) || Boolean(user?.isAdmin) || hasPermissao(user, r.permissao)
  );

  return (
    <div className="space-y-6">
      <PageHeader context="Relatórios" title={dados?.rotulo ?? "Relatórios"} subtitle={dados?.descricao} />
      {visiveis.length === 0 ? (
        <EmptyState
          title="Nenhum relatório disponível"
          description="Você não tem permissão para nenhum relatório desta área."
        />
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((r) => (
            <Link
              key={r.slug}
              href={`/relatorios/${r.area}/${r.slug}`}
              className="rounded-2xl p-5 shadow-sm transition hover:shadow-md"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-3">
                <BarChart3 className="h-5 w-5" style={{ color: "var(--muted)" }} />
                <strong style={{ color: "var(--foreground)" }}>{r.titulo}</strong>
              </div>
              <p className="mt-3 text-sm leading-6" style={{ color: "var(--muted)" }}>
                {r.descricao}
              </p>
              <p className="mt-3 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                Data usada: {r.dataReferencia.rotulo}
              </p>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
