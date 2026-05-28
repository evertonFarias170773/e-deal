"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProdutoFormPage } from "@/features/produtos/ProdutoFormPage";
import { getProdutoByIdProduto } from "@/features/produtos/services/produtos.service";
import type { Produto } from "@/features/produtos/types";

type ProdutoFormRouteClientProps = {
  idProduto: number;
};

export function ProdutoFormRouteClient({ idProduto }: ProdutoFormRouteClientProps) {
  const [produto, setProduto] = useState<Produto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      setHasError(false);

      const loadedProduto = await getProdutoByIdProduto(idProduto);
      if (!active) {
        return;
      }

      setProduto(loadedProduto);
      setHasError(!loadedProduto);
      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [idProduto]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-32 animate-pulse rounded-3xl border border-slate-200 bg-white" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-3xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-3xl border border-slate-200 bg-white" />
      </div>
    );
  }

  if (hasError || !produto) {
    return (
      <section className="rounded-3xl border border-orange-200 bg-orange-50 p-6 text-orange-800">
        <h1 className="text-lg font-semibold">Produto não encontrado</h1>
        <p className="mt-2 text-sm">
          Não foi possível carregar este produto em public.produtos. A edição real continua bloqueada nesta etapa.
        </p>
        <Link
          href="/produtos"
          className="mt-4 inline-flex rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Voltar para produtos
        </Link>
      </section>
    );
  }

  return <ProdutoFormPage mode="edit" produto={produto} />;
}
