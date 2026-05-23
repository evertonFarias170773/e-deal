"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CreditCard, Search, Users } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { formatDocument } from "@/lib/formatters/document";
import { cadastrosMock } from "@/lib/mocks/cadastros.mock";
import type { Cadastro, CadastroCategoria } from "@/features/cadastros/types";
import { getCadastrosReadOnlyList } from "@/features/cadastros/services/cadastros.service";

const categoriaLabel: Record<CadastroCategoria, string> = {
  CLIENTE: "Cliente",
  TRANSPORTADORA: "Transportadora",
  FORNECEDOR: "Fornecedor",
  ORGAO_PUBLICO: "Orgao publico"
};

const categoriaOptions: Array<"TODAS" | CadastroCategoria> = [
  "TODAS",
  "CLIENTE",
  "TRANSPORTADORA",
  "FORNECEDOR",
  "ORGAO_PUBLICO"
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cadastroMatchesSearch(cadastro: Cadastro, search: string) {
  const normalizedSearch = normalize(search);

  if (!normalizedSearch) {
    return true;
  }

  const searchable = [
    cadastro.idCliente.toString(),
    cadastro.nome,
    cadastro.fantasia ?? "",
    cadastro.documento,
    cadastro.whatsapp,
    cadastro.email,
    cadastro.cidadeUf,
    cadastro.vendedor
  ]
    .map(normalize)
    .join(" ");

  return searchable.includes(normalizedSearch);
}

export function CadastrosListPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [cadastros, setCadastros] = useState<Cadastro[]>(cadastrosMock);
  const [dataSource, setDataSource] = useState<"mock" | "supabase">("mock");
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState<"TODAS" | CadastroCategoria>("TODAS");
  const [status, setStatus] = useState<"TODOS" | "ATIVO" | "INATIVO" | "RESTRICAO">("TODOS");

  useEffect(() => {
    let alive = true;

    async function loadCadastros() {
      const result = await getCadastrosReadOnlyList();

      if (!alive) {
        return;
      }

      setCadastros(result.cadastros);
      setDataSource(result.source);
      console.log("[Cadastros][List] dataSource final no estado.", {
        dataSource: result.source,
        registros: result.cadastros.length
      });
    }

    loadCadastros();

    return () => {
      alive = false;
    };
  }, []);

  const filteredCadastros = useMemo(() => {
    return cadastros.filter((cadastro) => {
      const matchesSearch = cadastroMatchesSearch(cadastro, search);
      const matchesCategoria = categoria === "TODAS" || cadastro.categoria === categoria;
      const matchesStatus =
        status === "TODOS" ||
        (status === "ATIVO" && cadastro.ativo && !cadastro.restricao) ||
        (status === "INATIVO" && !cadastro.ativo) ||
        (status === "RESTRICAO" && cadastro.restricao);

      return matchesSearch && matchesCategoria && matchesStatus;
    });
  }, [cadastros, categoria, search, status]);

  const activeFilters = [
    search ? `Busca: ${search}` : null,
    categoria !== "TODAS" ? `Categoria: ${categoriaLabel[categoria]}` : null,
    status !== "TODOS" ? `Status: ${status === "RESTRICAO" ? "Com restricao" : status}` : null
  ].filter(Boolean);

  function clearFilters() {
    setSearch("");
    setCategoria("TODAS");
    setStatus("TODOS");
  }

  function showMockActionToast(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  const ativos = cadastros.filter((cadastro) => cadastro.ativo).length;
  const restricoes = cadastros.filter((cadastro) => cadastro.restricao).length;
  const creditoTotal = cadastros.reduce((total, cadastro) => total + cadastro.creditoDisponivel, 0);

  return (
    <div className="space-y-6" data-cadastros-source={dataSource}>
      <PageHeader
        title="Cadastros"
        subtitle="Gerencie clientes, transportadoras, fornecedores e orgaos publicos usados no ERP."
        context="Cadastros / Comercial"
        action={
          <button
            onClick={() => router.push("/cadastros/novo")}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            + Novo cadastro
          </button>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Cadastros ativos"
          value={ativos.toString()}
          description="Registros disponiveis para operacao comercial."
          tone="success"
          icon={Users}
        />
        <SummaryCard
          title="Com restricao"
          value={restricoes.toString()}
          description="Cadastros que exigem atencao antes de vender."
          tone="warning"
          icon={AlertTriangle}
        />
        <SummaryCard
          title="Credito disponivel"
          value={formatCurrency(creditoTotal)}
          description="Soma do credito operacional disponivel."
          tone="special"
          icon={CreditCard}
        />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por nome, documento, ID, WhatsApp ou e-mail"
            />
          </label>

          <select
            value={categoria}
            onChange={(event) => setCategoria(event.target.value as "TODAS" | CadastroCategoria)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none"
          >
            {categoriaOptions.map((option) => (
              <option key={option} value={option}>
                {option === "TODAS" ? "Todas categorias" : categoriaLabel[option]}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as "TODOS" | "ATIVO" | "INATIVO" | "RESTRICAO")
            }
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none"
          >
            <option value="TODOS">Todos status</option>
            <option value="ATIVO">Ativos</option>
            <option value="INATIVO">Inativos</option>
            <option value="RESTRICAO">Com restricao</option>
          </select>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>

        {activeFilters.length ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {activeFilters.map((filter) => (
              <span
                key={filter}
                className="shrink-0 rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold text-[#0b7774]"
              >
                {filter} x
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <ResponsiveList<Cadastro>
        items={filteredCadastros}
        getKey={(cadastro) => cadastro.id}
        emptyTitle="Nenhum cadastro encontrado"
        emptyDescription="Tente limpar os filtros ou alterar a busca para localizar outro cadastro."
        columns={[
          {
            header: "ID",
            cell: (cadastro) => <span className="font-semibold text-slate-950">#{cadastro.idCliente}</span>
          },
          {
            header: "Nome",
            cell: (cadastro) => (
              <div>
                <p className="font-medium text-slate-900">{cadastro.nome}</p>
                <p className="text-xs text-slate-500">{cadastro.fantasia}</p>
              </div>
            )
          },
          {
            header: "Categoria",
            cell: (cadastro) => <StatusBadge status={categoriaLabel[cadastro.categoria]} tone="neutral" />
          },
          {
            header: "Documento",
            cell: (cadastro) => formatDocument(cadastro.documento)
          },
          {
            header: "Cidade/UF",
            cell: (cadastro) => cadastro.cidadeUf
          },
          {
            header: "Credito/Risco",
            cell: (cadastro) => (
              <div className="text-right">
                <p className="font-semibold text-slate-900">{formatCurrency(cadastro.creditoDisponivel)}</p>
                <p className="text-xs text-slate-500">Risco {cadastro.riscoCredito}</p>
              </div>
            ),
            align: "right"
          },
          {
            header: "Status",
            cell: (cadastro) =>
              cadastro.restricao ? (
                <StatusBadge status="COM RESTRICAO" tone="danger" />
              ) : cadastro.ativo ? (
                <StatusBadge status="ATIVO" tone="success" />
              ) : (
                <StatusBadge status="INATIVO" tone="neutral" />
              ),
            align: "center"
          },
          {
            header: "Acoes",
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
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  #{cadastro.idCliente}
                </p>
                <h3 className="mt-2 font-semibold text-slate-950">{cadastro.nome}</h3>
                <p className="mt-1 text-sm text-slate-500">{cadastro.cidadeUf}</p>
              </div>
              {cadastro.restricao ? (
                <StatusBadge status="COM RESTRICAO" tone="danger" />
              ) : cadastro.ativo ? (
                <StatusBadge status="ATIVO" tone="success" />
              ) : (
                <StatusBadge status="INATIVO" tone="neutral" />
              )}
            </div>

            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Categoria: {categoriaLabel[cadastro.categoria]}</p>
              <p>Documento: {formatDocument(cadastro.documento)}</p>
              <p>Atendente: {cadastro.vendedor}</p>
              <p>Ultima compra: {formatDate(cadastro.ultimaCompra)}</p>
              <p className="font-semibold text-slate-900">
                Credito: {formatCurrency(cadastro.creditoDisponivel)}
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
    </div>
  );
}
