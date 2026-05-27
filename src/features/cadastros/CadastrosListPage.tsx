"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cake, MapPin, Search, TrendingUp, Users, X } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { formatDocument } from "@/lib/formatters/document";
import { useCadastrosDashboardResumo } from "@/features/cadastros/hooks/useCadastrosDashboardResumo";
import { useCadastrosReadOnlyData } from "@/features/cadastros/hooks/useCadastrosReadOnlyData";
import type { CadastrosListaItem } from "@/features/cadastros/services/cadastros-read.service";

const PAGE_SIZE = 200;

type SearchState = {
  pageIndex: number;
  pageSize: number;
  search: string;
  idClienteSearch: string;
};

function AniversariantesCard({
  items,
  onOpen
}: {
  items: CadastrosListaItem[];
  onOpen: () => void;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <button type="button" onClick={onOpen} className="text-left">
      <article className="h-full rounded-3xl border border-[#d7e5e8] bg-[#f7fbfb] p-5 shadow-sm transition hover:border-[#b7d9d8] hover:bg-[#f2fbfb]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Aniversariantes do dia</p>
            <strong className="mt-2 block text-2xl font-bold tracking-tight text-slate-950">{items.length}</strong>
          </div>
          <span className="rounded-2xl bg-teal-50 p-3 text-teal-700 ring-1 ring-teal-100">
            <Cake className="h-5 w-5" />
          </span>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-500">Clientes com data comemorativa hoje.</p>
        <div className="mt-4 space-y-2">
          {items.slice(0, 2).map((item) => (
            <div key={item.id} className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-800">{item.nome}</span>
                <span className="text-xs font-semibold text-slate-500">
                  {item.dataFundacao ? formatDate(item.dataFundacao) : "—"}
                </span>
              </div>
              <p className="text-xs text-slate-500">{item.fantasia || item.apelido || "Sem nome fantasia"}</p>
            </div>
          ))}
        </div>
        <span className="mt-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
          Ver aniversariantes
        </span>
      </article>
    </button>
  );
}

