"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, ImageIcon, Package, Search, SlidersHorizontal } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { useProdutosReadOnlyData } from "@/features/produtos/hooks/useProdutosReadOnlyData";
import type { Produto, ProdutoCategoria } from "@/features/produtos/types";

type StatusFilter = "TODOS" | "ATIVO" | "INATIVO";
type BooleanFilter = "TODOS" | "SIM" | "NAO";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function produtoMatchesSearch(produto: Produto, search: string) {
  const normalizedSearch = normalize(search.trim());

  if (!normalizedSearch) {
    return true;
  }

  const searchable = [
    produto.id_produto.toString(),
    produto.nomeReal,
    produto.categoria,
    produto.formato,
    produto.descricao,
    produto.apelidos.join(" ")
  ]
    .map(normalize)
    .join(" ");

  return searchable.includes(normalizedSearch);
}

export function ProdutosListPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { produtos, source, warnings, resumo, categorias, isLoading } = useProdutosReadOnlyData();
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState<"TODAS" | ProdutoCategoria>("TODAS");
  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [hasVariacoes, setHasVariacoes] = useState<BooleanFilter>("TODOS");
  const [hasFotos, setHasFotos] = useState<BooleanFilter>("TODOS");
  const [isEstoque, setIsEstoque] = useState<BooleanFilter>("TODOS");

  const categoriaOptions = useMemo(
    () => Array.from(new Set([...categorias, ...produtos.map((produto) => produto.categoria)])).filter(Boolean),
    [categorias, produtos]
  );

  const filteredProdutos = useMemo(() => {
    return produtos.filter((produto) => {
      const matchesSearch = produtoMatchesSearch(produto, search);
      const matchesCategoria = categoria === "TODAS" || produto.categoria === categoria;
      const matchesStatus =
        status === "TODOS" ||
        (status === "ATIVO" && produto.ativo) ||
        (status === "INATIVO" && !produto.ativo);
      const matchesVariacoes =
        hasVariacoes === "TODOS" ||
        (hasVariacoes === "SIM" && produto.is_variacao) ||
        (hasVariacoes === "NAO" && !produto.is_variacao);
      const matchesFotos =
        hasFotos === "TODOS" ||
        (hasFotos === "SIM" && produto.fotos.length > 0) ||
        (hasFotos === "NAO" && produto.fotos.length === 0);
      const matchesEstoque =
        isEstoque === "TODOS" ||
        (isEstoque === "SIM" && produto.is_estoque) ||
        (isEstoque === "NAO" && !produto.is_estoque);

      return matchesSearch && matchesCategoria && matchesStatus && matchesVariacoes && matchesFotos && matchesEstoque;
    });
  }, [categoria, hasFotos, hasVariacoes, isEstoque, produtos, search, status]);

  const activeFilters = [
    search ? `Busca: ${search}` : null,
    categoria !== "TODAS" ? `Categoria: ${categoria}` : null,
    status !== "TODOS" ? `Status: ${status}` : null,
    hasVariacoes !== "TODOS" ? `Variações: ${hasVariacoes === "SIM" ? "Sim" : "Não"}` : null,
    hasFotos !== "TODOS" ? `Fotos: ${hasFotos === "SIM" ? "Sim" : "Não"}` : null,
    isEstoque !== "TODOS" ? `Estoque: ${isEstoque === "SIM" ? "Sim" : "Não"}` : null
  ].filter(Boolean);

  function clearFilters() {
    setSearch("");
    setCategoria("TODAS");
    setStatus("TODOS");
    setHasVariacoes("TODOS");
    setHasFotos("TODOS");
    setIsEstoque("TODOS");
  }

  function showMockAction(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  function getActions(produto: Produto) {
    return [
      { label: "Ver produto", onClick: () => router.push(`/produtos/${produto.id_produto}`) },
      { label: "Editar produto", onClick: () => router.push(`/produtos/${produto.id_produto}/editar`) },
      { label: "Gerenciar fotos", onClick: () => router.push(`/produtos/${produto.id_produto}/editar#fotos`) },
      { label: "Gerenciar variacoes", onClick: () => router.push(`/produtos/${produto.id_produto}/editar#variacoes`) },
      { label: "Testar no Maestro", onClick: () => showMockAction("Teste no Maestro") },
      { label: "Duplicar produto", onClick: () => showMockAction("Duplicar produto") },
      { label: "Inativar produto", destructive: true, onClick: () => showMockAction("Inativar produto") }
    ];
  }

  return (
    <div className="space-y-6" data-produtos-source={source}>
      <PageHeader
        title="Produtos"
        subtitle="Gerencie o catalogo usado por propostas, Maestro, producao, fotos e variacoes."
        context="Produtos / Catalogo"
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push("/produtos/variacoes")}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Ver variações
            </button>
            <button
              type="button"
              onClick={() => router.push("/produtos/variacoes/nova")}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              + Nova variação
            </button>
            <button
              type="button"
              onClick={() => router.push("/produtos/novo")}
              className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
            >
              + Novo produto
            </button>
          </div>
        }
      />

      {isLoading ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white" />
          ))}
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Produtos ativos" value={resumo.ativos.toString()} description="Itens disponiveis para uso comercial." tone="success" icon={Package} />
          <SummaryCard title="Com variacoes" value={resumo.comVariacoes.toString()} description="Produtos marcados com variações no Supabase." tone="info" icon={SlidersHorizontal} />
          <SummaryCard title="Com fotos" value={resumo.comFotos.toString()} description="Itens com fotos cadastradas em public.fotosProdutos." tone="special" icon={ImageIcon} />
          <SummaryCard title="Produtos de estoque" value={resumo.estoque.toString()} description="Itens marcados para controle futuro de estoque." tone="neutral" icon={Boxes} />
        </section>
      )}

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_170px_150px_170px_150px_170px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por produto, codigo, categoria ou apelido"
            />
          </label>

          <select value={categoria} onChange={(event) => setCategoria(event.target.value as "TODAS" | ProdutoCategoria)} className={filterClass}>
            <option value="TODAS">Todas categorias</option>
            {categoriaOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            <option value="ATIVO">Ativos</option>
            <option value="INATIVO">Inativos</option>
          </select>

          <select value={hasVariacoes} onChange={(event) => setHasVariacoes(event.target.value as BooleanFilter)} className={filterClass}>
            <option value="TODOS">Variacoes</option>
            <option value="SIM">Com variacoes</option>
            <option value="NAO">Sem variacoes</option>
          </select>

          <select value={hasFotos} onChange={(event) => setHasFotos(event.target.value as BooleanFilter)} className={filterClass}>
            <option value="TODOS">Fotos</option>
            <option value="SIM">Com fotos</option>
            <option value="NAO">Sem fotos</option>
          </select>

          <select value={isEstoque} onChange={(event) => setIsEstoque(event.target.value as BooleanFilter)} className={filterClass}>
            <option value="TODOS">Estoque</option>
            <option value="SIM">Produto de estoque</option>
            <option value="NAO">Sob demanda</option>
          </select>

          <button type="button" onClick={clearFilters} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            Limpar filtros
          </button>
        </div>

        {activeFilters.length ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {activeFilters.map((filter) => (
              <span key={filter} className="shrink-0 rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold text-[#0b7774]">
                {filter} x
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <ResponsiveList<Produto>
        items={filteredProdutos}
        getKey={(produto) => produto.id}
        isLoading={isLoading}
        emptyTitle="Nenhum produto encontrado"
        emptyDescription="Tente limpar os filtros ou alterar a busca para localizar outro produto."
        columns={[
          {
            header: "N°",
            cell: (produto) => <span className="font-semibold text-slate-950">{produto.id_produto}</span>
          },
          {
            header: "Produto",
            cell: (produto) => (
              <div>
                <p className="font-medium text-slate-900">{produto.nomeReal}</p>
                <p className="text-xs text-slate-500">{produto.apelidos.slice(0, 3).join(", ")}</p>
              </div>
            )
          },
          {
            header: "Cat.",
            cell: (produto) => <StatusBadge status={produto.categoria} tone="neutral" />
          },
          {
            header: "Formato",
            cell: (produto) => produto.formato
          },
          {
            header: "Unit.",
            cell: (produto) => formatCurrency(produto.valorUnt),
            align: "right"
          },
          {
            header: "Fixo",
            cell: (produto) => formatCurrency(produto.valorFixo),
            align: "right"
          },
          {
            header: "Prazo",
            cell: (produto) => produto.prazo,
            align: "center"
          },
          {
            header: "Status",
            cell: (produto) => (
              <div className="flex flex-wrap justify-center gap-1">
                <StatusBadge status={produto.ativo ? "ATIVO" : "INATIVO"} tone={produto.ativo ? "success" : "neutral"} />
                {produto.is_variacao ? <StatusBadge status="COM VARIACOES" tone="info" /> : null}
                {produto.is_estoque ? <StatusBadge status="ESTOQUE" tone="special" /> : null}
              </div>
            ),
            align: "center"
          },
          {
            header: "Ações",
            cell: (produto) => <ActionsMenu items={getActions(produto)} />,
            align: "right"
          }
        ]}
        renderCard={(produto) => (
          <article key={produto.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {produto.id_produto}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{produto.nomeReal}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {produto.categoria} - {produto.formato}
                </p>
              </div>
              <StatusBadge status={produto.ativo ? "ATIVO" : "INATIVO"} tone={produto.ativo ? "success" : "neutral"} />
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>
                Unit.: <strong className="text-slate-900">{formatCurrency(produto.valorUnt)}</strong>
              </p>
              <p>Fixo: {formatCurrency(produto.valorFixo)}</p>
              <p>Prazo: {produto.prazo}</p>
              <p>Fotos: {produto.fotos.length} | Variacoes: {produto.is_variacao ? "Sim" : "Nao"} | Estoque: {produto.is_estoque ? "Sim" : "Nao"}</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => router.push(`/produtos/${produto.id_produto}`)}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white"
              >
                Ver
              </button>
              <ActionsMenu label="Mais" items={getActions(produto).filter((item) => item.label !== "Ver produto")} />
            </div>
          </article>
        )}
      />

      {!isLoading ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          <p>
            {warnings[0] ?? `Dados reais carregados em public.produtos (${produtos.length} registros).`}
          </p>
        </section>
      ) : null}
    </div>
  );
}
