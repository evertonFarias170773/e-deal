"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useProdutosReadOnlyData } from "@/features/produtos/hooks/useProdutosReadOnlyData";
import { globalSearchResultsMock } from "@/lib/mocks/global-search.mock";
import type { GlobalSearchResult } from "@/lib/types";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { produtos } = useProdutosReadOnlyData();

  const results = useMemo(() => {
    const normalizedQuery = normalize(query.trim());

    if (!normalizedQuery) {
      return [];
    }

    const produtoResults: GlobalSearchResult[] = produtos.map((produto) => ({
      id: `produto-${produto.id_produto}`,
      type: "Produto",
      title: produto.nomeReal,
      description: `Produto #${produto.id_produto} - ${produto.categoria} - ${produto.formato}`,
      href: `/produtos/${produto.id_produto}`
    }));

    return [...globalSearchResultsMock.filter((result) => result.type !== "Produto"), ...produtoResults].filter((result) =>
      normalize(`${result.type} ${result.title} ${result.description}`).includes(normalizedQuery)
    );
  }, [produtos, query]);

  const shouldShowResults = isFocused && query.trim().length > 0;

  return (
    <div className="relative hidden flex-1 md:block">
      <label
        className="flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm shadow-sm"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--muted)"
        }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--secondary)" }} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (blurTimeoutRef.current) {
              clearTimeout(blurTimeoutRef.current);
            }
            setIsFocused(true);
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setIsFocused(false), 150);
          }}
          className="w-full bg-transparent text-sm outline-none"
          style={{
            color: "var(--foreground)"
          }}
          placeholder="Buscar cliente, proposta, pedido, OS, boleto, nota fiscal ou documento"
        />
      </label>

      {shouldShowResults ? (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl p-2 shadow-xl"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)"
          }}
        >
          {results.length ? (
            <div className="max-h-80 overflow-y-auto">
              {results.map((result) => (
                <Link
                  key={result.id}
                  href={result.href}
                  className="flex gap-3 rounded-xl px-3 py-3 transition"
                  style={{ color: "var(--foreground)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "var(--card-hover)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                  }}
                  onClick={() => {
                    setQuery("");
                    setIsFocused(false);
                  }}
                >
                  <span
                    className="h-fit rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={{
                      background: "color-mix(in srgb, var(--secondary) 15%, transparent)",
                      color: "var(--secondary)"
                    }}
                  >
                    {result.type}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold" style={{ color: "var(--foreground)" }}>{result.title}</span>
                    <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>{result.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div
              className="rounded-xl px-4 py-5 text-sm"
              style={{ background: "var(--background)", color: "var(--muted)" }}
            >
              Nenhum resultado encontrado.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
