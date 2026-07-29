"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Preferência visual da tela, guardada na sessão do navegador.
 *
 * Serve para o que **não** faz sentido em um link compartilhado: modo compacto,
 * tela cheia, grupos recolhidos. Filtros de dados nunca entram aqui — eles vão
 * para a URL, pelo `useUrlFilters`.
 *
 * O valor vale enquanto a aba estiver aberta e não viaja em um link copiado.
 *
 * Convenção de chave: `ui:<rota>:<nome>` — por exemplo `ui:/expedicao:compacto`.
 *
 * A leitura usa `useSyncExternalStore`, então a renderização no servidor e a
 * hidratação partem do valor inicial e só depois assumem o que está guardado,
 * sem divergência de marcação.
 */

type Ouvinte = () => void;

const ouvintes = new Map<string, Set<Ouvinte>>();

function avisar(chave: string) {
  ouvintes.get(chave)?.forEach((ouvinte) => ouvinte());
}

function lerBruto(chave: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(chave);
  } catch {
    // sessionStorage pode estar indisponível (modo restrito do navegador)
    return null;
  }
}

export function useSessionState<T>(
  chave: string,
  inicial: T
): [T, (valor: T | ((anterior: T) => T)) => void] {
  const assinar = useCallback(
    (aoMudar: Ouvinte) => {
      const atuais = ouvintes.get(chave) ?? new Set<Ouvinte>();
      atuais.add(aoMudar);
      ouvintes.set(chave, atuais);
      return () => {
        atuais.delete(aoMudar);
        if (atuais.size === 0) ouvintes.delete(chave);
      };
    },
    [chave]
  );

  const bruto = useSyncExternalStore(
    assinar,
    () => lerBruto(chave),
    () => null
  );

  const valor = useMemo(() => {
    if (bruto === null) return inicial;
    try {
      return JSON.parse(bruto) as T;
    } catch {
      return inicial;
    }
    // `inicial` costuma ser um literal estável (false, "", 0). Passe um valor
    // memorizado se for objeto.
  }, [bruto, inicial]);

  const definir = useCallback(
    (proximo: T | ((anterior: T) => T)) => {
      if (typeof window === "undefined") return;

      const anterior = (() => {
        const atual = lerBruto(chave);
        if (atual === null) return inicial;
        try {
          return JSON.parse(atual) as T;
        } catch {
          return inicial;
        }
      })();

      const resolvido =
        typeof proximo === "function" ? (proximo as (anterior: T) => T)(anterior) : proximo;

      try {
        window.sessionStorage.setItem(chave, JSON.stringify(resolvido));
      } catch {
        // sem sessionStorage a preferência simplesmente não persiste
      }
      avisar(chave);
    },
    [chave, inicial]
  );

  return [valor, definir];
}
