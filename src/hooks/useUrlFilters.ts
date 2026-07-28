"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
 * A URL é a única fonte de verdade: os valores são derivados de `useSearchParams`,
 * então não existe estado espelhado para sincronizar — e, por consequência, não há
 * laço de atualização. Voltar e avançar no navegador funcionam sem código extra,
 * porque a própria mudança de URL redispara a leitura.
 *
 * A escrita usa `router.replace` com `scroll: false`: troca a URL sem recarregar a
 * página e sem empilhar uma entrada de histórico a cada tecla digitada. Foi medido
 * nesta versão do Next que `window.history.replaceState` altera a barra de endereço
 * mas **não** reprocessa `useSearchParams`, o que deixaria a tela exibindo filtros
 * diferentes dos que estão na URL. Toda escrita passa por `aplicar`, então rever essa
 * decisão é mexer em um ponto só, sem tocar nas telas.
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
  const router = useRouter();
  const pathname = usePathname();
  const pageKey = opcoes?.pageKey;
  const resetPageOn = opcoes?.resetPageOn;

  const filters = useMemo(
    () => parseSearchParams(schema, new URLSearchParams(searchParams?.toString() ?? "")),
    [schema, searchParams]
  );

  const hasActiveFilters = useMemo(
    () =>
      Object.keys(schema).some(
        (chave) => JSON.stringify(filters[chave]) !== JSON.stringify(schema[chave].default)
      ),
    [schema, filters]
  );

  // Última query que nós mesmos escrevemos. A navegação do router não é imediata,
  // então ela serve de base enquanto a URL não acompanha — é o que permite duas
  // alterações seguidas no mesmo ciclo sem uma sobrescrever a outra.
  const ultimaQueryRef = useRef<string | null>(null);

  useEffect(() => {
    // A URL alcançou o que escrevemos (ou mudou por fora, no histórico): a partir
    // daqui a própria barra de endereço volta a ser a base confiável.
    ultimaQueryRef.current = null;
  }, [searchParams]);

  /** Ponto único de escrita da URL. */
  const aplicar = useCallback(
    (parcial: Partial<ValoresDe<S>>) => {
      if (typeof window === "undefined") return;

      const base = ultimaQueryRef.current ?? window.location.search;
      const query = buildSearchString(schema, parcial, base);
      ultimaQueryRef.current = query;
      router.replace(`${pathname}${query}`, { scroll: false });
    },
    [schema, router, pathname]
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
