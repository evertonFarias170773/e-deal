"use client";

import { useTarefas } from "@/features/tarefas/TarefasProvider";
import type { NavigationSection } from "@/lib/types";

type Contador = { valor: number; piscando: boolean };

/** O que mostrar ao lado de uma secao do menu (hoje so "tarefas"). */
export function useContadorSecao(contador: NavigationSection["contador"]): Contador {
  const { contagem, naoVistas } = useTarefas();
  return contador === "tarefas" ? { valor: contagem, piscando: naoVistas > 0 } : { valor: 0, piscando: false };
}

/**
 * Bolinha com o numero. Pisca enquanto houver tarefa recebida e nao aberta;
 * se o numero for zero mas houver nao aberta (ex.: outra pessoa ja assumiu),
 * mostra so o ponto piscando. Some quando nao ha nada.
 */
export function ContadorMenu({ valor, piscando, flutuante = false }: Contador & { flutuante?: boolean }) {
  if (valor <= 0 && !piscando) return null;
  const texto = valor > 99 ? "99+" : valor > 0 ? String(valor) : "";
  const posicao = flutuante ? "absolute -right-1 -top-1" : "ml-auto";
  const tamanho = texto ? "h-5 min-w-5 px-1.5" : "h-2.5 w-2.5";
  return (
    <span
      data-tarefas-piscando={piscando ? "sim" : "nao"}
      aria-label={piscando ? "Há tarefa nova não aberta" : `${valor} tarefa(s) em aberto`}
      className={`${posicao} ${tamanho} flex items-center justify-center rounded-full bg-amber-600 text-[11px] font-bold text-white ${
        piscando ? "animate-pulse ring-2 ring-amber-300" : ""
      }`}
    >
      {texto}
    </span>
  );
}
