"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cake, MapPin, Search, TrendingUp, Users } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { formatDocument } from "@/lib/formatters/document";
import type { Cadastro } from "@/features/cadastros/types";
import { useCadastrosDashboardResumo } from "@/features/cadastros/hooks/useCadastrosDashboardResumo";
import { useCadastrosReadOnlyData } from "@/features/cadastros/hooks/useCadastrosReadOnlyData";

const PAGE_SIZE = 200;

type SearchState = {
  pageIndex: number;
  pageSize: number;
  search: string;
};

function MockBirthdayCard({
  active,
  count,
  names,
  onToggle
}: {
  active: boolean;
  count: number;
  names: string[];
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} className="text-left">
      <article
        className={`h-full rounded-3xl border p-5 shadow-sm transition ${
          active ? "border-[#0b7774] bg-[#f3fbfb]" : "border-[#d7e5e8] bg-white"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Aniversariantes do dia</p>
            <strong className="mt-2 block text-2xl font-bold tracking-tight text-slate-950">
              {count}
            </strong>
          </div>
          <span
            className={`rounded-2xl p-3 ring-1 ${
              active ? "bg-teal-50 text-teal-700 ring-teal-100" : "bg-slate-50 text-slate-700 ring-slate-100"
            }`}
          >
            <Cake className="h-5 w-5" />
          </span>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          {active
            ? "Filtro mock aplicado. Nenhum dado real foi consultado."
            : "Card mantido em modo mockado ate a proxima etapa de integracao."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {names.length ? (
            names.map((name) => (
              <span key={name} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                {name}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
              Sem dados mockados
            </span>
          )}
        </div>
        {active ? (
          <span className="mt-4 inline-flex rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold text-[#0b7774]">
            Filtro mock ativo
          </span>
        ) : null}
      </article>
    </button>
  );
}

export function CadastrosListPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [mockBirthdayFilterActive, setMockBirthdayFilterActive] = useState(false);

  const query = useMemo<SearchState>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      search
    }),
    [pageIndex, search]
  );

  const {
    cadastros,
    totalCount,
    hasNextPage,
    isLoading,
    warnings,
    loadedCount,
    source,
    pedidosResumoByCliente
  } = useCadastrosReadOnlyData(query);
  const resumo = useCadastrosDashboardResumo();

  const activeFilters = [
    search ? `Busca: ${search}` : null,
    mockBirthdayFilterActive ? "Aniversariantes do dia (mock)" : null
  ].filter(Boolean) as string[];

  function clearFilters() {
    setSearch("");
    setMockBirthdayFilterActive(false);
    setPageIndex(0);
  }

  function showMockActionToast(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPageIndex(0);
  }

  function toggleBirthdayMock() {
    setMockBirthdayFilterActive((current) => !current);
    showToast({
      type: "info",
      title: "Filtro mock de aniversariantes",
      description: "Estado visual alternado sem consultar o banco de dados."
    });
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6" data-cadastros-source={source}>
      <PageHeader
        title="Cadastros"
        subtitle="A lista abre somente com clientes ativos e usa paginação server-side de 200 registros."
        context="Cadastros / Comercial"
      />

      {resumo.isLoading ? (
        <LoadingSkeleton variant="cards" rows={4} />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Cadastros ativos"
            value={resumo.activeCount.toString()}
            description="Total global de clientes ativos em public.clientes."
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
                          {index + 1}. {cliente.nome}
                        </span>
                        <span className="text-sm font-semibold text-slate-950">{formatCurrency(cliente.valorTotal)}</span>
                      </div>
                      <p className="text-xs text-slate-500">{cliente.quantidadePedidos} pedidos</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Sem propostas aprovadas para montar a curva ABC.</p>
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
                          {index + 1}. {cidade.cidadeUf}
                        </span>
                        <span className="text-sm font-semibold text-slate-950">{formatCurrency(cidade.valorTotal)}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {cidade.quantidadePedidos} pedidos · {cidade.quantidadeClientes} clientes
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Sem dados suficientes para o ranking de cidades.</p>
                )}
              </div>
            }
            tone="info"
            icon={MapPin}
          />
          <MockBirthdayCard
            active={mockBirthdayFilterActive}
            count={resumo.aniversariantesMock.length}
            names={resumo.aniversariantesMock}
            onToggle={toggleBirthdayMock}
          />
        </section>
      )}

      <section className="sticky top-0 z-20 rounded-3xl border border-[#d7e5e8] bg-white/95 p-4 shadow-sm backdrop-blur lg:static lg:bg-white">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 lg:min-w-[420px] lg:flex-1">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por nome, documento, ID, WhatsApp ou e-mail"
            />
          </label>

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
            Base fixa: CLIENTE + ativo true
          </span>
          {activeFilters.map((filter) => (
            <span key={filter} className="rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold text-[#0b7774]">
              {filter}
            </span>
          ))}
        </div>
      </section>

      <ResponsiveList<Cadastro>
        items={cadastros}
        getKey={(cadastro) => cadastro.id}
        emptyTitle="Nenhum cadastro encontrado"
        emptyDescription="Ajuste a busca ou limpe os filtros para localizar clientes ativos."
        columns={[
          {
            header: "ID",
            cell: (cadastro) => <span className="font-semibold text-slate-950">{cadastro.idCliente}</span>
          },
          {
            header: "Cliente",
            cell: (cadastro) => (
              <div>
                <p className="font-medium text-slate-900">{cadastro.nome}</p>
                {cadastro.fantasia ? <p className="text-xs text-slate-500">{cadastro.fantasia}</p> : null}
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
                  {cadastro.tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} / {formatDocument(cadastro.documento)}
                </span>
              ) : (
                <span>{formatDocument(cadastro.documento)}</span>
              )
          },
          {
            header: "Atendente",
            cell: (cadastro) => cadastro.vendedor
          },
          {
            header: "Data Ult Pedido",
            cell: (cadastro) => {
              const resumoPedidos = pedidosResumoByCliente[cadastro.idCliente];
              return resumoPedidos?.ultimaCompra ? formatDateTime(resumoPedidos.ultimaCompra) : "—";
            }
          },
          {
            header: "Qtd/Pedidos",
            cell: (cadastro) => pedidosResumoByCliente[cadastro.idCliente]?.quantidadePedidos ?? 0,
            align: "right"
          },
          {
            header: "Ações",
            cell: (cadastro) => (
              <ActionsMenu
                items={[
                  { label: "Ver cadastro", onClick: () => router.push(`/cadastros/${cadastro.idCliente}`) },
                  { label: "Editar cadastro", onClick: () => router.push(`/cadastros/${cadastro.idCliente}/editar`) },
                  { label: "Criar proposta", onClick: () => showMockActionToast("Criar proposta") },
                  { label: "Consultar credito", onClick: () => showMockActionToast("Consultar credito") },
                  { label: "Abrir WhatsApp", onClick: () => showMockActionToast("Abrir WhatsApp") },
                  { label: "Ver financeiro", onClick: () => showMockActionToast("Ver financeiro") },
                  { label: "Inativar cadastro", destructive: true, onClick: () => showMockActionToast("Inativar cadastro") }
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
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ID {cadastro.idCliente}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{cadastro.nome}</h3>
                {cadastro.fantasia ? <p className="mt-1 text-sm text-slate-500">{cadastro.fantasia}</p> : null}
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Localidade: {cadastro.cidadeUf}</p>
              <p>
                Tipo/Documento:{" "}
                {cadastro.tipoPessoa ? `${cadastro.tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} / ${formatDocument(cadastro.documento)}` : formatDocument(cadastro.documento)}
              </p>
              <p>Atendente: {cadastro.vendedor}</p>
              <p>
                Ultimo pedido:{" "}
                {pedidosResumoByCliente[cadastro.idCliente]?.ultimaCompra
                  ? formatDateTime(pedidosResumoByCliente[cadastro.idCliente].ultimaCompra as string)
                  : "—"}
              </p>
              <p className="font-semibold text-slate-900">
                Pedidos: {pedidosResumoByCliente[cadastro.idCliente]?.quantidadePedidos ?? 0}
              </p>
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
                  { label: "Criar proposta", onClick: () => showMockActionToast("Criar proposta") },
                  { label: "Abrir WhatsApp", onClick: () => showMockActionToast("Abrir WhatsApp") },
                  { label: "Inativar cadastro", destructive: true, onClick: () => showMockActionToast("Inativar cadastro") }
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
