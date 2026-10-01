"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, ListTodo, Lightbulb, Plus, UserRound } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { codecs } from "@/lib/url-state";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { cn } from "@/lib/utils";
import { useTarefas } from "@/features/tarefas/TarefasProvider";
import {
  idsVistos,
  listarTarefas,
  mapaNomesUsuarios,
  mudarSituacaoTarefa,
  type AbaTarefas,
  type SituacaoFiltro
} from "@/features/tarefas/services/tarefas.service";
import type { Tarefa } from "@/features/tarefas/types";
import { NovaBadge, PrioridadeBadge, SituacaoBadge } from "@/features/tarefas/components/SituacaoBadge";
import { NovaTarefaModal } from "@/features/tarefas/components/NovaTarefaModal";
import { TarefaDetalheModal } from "@/features/tarefas/components/TarefaDetalheModal";
import {
  podeAssumir,
  podeConcluir,
  dataBR,
  prazoVencido,
  descreverDestino,
  ehNovaParaMim
} from "@/features/tarefas/lib/regras";

const ABAS = ["minhas", "criadas", "todas", "melhorias"] as const;
const SITUACOES = ["abertas", "encerradas"] as const;

const ROTULO_ABA: Record<AbaTarefas, string> = {
  minhas: "Minhas",
  criadas: "Criadas por mim",
  todas: "Todas",
  melhorias: "Melhorias"
};

