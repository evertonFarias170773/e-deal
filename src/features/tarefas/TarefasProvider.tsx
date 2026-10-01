"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import { mapaNomesUsuarios, resumoTarefas, souDestinatario } from "@/features/tarefas/services/tarefas.service";
import { participaDasTarefas } from "@/features/tarefas/lib/participacao";
import type { Tarefa } from "@/features/tarefas/types";

/**
 * Ponto unico do aviso de tarefas (spec 2026-09-30-tarefas-equipe-design.md).
 *
 * - `contagem`: minhas tarefas em aberto (assumidas por mim, ou recebidas e sem responsavel).
 * - `naoVistas`: recebidas por mim que ainda nao abri. > 0 faz o menu e a Topbar piscarem.
 * - `versao`: sobe a cada evento de tempo real; as telas recarregam quando muda.
 * - Um canal de tempo real so. O realtime aplica o RLS de quem escuta.
 */

type TarefasContexto = {
  /** Participo das Tarefas (perfil com `tarefas.participar`, e-mail que nao e de teste). */
  participa: boolean;
  contagem: number;
  naoVistas: number;
  versao: number;
  recarregar: () => void;
};

const Contexto = createContext<TarefasContexto>({ participa: false, contagem: 0, naoVistas: 0, versao: 0, recarregar: () => {} });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function TarefasProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const userId = user?.id && UUID_RE.test(user.id) ? user.id : null;
  const participa = participaDasTarefas(user);
  const [contagem, setContagem] = useState(0);
  const [naoVistas, setNaoVistas] = useState(0);
  const [versao, setVersao] = useState(0);
  const nomesRef = useRef<Map<string, string> | null>(null);

  const contar = useCallback(async () => {
    if (!userId) return;
    const r = await resumoTarefas();
    setContagem(r.minhas);
    setNaoVistas(r.naoVistas);
  }, [userId]);

  const recarregar = useCallback(() => {
    void contar();
    setVersao((v) => v + 1);
  }, [contar]);

  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => void contar(), 0);
    return () => clearTimeout(timer);
  }, [userId, contar]);

  const nomeDe = useCallback(async (id: string | null) => {
    if (!id) return "alguém";
    if (!nomesRef.current || !nomesRef.current.has(id)) nomesRef.current = await mapaNomesUsuarios();
    return nomesRef.current.get(id) ?? "alguém";
  }, []);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const irParaTarefas = () => {
      window.location.href = "/tarefas";
    };

    const channel = supabase
      .channel(`tarefas_equipe_${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tarefas_equipe" }, (payload) => {
        void contar();
        setVersao((v) => v + 1);

        const t = payload.new as Partial<Tarefa> | null;
        if (!t || !t.titulo || !t.id) return;

        if (payload.eventType === "INSERT") {
          if (t.criado_por_user_id === userId || t.tipo !== "TAREFA") return;
          // Admin enxerga tudo; toast so para quem recebeu.
          const avisar = async () => {
            // "Para todos" so avisa quem participa das Tarefas.
            const minha = t.para_todos ? participa : await souDestinatario(t.id as number, userId);
            if (!minha) return;
            const nome = await nomeDe(t.criado_por_user_id ?? null);
            const urgente = t.prioridade === "URGENTE" ? "URGENTE: " : "";
            showToast({
              type: t.prioridade === "URGENTE" ? "warning" : "info",
              title: t.para_todos ? "Nova tarefa para todos" : "Nova tarefa para você",
              description: `${urgente}${nome} pediu: "${t.titulo}".`,
              // Aviso de tarefa nova fica mais que o padrao (2,6 s) para dar tempo de ler.
              duration: 8000,
              onClick: irParaTarefas
            });
          };
          void avisar();
          return;
        }
        if (payload.eventType !== "UPDATE") return;

        if (t.status === "EM_ANDAMENTO" && t.criado_por_user_id === userId && t.assumido_por_user_id !== userId) {
          void nomeDe(t.assumido_por_user_id ?? null).then((nome) =>
            showToast({ type: "info", title: "Tarefa assumida", description: `${nome} assumiu "${t.titulo}".` })
          );
        } else if (t.status === "CONCLUIDA" && t.criado_por_user_id === userId && t.concluido_por_user_id !== userId) {
          void nomeDe(t.concluido_por_user_id ?? null).then((nome) =>
            showToast({
              type: "success",
              title: "Tarefa concluída",
              description: `${nome} concluiu "${t.titulo}".`,
              onClick: irParaTarefas
            })
          );
        } else if (
          t.status === "CANCELADA" &&
          t.cancelado_por_user_id !== userId &&
          (t.responsavel_user_id === userId || t.criado_por_user_id === userId)
        ) {
          void nomeDe(t.cancelado_por_user_id ?? null).then((nome) =>
            showToast({ type: "info", title: "Tarefa cancelada", description: `${nome} cancelou "${t.titulo}".` })
          );
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, participa, contar, nomeDe, showToast]);

  return <Contexto.Provider value={{ participa, contagem, naoVistas, versao, recarregar }}>{children}</Contexto.Provider>;
}

export function useTarefas() {
  return useContext(Contexto);
}
