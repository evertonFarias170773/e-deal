"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { fetchComSessao } from "@/lib/supabase/sessao";
import {
  formatarBytes,
  formatarValorSaude,
  type InfraSaude,
  type MetricaSaude,
  type NivelSaude
} from "@/features/dashboard/infra-saude";

const ESTILO_NIVEL: Record<NivelSaude, { rotulo: string; selo: string; barra: string }> = {
  ok: {
    rotulo: "Tudo certo",
    selo: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800",
    barra: "bg-emerald-500"
  },
  atencao: {
    rotulo: "Atenção",
    selo: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
    barra: "bg-amber-500"
  },
  critico: {
    rotulo: "Agir agora",
    selo: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800",
    barra: "bg-rose-500"
  },
  indisponivel: {
    rotulo: "Sem leitura",
    selo: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
    barra: "bg-slate-400"
  }
};

function horaCurta(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function faixas(m: MetricaSaude) {
  const palavra = m.sentido === "acima" ? "acima de" : "abaixo de";
  return `Amarelo ${palavra} ${formatarValorSaude(m.amarelo, m.unidade)} · vermelho ${palavra} ${formatarValorSaude(m.vermelho, m.unidade)}`;
}

function CartaoMetrica({ m }: { m: MetricaSaude }) {
  const estilo = ESTILO_NIVEL[m.nivel];
  const preenchido =
    m.valor !== null && m.limite ? Math.max(0, Math.min(100, (m.valor / m.limite) * 100)) : null;

  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border p-4"
      style={{ background: "var(--background)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          {m.titulo}
        </p>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${estilo.selo}`}>
          {estilo.rotulo}
        </span>
      </div>
      <p className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
        {formatarValorSaude(m.valor, m.unidade)}
        {m.unidade !== "pct" ? (
          <span className="ml-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
            {m.limite !== null ? `de ${formatarValorSaude(m.limite, m.unidade)}` : "sem limite fixo"}
          </span>
        ) : null}
      </p>
      {preenchido !== null ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className={`h-full rounded-full ${estilo.barra}`} style={{ width: `${preenchido}%` }} />
        </div>
      ) : null}
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {faixas(m)}
      </p>
      <p className="text-xs leading-5" style={{ color: "var(--muted-subtle)" }}>
        {m.explicacao}
      </p>
    </div>
  );
}

/**
 * Saúde da infraestrutura — exclusiva de administrador. O gate real é a rota
 * `/api/admin/infra-saude` (403 para os demais); aqui a seção some em silêncio
 * em caso de negativa ou erro, como o Ranking de vendedores.
 */
export function InfraSaudeSection() {
  const [carga, setCarga] = useState<{ pronto: boolean; data: InfraSaude | null }>({ pronto: false, data: null });

  useEffect(() => {
    let ativo = true;
    fetchComSessao("/api/admin/infra-saude")
      .then(async (resposta) => {
        const corpo = resposta.ok ? await resposta.json().catch(() => null) : null;
        if (ativo) setCarga({ pronto: true, data: corpo?.success ? (corpo.data as InfraSaude) : null });
      })
      .catch(() => {
        if (ativo) setCarga({ pronto: true, data: null });
      });
    return () => {
      ativo = false;
    };
  }, []);

  if (!carga.pronto) {
    return (
      <div
        className="h-64 animate-pulse rounded-3xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      />
    );
  }

  if (!carga.data) return null;

  const { metricas, buckets, historicoMeses, avisos, geradoEm, validoAte } = carga.data;
  const maiorMes = Math.max(1, ...historicoMeses.map((m) => m.bytes));

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        Saúde da infraestrutura
      </h2>
      <article
        className="rounded-3xl border p-5 shadow-sm"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className="text-sm" style={{ color: "var(--muted-subtle)" }}>
            Como estão o banco de dados e os arquivos do sistema. Verde: tudo certo. Amarelo: vale
            acompanhar. Vermelho: hora de agir, antes que o sistema fique lento ou pare. Leitura das{" "}
            {horaCurta(geradoEm)}; os números são relidos depois das {horaCurta(validoAte)}. Visível
            apenas para administradores.
          </p>
          <span className="rounded-2xl p-3 ring-1 bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800">
            <Activity className="h-5 w-5" />
          </span>
        </div>

        {avisos.length > 0 ? (
          <div className="mb-4 rounded-2xl p-3 text-sm ring-1 bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800">
            {avisos.join(" ")}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metricas.map((m) => (
            <CartaoMetrica key={m.chave} m={m} />
          ))}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Onde estão os arquivos
            </p>
            <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
              Pastas que mais ocupam espaço. &quot;Aberta&quot; quer dizer que qualquer pessoa com o link
              abre o arquivo.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    <th className="px-2 py-1.5">Pasta</th>
                    <th className="px-2 py-1.5 text-right">Arquivos</th>
                    <th className="px-2 py-1.5 text-right">Tamanho</th>
                    <th className="px-2 py-1.5 text-right">Novos em 30 dias</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.slice(0, 8).map((b) => (
                    <tr key={b.bucket} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-1.5" style={{ color: "var(--foreground)" }}>
                        {b.bucket}
                        {b.publico ? (
                          <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>
                            (aberta)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right" style={{ color: "var(--foreground)" }}>
                        {b.arquivos.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold" style={{ color: "var(--foreground)" }}>
                        {formatarBytes(b.bytes)}
                      </td>
                      <td className="px-2 py-1.5 text-right" style={{ color: "var(--foreground)" }}>
                        {formatarBytes(b.bytes30d)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Histórico de alterações por mês
            </p>
            <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
              Espaço que o registro de alterações ocupou em cada mês. Hoje ele não é apagado nunca.
            </p>
            <ul className="space-y-2">
              {historicoMeses.map((m) => (
                <li key={m.mes} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0" style={{ color: "var(--muted)" }}>
                    {m.mes.slice(5)}/{m.mes.slice(2, 4)}
                  </span>
                  <div
                    className="h-2 flex-1 overflow-hidden rounded-full"
                    style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(m.bytes / maiorMes) * 100}%`, background: "var(--secondary)" }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-semibold" style={{ color: "var(--foreground)" }}>
                    {formatarBytes(m.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </article>
    </section>
  );
}
