"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  buildSearchString,
  parseSearchParams,
  type UrlFiltersSchema,
  type ValoresDe
} from "@/lib/url-state";

type Opcoes<S extends UrlFiltersSchema> = {
  /** Chave da página. Volta ao padrão sempre que outro filtro muda. */
  pageKey?: Extract<keyof S, string>;
  /** Restringe quais filtros zeram a página. Padrão: todos, menos a própria `pageKey`. */
  resetPageOn?: Array<Extract<keyof S, string>>;
};

export type UseUrlFiltersRetorno<S extends UrlFiltersSchema> = {
  /** Valores atuais, derivados da URL (nunca um estado paralelo). */
  filters: ValoresDe<S>;
  setFilter: <K extends keyof S>(chave: K, valor: ValoresDe<S>[K]) => void;
  setFilters: (parcial: Partial<ValoresDe<S>>) => void;
  /** Remove da URL todos os parâmetros do schema — e apenas eles. */
  clearFilters: () => void;
  /** Verdadeiro quando algum filtro está fora do padrão. */
  hasActiveFilters: boolean;
};

/**
 * Mantém os filtros da tela na URL.
 *
 * A URL manda: ao abrir a tela, atualizar a página ou usar o histórico do navegador,
 * os valores vêm dela. Enquanto o usuário permanece na tela, uma cópia local da query
 * acompanha as trocas de filtro.
 *
 * A escrita usa `window.history.replaceState` e atualiza essa cópia. Duas medições
 * explicam a combinação: `history.replaceState` sempre atualiza a barra de endereços,
 * mas não reprocessa `useSearchParams` — daí a cópia local, que faz a tela reagir na
 * hora; já `router.replace` reprocessa, porém em telas com carga de dados ele é
 * engolido quando a página foi aberta direto por um link com parâmetros, e o usuário
 * fica sem conseguir trocar de filtro. A combinação atual não depende de transição de
 * rota e funciona nos dois casos, sem empilhar histórico a cada tecla digitada.
 *
 * A cópia local vale só até a URL mudar por fora — link novo, voltar ou avançar —,
 * quando a leitura volta a sair da própria URL.
 *
 * Efeito colateral a conhecer: um `useSearchParams` lido fora deste hook, na mesma
 * tela, não enxerga as trocas de filtro até a próxima navegação real.
 *
 * Passe um `schema` memorizado (`useMemo`) quando ele tiver padrões calculados, como
 * o mês corrente; os valores são recalculados quando esses padrões mudam.
 *
 * Exemplo:
 * ```ts
 * const { filters, setFilter, clearFilters } = useUrlFilters({
 *   q: { codec: codecs.texto(), default: "" },
 *   aba: { codec: codecs.enumOf(["CARTEIRA", "BOLETOS"] as const), default: "CARTEIRA" },
 *   pag: { codec: codecs.numero({ min: 1 }), default: 1 }
 * }, { pageKey: "pag" });
 * ```
 */
export function useUrlFilters<S extends UrlFiltersSchema>(
  schema: S,
  opcoes?: Opcoes<S>
): UseUrlFiltersRetorno<S> {
  const searchParams = useSearchParams();
  const pageKey = opcoes?.pageKey;
  const resetPageOn = opcoes?.resetPageOn;

  const queryDaUrl = searchParams?.toString() ?? "";

  // Cópia local da query, válida apenas enquanto a URL de origem continuar a mesma.
  // Guardar a origem junto dispensa sincronização: quando a URL muda por fora (link
  // novo, voltar/avançar do navegador), a cópia deixa de valer sozinha.
  const [copiaLocal, setCopiaLocal] = useState<{ origem: string; query: string } | null>(null);
  const queryEfetiva = copiaLocal?.origem === queryDaUrl ? copiaLocal.query : queryDaUrl;

  const filters = useMemo(
    () => parseSearchParams(schema, new URLSearchParams(queryEfetiva)),
    [schema, queryEfetiva]
  );

  const hasActiveFilters = useMemo(
    () =>
      Object.keys(schema).some(
        (chave) => JSON.stringify(filters[chave]) !== JSON.stringify(schema[chave].default)
      ),
    [schema, filters]
  );

  /**
   * Ponto único de escrita da URL.
   *
   * Parte de `window.location.search`, que `replaceState` já deixou atualizado — por
   * isso duas alterações seguidas no mesmo ciclo não se sobrescrevem.
   */
  const aplicar = useCallback(
    (parcial: Partial<ValoresDe<S>>) => {
      if (typeof window === "undefined") return;

      const query = buildSearchString(schema, parcial, window.location.search);
      const destino = `${window.location.pathname}${query}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", destino);
      setCopiaLocal({ origem: queryDaUrl, query: query.startsWith("?") ? query.slice(1) : query });
    },
    [schema, queryDaUrl]
  );

  const setFilters = useCallback(
    (parcial: Partial<ValoresDe<S>>) => {
      const chavesAlteradas = Object.keys(parcial) as Array<Extract<keyof S, string>>;

      // Filtro novo com a lista já paginada: a página volta ao início na mesma
      // escrita, evitando um passo intermediário em página inexistente.
      const deveZerarPagina =
        pageKey !== undefined &&
        chavesAlteradas.some(
          (chave) => chave !== pageKey && (resetPageOn ? resetPageOn.includes(chave) : true)
        );

      const alvo: Partial<ValoresDe<S>> = deveZerarPagina
        ? { ...parcial, [pageKey]: schema[pageKey].default }
        : parcial;

      aplicar(alvo);
    },
    [aplicar, schema, pageKey, resetPageOn]
  );

  const setFilter = useCallback(
    <K extends keyof S>(chave: K, valor: ValoresDe<S>[K]) => {
      setFilters({ [chave]: valor } as Partial<ValoresDe<S>>);
    },
    [setFilters]
  );

  const clearFilters = useCallback(() => {
    const padroes = {} as Partial<ValoresDe<S>>;
    for (const chave of Object.keys(schema)) {
      padroes[chave as keyof S] = schema[chave].default;
    }
    aplicar(padroes);
  }, [aplicar, schema]);

  return { filters, setFilter, setFilters, clearFilters, hasActiveFilters };
}
