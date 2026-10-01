"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import { contarMinhas, listarNovas, mapaNomesUsuarios } from "@/features/tarefas/services/tarefas.service";
import { participaDasTarefas } from "@/features/tarefas/lib/participacao";
import type { NovidadeTipo, Tarefa } from "@/features/tarefas/types";

/**
 * Ponto unico do aviso de tarefas (spec 2026-09-30-tarefas-equipe-design.md).
 *
 * - `contagem`: minhas tarefas em aberto (assumidas por mim, ou recebidas e sem responsavel).
 * - `novas`: tarefas com novidade para mim, com o tipo — recebida que nunca abri,
 *   ou mensagem / assumir / concluir / cancelar de outra pessoa depois da minha
 *   ultima abertura. A regra mora no banco (`tarefas_equipe_novas`).
 * - `naoVistas`: quantas sao. > 0 faz o menu e a Topbar piscarem.
 * - `versao`: sobe a cada evento de tempo real; as telas recarregam quando muda.
 * - Um canal de tempo real so. O realtime aplica o RLS de quem escuta.
 */

type TarefasContexto = {
  /** Participo das Tarefas (perfil com `tarefas.participar`, e-mail que nao e de teste). */
  participa: boolean;
  contagem: number;
  naoVistas: number;
  novas: ReadonlyMap<number, NovidadeTipo>;
  versao: number;
  recarregar: () => void;
};

const SEM_NOVAS: ReadonlyMap<number, NovidadeTipo> = new Map();

const Contexto = createContext<TarefasContexto>({
  participa: false,
  contagem: 0,
  naoVistas: 0,
  novas: SEM_NOVAS,
  versao: 0,
  recarregar: () => {}
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function TarefasProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const userId = user?.id && UUID_RE.test(user.id) ? user.id : null;
  const participa = participaDasTarefas(user);
  const [contagem, setContagem] = useState(0);
  const [novas, setNovas] = useState<ReadonlyMap<number, NovidadeTipo>>(SEM_NOVAS);
  const [versao, setVersao] = useState(0);
  const nomesRef = useRef<Map<string, string> | null>(null);
  /** Ultima novidade ja avisada por tarefa: evita toast repetido do mesmo evento. */
  const avisadasRef = useRef<Map<number, string>>(new Map());

  const contar = useCallback(async (): Promise<ReadonlyMap<number, NovidadeTipo>> => {
    if (!userId) return SEM_NOVAS;
    const [minhas, mapa] = await Promise.all([contarMinhas(), listarNovas()]);
    setContagem(minhas);
    setNovas(mapa);
    return mapa;
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
        setVersao((v) => v + 1);

        const t = payload.new as Partial<Tarefa> | null;
        const tipo = t?.novidade_tipo ?? null;
        const marca = t?.novidade_em ?? null;

        // Sem novidade no evento (ex.: vinculo apagado) ou acao minha: so recarrega.
        if (!t || !t.id || !t.titulo || !tipo || !marca || t.novidade_por_user_id === userId) {
          void contar();
          return;
        }
        if (avisadasRef.current.get(t.id) === marca) {
          void contar();
          return;
        }

        // Quem decide se a novidade e para mim e o banco: so aviso se a tarefa
        // entrou na minha lista de novas (participante, e nao fui eu quem fez).
        const avisar = async () => {
          const mapa = await contar();
          if (!mapa.has(t.id as number)) return;
          avisadasRef.current.set(t.id as number, marca);
          const nome = await nomeDe(t.novidade_por_user_id ?? null);
          const titulo = `"${t.titulo}"`;

          if (tipo === "CRIADA") {
            const urgente = t.prioridade === "URGENTE" ? "URGENTE: " : "";
            showToast({
              type: t.prioridade === "URGENTE" ? "warning" : "info",
              title: t.para_todos ? "Nova tarefa para todos" : "Nova tarefa para você",
              description: `${urgente}${nome} pediu: ${titulo}.`,
              // Aviso de tarefa nova fica mais que o padrao (2,6 s) para dar tempo de ler.
              duration: 8000,
              onClick: irParaTarefas
            });
          } else if (tipo === "MENSAGEM") {
            showToast({
              type: "info",
              title: "Nova mensagem na tarefa",
              description: `${nome} escreveu em ${titulo}.`,
              duration: 8000,
              onClick: irParaTarefas
            });
          } else if (tipo === "ASSUMIDA") {
            showToast({ type: "info", title: "Tarefa assumida", description: `${nome} assumiu ${titulo}.`, duration: 6000, onClick: irParaTarefas });
          } else if (tipo === "CONCLUIDA") {
            showToast({ type: "success", title: "Tarefa concluída", description: `${nome} concluiu ${titulo}.`, duration: 6000, onClick: irParaTarefas });
          } else if (tipo === "CANCELADA") {
            showToast({ type: "info", title: "Tarefa cancelada", description: `${nome} cancelou ${titulo}.`, duration: 6000, onClick: irParaTarefas });
          }
        };
        void avisar();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, contar, nomeDe, showToast]);

  return (
    <Contexto.Provider value={{ participa, contagem, naoVistas: novas.size, novas, versao, recarregar }}>
      {children}
    </Contexto.Provider>
  );
}

export function useTarefas() {
  return useContext(Contexto);
}
