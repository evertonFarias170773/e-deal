"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { globalSearchResultsMock } from "@/lib/mocks/global-search.mock";

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

  const results = useMemo(() => {
    const normalizedQuery = normalize(query.trim());

    if (!normalizedQuery) {
      return [];
    }

    return globalSearchResultsMock.filter((result) =>
      normalize(`${result.type} ${result.title} ${result.description}`).includes(normalizedQuery)
    );
  }, [query]);

  const shouldShowResults = isFocused && query.trim().length > 0;

  return (
    <div className="relative hidden flex-1 md:block">
      <label className="flex items-center gap-3 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-2.5 text-sm text-slate-400 shadow-sm">
        <Search className="h-4 w-4 text-[#0f9f9a]" />
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
          className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          placeholder="Buscar cliente, proposta, pedido, OS, boleto, nota fiscal ou documento"
        />
      </label>

      {shouldShowResults ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-xl shadow-slate-900/10">
          {results.length ? (
            <div className="max-h-80 overflow-y-auto">
              {results.map((result) => (
                <Link
                  key={result.id}
                  href={result.href}
                  className="flex gap-3 rounded-2xl px-3 py-3 transition hover:bg-[#f3f7f8]"
                  onClick={() => {
                    setQuery("");
                    setIsFocused(false);
                  }}
                >
                  <span className="h-fit rounded-full bg-[#dff8f6] px-2.5 py-1 text-xs font-semibold text-[#0b7774]">
                    {result.type}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{result.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{result.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
              Nenhum resultado mockado encontrado.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