function AniversariantesModal({
  open,
  items,
  onClose,
  onOpenCadastro
}: {
  open: boolean;
  items: CadastrosListaItem[];
  onClose: () => void;
  onOpenCadastro: (idCliente: number) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Aniversariantes do dia"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Aniversariantes do dia</h3>
            <p className="text-sm text-slate-500">Relação completa dos cadastros com data comemorativa hoje.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(85vh-73px)] overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ID cliente {item.idClienteText}</p>
                    <p className="mt-1 font-semibold text-slate-950">{item.nome}</p>
                    <p className="text-sm text-slate-500">{item.fantasia || item.apelido || "Sem nome fantasia"}</p>
                    <p className="mt-2 text-sm text-slate-600">
                      Data comemorativa: {item.dataFundacao ? formatDate(item.dataFundacao) : "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenCadastro(item.idCliente)}
                    className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0a2740]"
                  >
                    Abrir cadastro
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CadastrosListPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [search, setSearch] = useState("");
  const [idClienteSearch, setIdClienteSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [isBirthdayModalOpen, setIsBirthdayModalOpen] = useState(false);

  const query = useMemo<SearchState>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      search,
      idClienteSearch
    }),
    [idClienteSearch, pageIndex, search]
  );

  const {
    cadastros,
    totalCount,
    hasNextPage,
    isLoading,
    warnings,
    loadedCount,
    source
  } = useCadastrosReadOnlyData(query);
  const resumo = useCadastrosDashboardResumo();

  const activeFilters = [idClienteSearch ? `ID cliente: ${idClienteSearch}` : null, search ? `Busca: ${search}` : null].filter(
    Boolean
  ) as string[];

  function clearFilters() {
    setSearch("");
    setIdClienteSearch("");
    setPageIndex(0);
  }

  function showPlaceholderActionToast(title: string) {
    showToast({
      type: "info",
      title,
      description: "Ação de apoio para validação visual. Nenhum backend real foi acionado."
    });
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPageIndex(0);
  }

  function handleIdClienteChange(value: string) {
    const digits = value.replace(/\D/g, "");
    setIdClienteSearch(digits);
    setPageIndex(0);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const aniversariantesHoje = resumo.aniversariantesHoje;

  return (
    <div className="space-y-6" data-cadastros-source={source}>
      <PageHeader
        title="Cadastros"
        subtitle="Clientes ativos com busca por ID e filtros gerais, em páginas de 200 registros."
        context="Cadastros / Comercial"
        action={
          <button
            type="button"
            onClick={() => router.push("/cadastros/novo")}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            + Novo cadastro
          </button>
        }
      />

      {resumo.isLoading ? (
        <LoadingSkeleton variant="cards" rows={4} />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Cadastros ativos"
            value={resumo.activeCount.toString()}
            description="Clientes ativos disponíveis para atendimento."
            tone="success"
            icon={Users}
          />
          <SummaryCard
            title="Curva ABC - Clientes"
            value={resumo.topClientes[0] ? formatCurrency(resumo.topClientes[0].valorTotal) : "R$ 0,00"}
            description={
              <div className="space-y-2">
                {resumo.topClientes.length ? (
                  resumo.topClientes.map((cliente, index) => (
                    <div key={cliente.idCliente} className="rounded-2xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-800">
                          {cliente.posicao || index + 1}. {cliente.nome}
                        </span>
                        <span className="text-sm font-semibold text-slate-950">{formatCurrency(cliente.valorTotal)}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {cliente.quantidadePedidos} pedidos
                        {cliente.ultimoPedido ? ` · Último pedido: ${formatDate(cliente.ultimoPedido)}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Sem dados para ranking.</p>
                )}
              </div>
            }
            tone="special"
            icon={TrendingUp}
          />
          <SummaryCard
            title="Curva ABC - Cidades"
            value={resumo.topCidades[0] ? formatCurrency(resumo.topCidades[0].valorTotal) : "R$ 0,00"}
            description={
              <div className="space-y-2">
                {resumo.topCidades.length ? (
                  resumo.topCidades.map((cidade, index) => (
                    <div key={cidade.cidadeUf} className="rounded-2xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-800">
                          {cidade.posicao || index + 1}. {cidade.cidadeUf}
                        </span>
                        <span className="text-sm font-semibold text-slate-950">{formatCurrency(cidade.valorTotal)}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {cidade.quantidadePedidos} pedidos · {cidade.quantidadeClientes} clientes
                        {cidade.ultimoPedido ? ` · Último pedido: ${formatDate(cidade.ultimoPedido)}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Sem dados para ranking.</p>
                )}
              </div>
            }
            tone="info"
            icon={MapPin}
          />
          <AniversariantesCard items={aniversariantesHoje} onOpen={() => setIsBirthdayModalOpen(true)} />
        </section>
      )}

      <AniversariantesModal
        open={isBirthdayModalOpen}
        items={aniversariantesHoje}
        onClose={() => setIsBirthdayModalOpen(false)}
        onOpenCadastro={(idCliente) => {
          setIsBirthdayModalOpen(false);
          router.push(`/cadastros/${idCliente}`);
        }}
      />

      <section className="sticky top-0 z-20 rounded-3xl border border-[#d7e5e8] bg-white/95 p-4 shadow-sm backdrop-blur lg:static lg:bg-white">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 lg:min-w-[420px] lg:flex-1">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-4 w-4 text-[#0f9f9a]" />
              <input
                value={idClienteSearch}
                onChange={(event) => handleIdClienteChange(event.target.value)}
                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                placeholder="ID cliente"
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-4 w-4 text-[#0f9f9a]" />
              <input
                value={search}
                onChange={(event) => handleSearchChange(event.target.value)}
                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                placeholder="Buscar por nome, fantasia, documento, cidade, WhatsApp ou e-mail"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#f1f7f9] px-3 py-1 text-xs font-semibold text-slate-600">
            Clientes ativos disponíveis para atendimento
          </span>
          {activeFilters.map((filter) => (
            <span key={filter} className="rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold text-[#0b7774]">
              {filter}
            </span>
          ))}
        </div>
      </section>

      <ResponsiveList<CadastrosListaItem>
        items={cadastros}
        getKey={(cadastro) => cadastro.id}
        emptyTitle="Nenhum cadastro encontrado"
        emptyDescription="Ajuste a busca ou limpe os filtros para localizar clientes."
        columns={[
          {
            header: "ID",
            cell: (cadastro) => <span className="font-semibold text-slate-950">{cadastro.idClienteText}</span>
          },
          {
            header: "Cliente",
            cell: (cadastro) => (
              <div>
                <p className="font-medium text-slate-900">{cadastro.nome}</p>
                {cadastro.fantasia || cadastro.apelido ? (
                  <p className="text-xs text-slate-500">{cadastro.fantasia || cadastro.apelido}</p>
                ) : null}
              </div>
            )
          },
          {
            header: "Localidade",
            cell: (cadastro) => cadastro.cidadeUf
          },
          {
            header: "Tipo/Documento",
            cell: (cadastro) =>
              cadastro.tipoPessoa ? (
                <span>
                  {cadastro.tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} /{" "}
                  {formatDocument(cadastro.documentoNumeros || cadastro.documento)}
                </span>
              ) : (
                <span>{formatDocument(cadastro.documentoNumeros || cadastro.documento)}</span>
              )
          },
          {
            header: "Atendente",
            cell: (cadastro) => cadastro.nomeVendedor
          },
          {
            header: "Data Ult Pedido",
            cell: (cadastro) => (cadastro.dataUltPedido ? formatDate(cadastro.dataUltPedido) : "—")
          },
          {
            header: "Qtd/Pedidos",
            cell: (cadastro) => cadastro.qtdPedidos,
            align: "right"
          },
          {
            header: "Ações",
            cell: (cadastro) => (
              <ActionsMenu
                items={[
                  { label: "Ver cadastro", onClick: () => router.push(`/cadastros/${cadastro.idCliente}`) },
                  { label: "Editar cadastro", onClick: () => router.push(`/cadastros/${cadastro.idCliente}/editar`) },
                  { label: "Criar proposta", onClick: () => showPlaceholderActionToast("Criar proposta") },
                  { label: "Consultar credito", onClick: () => showPlaceholderActionToast("Consultar credito") },
                  { label: "Abrir WhatsApp", onClick: () => showPlaceholderActionToast("Abrir WhatsApp") },
                  { label: "Ver financeiro", onClick: () => showPlaceholderActionToast("Ver financeiro") },
                  { label: "Inativar cadastro", destructive: true, onClick: () => showPlaceholderActionToast("Inativar cadastro") }
                ]}
              />
            ),
            align: "right"
          }
        ]}
        renderCard={(cadastro) => (
          <article key={cadastro.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ID {cadastro.idClienteText}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{cadastro.nome}</h3>
                {cadastro.fantasia || cadastro.apelido ? (
                  <p className="mt-1 text-sm text-slate-500">{cadastro.fantasia || cadastro.apelido}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Localidade: {cadastro.cidadeUf}</p>
              <p>
                Tipo/Documento:{" "}
                {cadastro.tipoPessoa
                  ? `${cadastro.tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} / ${formatDocument(cadastro.documentoNumeros || cadastro.documento)}`
                  : formatDocument(cadastro.documentoNumeros || cadastro.documento)}
              </p>
              <p>Atendente: {cadastro.nomeVendedor}</p>
              <p>Ultimo pedido: {cadastro.dataUltPedido ? formatDate(cadastro.dataUltPedido) : "—"}</p>
              <p className="font-semibold text-slate-900">Pedidos: {cadastro.qtdPedidos}</p>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => router.push(`/cadastros/${cadastro.idCliente}`)}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white"
              >
                Ver
              </button>
              <ActionsMenu
                label="Mais"
                items={[
                  { label: "Editar cadastro", onClick: () => router.push(`/cadastros/${cadastro.idCliente}/editar`) },
                  { label: "Criar proposta", onClick: () => showPlaceholderActionToast("Criar proposta") },
                  { label: "Abrir WhatsApp", onClick: () => showPlaceholderActionToast("Abrir WhatsApp") },
                  { label: "Inativar cadastro", destructive: true, onClick: () => showPlaceholderActionToast("Inativar cadastro") }
                ]}
              />
            </div>
          </article>
        )}
      />

      <section className="flex flex-col gap-3 rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          <p>
            Página {pageIndex + 1} de {totalPages} · {loadedCount} registros carregados nesta página
          </p>
          <p className="text-xs text-slate-500">Total filtrado: {totalCount}</p>
          {warnings.length ? <p className="text-xs text-amber-700">{warnings[0]}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPageIndex((current) => Math.max(current - 1, 0))}
            disabled={pageIndex === 0 || isLoading}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setPageIndex((current) => current + 1)}
            disabled={!hasNextPage || isLoading}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Proxima
          </button>
        </div>
      </section>
    </div>
  );
}
