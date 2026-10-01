"use client";

import { useEffect, useState } from "react";
import { ListTodo, Plus } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTarefas } from "@/features/tarefas/TarefasProvider";
import { listarTarefasDoPedido, mapaNomesUsuarios } from "@/features/tarefas/services/tarefas.service";
import type { Tarefa } from "@/features/tarefas/types";
import { dataBR, descreverDestino } from "@/features/tarefas/lib/regras";
import { NovaBadge, PrioridadeBadge, SituacaoBadge } from "@/features/tarefas/components/SituacaoBadge";
import { NovaTarefaModal } from "@/features/tarefas/components/NovaTarefaModal";
import { TarefaDetalheModal } from "@/features/tarefas/components/TarefaDetalheModal";

/**
 * Area "Tarefas deste pedido" na proposta (spec 2026-09-30-tarefas-equipe-design.md).
 * Lista as tarefas com este `id_int` que o usuario pode ver e abre a Nova
 * tarefa com pedido e cliente ja preenchidos.
 */
export function TarefasDoPedido({
  idInt,
  idCliente,
  variante = "cartao",
  onContagem
}: {
  idInt: number;
  idCliente: number | null;
  /** "painel" = dentro da aba Tarefas do chat da proposta (sem moldura, altura cheia). */
  variante?: "cartao" | "painel";
  /** Avisa quantas tarefas deste pedido estao em aberto (selo da aba do chat). */
  onContagem?: (ativas: number) => void;
}) {
  const { user } = useAuth();
  const { versao, recarregar, novas } = useTarefas();
  const userId = user?.id ?? "";
  const admin = Boolean(user?.isAdmin || user?.isSuperAdmin);

  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());
  const [novaAberta, setNovaAberta] = useState(false);
  const [abertaId, setAbertaId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    Promise.all([listarTarefasDoPedido(idInt), mapaNomesUsuarios()])
      .then(([lista, mapa]) => {
        if (!vivo) return;
        setTarefas(lista);
        setNomes(mapa);
        setErro(null);
      })
      .catch(() => vivo && setErro("Não foi possível carregar as tarefas deste pedido."));
    return () => {
      vivo = false;
    };
  }, [idInt, userId, versao]);

  const nome = (id: string | null) => (id ? nomes.get(id) ?? "—" : "—");
  const aberta = tarefas.find((t) => t.id === abertaId) ?? null;
  const ativas = tarefas.filter((t) => t.status === "ABERTA" || t.status === "EM_ANDAMENTO").length;

  useEffect(() => {
    onContagem?.(ativas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativas]);

  return (
    <section
      aria-label="Tarefas deste pedido"
      className={variante === "painel" ? "h-full overflow-y-auto px-4 py-3" : "mb-4 rounded-2xl border px-4 py-3"}
      style={variante === "painel" ? { color: "var(--foreground)" } : { background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          <ListTodo className="h-4 w-4" />
          Tarefas deste pedido
          {tarefas.length > 0 ? (
            <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>
              {ativas} em aberto de {tarefas.length}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={() => setNovaAberta(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-sm"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Plus className="h-3.5 w-3.5" />
          Nova tarefa
        </button>
      </div>

      {erro ? <p className="mt-2 text-xs text-red-600">{erro}</p> : null}

      {tarefas.length === 0 && variante === "painel" && !erro ? (
        <p className="mt-6 text-center text-xs" style={{ color: "var(--muted)" }}>
          Nenhuma tarefa neste pedido. Use Nova tarefa para pedir algo a um colega.
        </p>
      ) : null}

      {tarefas.length > 0 ? (
        <ul className="mt-2.5 divide-y" style={{ borderColor: "var(--border)" }}>
          {tarefas.map((t) => (
            <li key={t.id} data-tarefa-id={t.id}>
              <button
                type="button"
                onClick={() => setAbertaId(t.id)}
                className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm"
              >
                <PrioridadeBadge prioridade={t.prioridade} />
                <span className="min-w-0 flex-1 truncate font-medium">{t.titulo}</span>
                {novas.has(t.id) ? <NovaBadge tipo={novas.get(t.id)} /> : null}
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {descreverDestino(t, nome)} · {dataBR(t.created_at)}
                </span>
                <SituacaoBadge status={t.status} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {novaAberta ? (
        <NovaTarefaModal
          tipo="TAREFA"
          padrao={{ idInt, idCliente }}
          onFechar={() => setNovaAberta(false)}
          onCriada={() => {
            setNovaAberta(false);
            recarregar();
          }}
        />
      ) : null}

      {aberta ? (
        <TarefaDetalheModal
          tarefa={aberta}
          nomes={nomes}
          userId={userId}
          admin={admin}
          modoConcluir={false}
          onFechar={() => setAbertaId(null)}
          onMudou={() => {
            setAbertaId(null);
            recarregar();
          }}
        />
      ) : null}
    </section>
  );
}
