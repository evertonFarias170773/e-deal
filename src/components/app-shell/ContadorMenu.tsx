"use client";

import { useTarefas } from "@/features/tarefas/TarefasProvider";
import type { NavigationSection } from "@/lib/types";

/** Quanto mostrar ao lado de uma secao do menu (hoje so "tarefas"). */
export function useContadorSecao(contador: NavigationSection["contador"]): number {
  const { contagem } = useTarefas();
  return contador === "tarefas" ? contagem : 0;
}

/** Bolinha com o numero. Some quando e zero. */
export function ContadorMenu({ valor, flutuante = false }: { valor: number; flutuante?: boolean }) {
  if (valor <= 0) return null;
  const texto = valor > 99 ? "99+" : String(valor);
  return (
    <span
      aria-label={`${valor} em aberto`}
      className={
        flutuante
          ? "absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold text-white"
          : "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 text-[11px] font-bold text-white"
      }
    >
      {texto}
    </span>
  );
}