export function TarefasPage() {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const { versao, recarregar } = useTarefas();
  const admin = Boolean(user?.isAdmin || user?.isSuperAdmin);
  const userId = user?.id ?? "";

  const schema = useMemo(
    () => ({
      aba: { codec: codecs.enumOf(ABAS), default: "minhas" as AbaTarefas },
      sit: { codec: codecs.enumOf(SITUACOES), default: "abertas" as SituacaoFiltro }
    }),
    []
  );
  const { filters, setFilter } = useUrlFilters(schema);
  // Aba de admin aberta por link por quem nao e admin: volta para Minhas.
  const aba: AbaTarefas = !admin && (filters.aba === "todas" || filters.aba === "melhorias") ? "minhas" : filters.aba;
  const situacao = filters.sit;

  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [vistas, setVistas] = useState<Set<number>>(new Set());
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [concluirId, setConcluirId] = useState<number | null>(null);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    void mapaNomesUsuarios().then((m) => vivo && setNomes(m));
    return () => {
      vivo = false;
    };
  }, [versao]);

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    Promise.resolve().then(() => vivo && setCarregando(true));
    listarTarefas({ aba, situacao, userId })
      .then(async (lista) => {
        const jaVistas = await idsVistos(userId, lista.map((t) => t.id));
        if (!vivo) return;
        setTarefas(lista);
        setVistas(jaVistas);
        setErro(null);
      })
      .catch((e: unknown) => vivo && setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [aba, situacao, userId, versao]);

  const nome = (id: string | null) => (id ? nomes.get(id) ?? "—" : "—");
  const abasVisiveis = ABAS.filter((a) => admin || (a !== "todas" && a !== "melhorias"));
  const ehMelhorias = aba === "melhorias";
  const alvoModal = tarefas.find((t) => t.id === (detalheId ?? concluirId)) ?? null;

  const assumir = async (t: Tarefa) => {
    setOcupadoId(t.id);
    const r = await mudarSituacaoTarefa(t.id, "assumir");
    setOcupadoId(null);
    if (!r.success) {
      showToast({ type: "error", title: "Não foi possível assumir", description: r.message });
      return;
    }
    showToast({ type: "success", title: "Tarefa assumida", description: `"${t.titulo}" agora está com você.` });
    recarregar();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tarefas"
        subtitle={
          ehMelhorias
            ? "Melhorias e ajustes do sistema pedidos pela diretoria ao DEV."
            : "Peça algo a um colega, acompanhe o que pediu e resolva o que chegou para você."
        }
        action={
          (!ehMelhorias || admin) && (
            <button
              type="button"
              onClick={() => setNovaAberta(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-white/25"
            >
              <Plus className="h-4 w-4" />
              {ehMelhorias ? "Nova melhoria" : "Nova tarefa"}
            </button>
          )
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Visões de tarefas">
          {abasVisiveis.map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              onClick={() => setFilter("aba", a)}
              className="rounded-xl border px-3.5 py-2 text-sm font-semibold transition"
              style={
                aba === a
                  ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }
                  : { background: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" }
              }
            >
              {ROTULO_ABA[a]}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-xl border p-0.5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          {SITUACOES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter("sit", s)}
              aria-pressed={situacao === s}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
              style={
                situacao === s
                  ? { background: "var(--background)", color: "var(--foreground)" }
                  : { color: "var(--muted)" }
              }
            >
              {s === "abertas" ? "Em aberto" : "Encerradas"}
            </button>
          ))}
        </div>
      </div>

      {erro ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          Não foi possível carregar as tarefas: {erro}
        </div>
      ) : carregando && tarefas.length === 0 ? (
        <div className="rounded-2xl border p-8 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          Carregando…
        </div>
      ) : tarefas.length === 0 ? (
        <EmptyState
          icon={ehMelhorias ? Lightbulb : ListTodo}
          title={situacao === "abertas" ? "Nada em aberto aqui" : "Nenhuma tarefa encerrada"}
          description={
            aba === "minhas"
              ? "Quando alguém pedir algo a você, a tarefa aparece aqui e no contador do menu."
              : ehMelhorias
                ? "Registre uma melhoria para o DEV no botão Nova melhoria."
                : "Use o botão Nova tarefa para pedir algo a um colega."
          }
        />
      ) : (
        <ul className="space-y-2.5" aria-label="Lista de tarefas">
          {tarefas.map((t) => {
            const vencido = prazoVencido(t);
            const acaoAssumir = podeAssumir(t, userId, admin);
            const acaoConcluir = !acaoAssumir && podeConcluir(t, userId, admin);
            return (
              <li
                key={t.id}
                data-tarefa-id={t.id}
                className="flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition sm:flex-row sm:items-center"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <button
                  type="button"
                  onClick={() => setDetalheId(t.id)}
                  className="min-w-0 flex-1 text-left"
                  aria-label={`Abrir tarefa ${t.titulo}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <PrioridadeBadge prioridade={t.prioridade} />
                    <span className="truncate text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                      {t.titulo}
                    </span>
                    <SituacaoBadge status={t.status} />
                    {ehNovaParaMim(t, userId, vistas) ? <NovaBadge /> : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="h-3.5 w-3.5" />
                      {descreverDestino(t, nome)}
                    </span>
                    <span>Pedida por {nome(t.criado_por_user_id)} em {dataBR(t.created_at)}</span>
                    {t.data_limite ? (
                      <span className={cn("inline-flex items-center gap-1", vencido && "font-semibold text-red-600 dark:text-red-400")}>
                        <CalendarClock className="h-3.5 w-3.5" />
                        Prazo {dataBR(t.data_limite)}
                        {vencido ? " (vencido)" : ""}
                      </span>
                    ) : null}
                    {t.status === "CONCLUIDA" && t.concluido_at ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Concluída por {nome(t.concluido_por_user_id)} em {dataBR(t.concluido_at)}
                      </span>
                    ) : null}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {t.id_int ? (
                    <Link
                      href={`/orcamentos/${t.id_int}`}
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "var(--border)", color: "var(--primary)" }}
                    >
                      Pedido {t.id_int}
                    </Link>
                  ) : null}
                  {t.id_cliente ? (
                    <Link
                      href={`/cadastros/${t.id_cliente}`}
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "var(--border)", color: "var(--primary)" }}
                    >
                      Cliente {t.id_cliente}
                    </Link>
                  ) : null}
                  {acaoAssumir ? (
                    <button
                      type="button"
                      disabled={ocupadoId === t.id}
                      onClick={() => void assumir(t)}
                      className="rounded-xl px-4 py-2 text-sm font-bold shadow-sm transition disabled:opacity-60"
                      style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                    >
                      {ocupadoId === t.id ? "Assumindo…" : "Assumir"}
                    </button>
                  ) : acaoConcluir ? (
                    <button
                      type="button"
                      onClick={() => setConcluirId(t.id)}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
                    >
                      Concluir
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {novaAberta ? (
        <NovaTarefaModal
          tipo={ehMelhorias ? "MELHORIA" : "TAREFA"}
          onFechar={() => setNovaAberta(false)}
          onCriada={() => {
            setNovaAberta(false);
            recarregar();
          }}
        />
      ) : null}

      {alvoModal ? (
        <TarefaDetalheModal
          tarefa={alvoModal}
          nomes={nomes}
          userId={userId}
          admin={admin}
          modoConcluir={concluirId !== null}
          onFechar={() => {
            setDetalheId(null);
            setConcluirId(null);
          }}
          onMudou={() => {
            setDetalheId(null);
            setConcluirId(null);
            recarregar();
          }}
        />
      ) : null}
    </div>
  );
}
