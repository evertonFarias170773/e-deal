"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, CreditCard, Mail, MapPin, Phone, Search, ShieldCheck } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { listPropostasDoCadastro } from "@/features/cadastros/services/cadastros.service";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { formatDocument } from "@/lib/formatters/document";
import type { Cadastro, CadastroCategoria, CadastroPropostaListItem } from "@/features/cadastros/types";

const categoriaLabel: Record<CadastroCategoria, string> = {
  CLIENTE: "Cliente",
  TRANSPORTADORA: "Transportadora",
  FORNECEDOR: "Fornecedor",
  ORGAO_PUBLICO: "Orgao publico"
};

type CadastroDetailPageProps = {
  cadastro: Cadastro;
  dataSource?: "supabase" | "mock";
};

const PROPOSTAS_PAGE_SIZE = 20;
const filterClass =
  "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";

export function CadastroDetailPage({ cadastro, dataSource = "mock" }: CadastroDetailPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [propostas, setPropostas] = useState<CadastroPropostaListItem[]>([]);
  const [isLoadingPropostas, setIsLoadingPropostas] = useState(false);
  const [propostasPageIndex, setPropostasPageIndex] = useState(0);
  const [propostasTotalCount, setPropostasTotalCount] = useState(0);
  const [propostasHasNextPage, setPropostasHasNextPage] = useState(false);
  const [propostasSource, setPropostasSource] = useState<"supabase" | "mock">("mock");
  const [propostasWarnings, setPropostasWarnings] = useState<string[]>([]);
  const [propostasSearch, setPropostasSearch] = useState("");
  const [propostasStatus, setPropostasStatus] = useState("TODOS");

  function showMockActionToast(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function loadPropostas() {
      setIsLoadingPropostas(true);

      const result = await listPropostasDoCadastro({
        idCliente: cadastro.idCliente,
        pageIndex: propostasPageIndex,
        pageSize: PROPOSTAS_PAGE_SIZE,
        search: propostasSearch,
        statusInterno: propostasStatus
      });

      if (!isMounted) {
        return;
      }

      setPropostas(result.propostas);
      setPropostasTotalCount(result.totalCount);
      setPropostasHasNextPage(result.hasNextPage);
      setPropostasSource(result.source);
      setPropostasWarnings(result.warnings);
      setIsLoadingPropostas(false);
    }

    void loadPropostas();

    return () => {
      isMounted = false;
    };
  }, [cadastro.idCliente, propostasPageIndex, propostasSearch, propostasStatus]);

  const propostaStatusOptions = useMemo(() => {
    const statuses = Array.from(
      new Set(propostas.map((item) => item.statusInterno).filter((value) => Boolean(value)))
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    return ["TODOS", ...statuses];
  }, [propostas]);

  const totalPages = Math.max(1, Math.ceil(propostasTotalCount / PROPOSTAS_PAGE_SIZE));

  function getDescricaoProposta(item: CadastroPropostaListItem) {
    const descricao = item.proposta.trim();
    if (descricao) {
      return descricao;
    }

    return `Pedido/Proposta #${item.idInt}`;
  }

  function getValorProposta(item: CadastroPropostaListItem) {
    if (item.valorTotal > 0) {
      return item.valorTotal;
    }

    return item.valor;
  }

  function getPropostaStatusTone(status: string) {
    const normalized = status.toLowerCase();
    if (normalized.includes("aprov")) return "success";
    if (normalized.includes("aguard") || normalized.includes("pend")) return "warning";
    if (normalized.includes("cancel")) return "neutral";
    if (normalized.includes("erro") || normalized.includes("rejeit")) return "danger";
    return "info";
  }

  function formatPropostaDate(value: string) {
    if (!value) {
      return "-";
    }

    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      return "-";
    }

    return formatDate(parsed);
  }

  function getPropostaActions(item: CadastroPropostaListItem) {
    return [
      {
        label: "Ver proposta",
        onClick: () => router.push(`/orcamentos/${item.idInt}`)
      },
      {
        label: "Editar / Corrigir",
        onClick: () => router.push(`/orcamentos/${item.idInt}/editar`)
      },
      {
        label: "Copiar proposta",
        onClick: () =>
          showToast({
            type: "info",
            title: "Copia de proposta sera liberada em etapa propria."
          })
      },
      {
        label: "Imprimir OS",
        onClick: () =>
          showToast({
            type: "info",
            title: "Impressao de OS sera liberada em etapa propria."
          })
      }
    ];
  }

  return (
    <div className="space-y-6" data-cadastros-detail-source={dataSource}>
      <div>
        <Link
          href="/cadastros"
          className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 text-sm font-semibold text-[#0b2f4a] shadow-sm transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para cadastros
        </Link>
      </div>

      <PageHeader
        title={cadastro.nome}
        subtitle={`Cadastro #${cadastro.idCliente} - ${categoriaLabel[cadastro.categoria]} - ${cadastro.cidadeUf}`}
        context="Detalhe do cadastro"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {cadastro.restricao ? (
              <StatusBadge status="COM RESTRICAO" tone="danger" />
            ) : cadastro.ativo ? (
              <StatusBadge status="ATIVO" tone="success" />
            ) : (
              <StatusBadge status="INATIVO" tone="neutral" />
            )}
            <ActionsMenu
              items={[
                { label: "Editar cadastro", onClick: () => router.push(`/cadastros/${cadastro.idCliente}/editar`) },
                { label: "Criar proposta", onClick: () => showMockActionToast("Criar proposta") },
                { label: "Consultar credito", onClick: () => showMockActionToast("Consulta de credito") },
                { label: "Abrir WhatsApp", onClick: () => showMockActionToast("Abrir WhatsApp") },
                { label: "Ver financeiro", onClick: () => showMockActionToast("Ver financeiro") },
                { label: "Ver notas fiscais", onClick: () => showMockActionToast("Ver notas fiscais") },
                { label: "Inativar cadastro", destructive: true, onClick: () => showMockActionToast("Inativar cadastro") }
              ]}
            />
          </div>
        }
      />

      {cadastro.restricao ? (
        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-800">
          <h2 className="font-semibold">Atencao necessaria</h2>
          <p className="mt-1 text-sm">
            Este cadastro possui restricao. Revise credito, documento e observacoes antes de criar
            nova proposta.
          </p>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Limite de credito"
          value={formatCurrency(cadastro.limiteCredito)}
          description="Valor operacional configurado no cadastro."
          tone="info"
          icon={CreditCard}
        />
        <SummaryCard
          title="Credito disponivel"
          value={formatCurrency(cadastro.creditoDisponivel)}
          description={`Risco ${cadastro.riscoCredito.toLowerCase()} para analise comercial.`}
          tone={cadastro.restricao ? "warning" : "success"}
          icon={ShieldCheck}
        />
        <SummaryCard
          title="Total comprado"
          value={formatCurrency(cadastro.totalCompras)}
          description={`Ultima compra em ${formatDate(cadastro.ultimaCompra)}.`}
          tone="special"
          icon={Building2}
        />
        <SummaryCard
          title="Contatos"
          value={cadastro.contatos.length.toString()}
          description="Pessoas vinculadas a este cadastro."
          tone="neutral"
          icon={Phone}
        />
      </section>

      <DetailCard title="Propostas / Pedidos">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Historico comercial vinculado a este cadastro.</p>

          <section className="grid gap-3 xl:grid-cols-[1fr_240px_auto]">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-4 w-4 text-[#0f9f9a]" />
              <input
                value={propostasSearch}
                onChange={(event) => {
                  setPropostasSearch(event.target.value);
                  setPropostasPageIndex(0);
                }}
                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                placeholder="Buscar por nº ou descricao da proposta"
              />
            </label>

            <select
              value={propostasStatus}
              onChange={(event) => {
                setPropostasStatus(event.target.value);
                setPropostasPageIndex(0);
              }}
              className={filterClass}
            >
              <option value="TODOS">Todos status</option>
              {propostaStatusOptions
                .filter((status) => status !== "TODOS")
                .map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
            </select>

            <button
              type="button"
              onClick={() => {
                setPropostasSearch("");
                setPropostasStatus("TODOS");
                setPropostasPageIndex(0);
              }}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Limpar filtros
            </button>
          </section>

          {propostasSource === "mock" && propostasWarnings.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {propostasWarnings[0]}
            </div>
          ) : null}

          {!isLoadingPropostas && propostas.length === 0 ? (
            <EmptyState
              title="Nenhuma proposta ou pedido encontrado para este cadastro."
              description="Nao ha historico comercial vinculado ao cadastro atual."
              action={
                <Link
                  href={`/orcamentos/novo?id_cliente=${cadastro.idCliente}`}
                  className="inline-flex items-center rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
                >
                  Criar proposta
                </Link>
              }
            />
          ) : (
            <ResponsiveList<CadastroPropostaListItem>
              items={propostas}
              isLoading={isLoadingPropostas}
              getKey={(item) => item.id || `${item.idInt}-${item.createdAt}`}
              emptyTitle="Nenhuma proposta ou pedido encontrado para este cadastro."
              emptyDescription="Ajuste os filtros desta seção para tentar novamente."
              columns={[
                {
                  header: "N°",
                  cell: (item) => <span className="font-semibold text-slate-950">{item.idInt || "-"}</span>
                },
                {
                  header: "Data",
                  cell: (item) => formatPropostaDate(item.createdAt),
                  align: "center"
                },
                {
                  header: "Descricao",
                  cell: (item) => (
                    <span className="line-clamp-2 max-w-[260px] text-sm text-slate-700">{getDescricaoProposta(item)}</span>
                  )
                },
                {
                  header: "Vendedor",
                  cell: (item) => item.vendedor || "-",
                  align: "center"
                },
                {
                  header: "Empresa",
                  cell: (item) => item.empresa || "-",
                  align: "center"
                },
                {
                  header: "Status",
                  cell: (item) => (
                    <StatusBadge
                      status={item.statusInterno || "SEM_STATUS"}
                      tone={getPropostaStatusTone(item.statusInterno || "SEM_STATUS")}
                    />
                  ),
                  align: "center"
                },
                {
                  header: "Valor",
                  cell: (item) => formatCurrency(getValorProposta(item)),
                  align: "right"
                },
                {
                  header: "Acoes",
                  cell: (item) => <ActionsMenu items={getPropostaActions(item)} />,
                  align: "right"
                }
              ]}
              renderCard={(item) => (
                <article
                  key={item.id || `${item.idInt}-${item.createdAt}`}
                  className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {item.idInt || "-"}</p>
                      <h3 className="mt-2 font-semibold text-slate-950">{getDescricaoProposta(item)}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatPropostaDate(item.createdAt)} - {item.vendedor || "Sem vendedor"}
                      </p>
                    </div>
                    <StatusBadge
                      status={item.statusInterno || "SEM_STATUS"}
                      tone={getPropostaStatusTone(item.statusInterno || "SEM_STATUS")}
                    />
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <p>Empresa: {item.empresa || "-"}</p>
                    <p className="font-semibold text-slate-900">Valor: {formatCurrency(getValorProposta(item))}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => router.push(`/orcamentos/${item.idInt}`)}
                      className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white"
                    >
                      Ver proposta
                    </button>
                    <ActionsMenu
                      label="Acoes"
                      items={getPropostaActions(item).filter((action) => action.label !== "Ver proposta")}
                    />
                  </div>
                </article>
              )}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-600">
              Mostrando {propostas.length} de {propostasTotalCount} proposta(s) vinculada(s).
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPropostasPageIndex((current) => Math.max(current - 1, 0))}
                disabled={propostasPageIndex === 0 || isLoadingPropostas}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="text-sm font-medium text-slate-600">
                Pagina {propostasPageIndex + 1} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPropostasPageIndex((current) => current + 1)}
                disabled={!propostasHasNextPage || isLoadingPropostas}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Proxima
              </button>
            </div>
          </div>
        </div>
      </DetailCard>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <DetailCard title="Dados principais">
            <InfoGrid
              items={[
                ["ID operacional", `#${cadastro.idCliente}`],
                ["Categoria", categoriaLabel[cadastro.categoria]],
                ["Documento", formatDocument(cadastro.documento)],
                ["Tipo pessoa", cadastro.tipoPessoa],
                ["Empresa padrao", cadastro.empresaPadrao],
                ["Vendedor/atendente", cadastro.vendedor],
                ["Pagamento padrao", cadastro.padraoPagamento],
                ["Verificado", cadastro.verificado ? "Sim" : "Nao"]
              ]}
            />
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-xs">
              <p className="font-bold flex items-center gap-1.5">
                ⚠️ Conflito Técnico no Padrão Faturado
              </p>
              <p className="mt-1 leading-relaxed text-amber-700">
                A coluna do banco de dados <code>padrao_pagamento</code> está sendo exibida acima como &quot;Pagamento padrao&quot; (que representa a forma de pagamento comercial geral). O padrão de pagamento faturado é lido a partir do mesmo campo, configurando um conflito estrutural. Por isso, a gravação estrutural desse campo como faturado independente está desativada para manter a integridade dos termos comerciais gerais.
              </p>
            </div>
          </DetailCard>

          <DetailCard title="Enderecos">
            {cadastro.enderecos.length ? (
              <div className="space-y-3">
                {cadastro.enderecos.map((endereco) => (
                  <div key={endereco.id} className="flex gap-4 rounded-2xl bg-slate-50 p-4">
                    <span className="mt-1 rounded-2xl bg-[#dff8f6] p-3 text-[#0b7774]">
                      <MapPin className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <p className="font-semibold text-slate-950">
                          {endereco.endereco}, {endereco.numero}
                        </p>
                        <StatusBadge status={endereco.tipo.toUpperCase()} tone="neutral" />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {endereco.bairro} - {endereco.cidade}/{endereco.uf} - CEP {endereco.cep}
                      </p>
                      {endereco.complemento ? (
                        <p className="mt-1 text-sm text-slate-500">Complemento: {endereco.complemento}</p>
                      ) : null}
                      {endereco.obs ? <p className="mt-1 text-sm text-slate-500">{endereco.obs}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nenhum endereco cadastrado.</p>
            )}
          </DetailCard>

          <DetailCard title="Observacoes">
            <p className="text-sm leading-6 text-slate-600">{cadastro.observacoes}</p>
          </DetailCard>
        </div>

        <div className="space-y-6">
          <DetailCard title="Contatos">
            <div className="space-y-3">
              {cadastro.contatos.map((contato) => (
                <div key={contato.id} className="rounded-2xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-950">{contato.nome}</p>
                  <p className="text-sm text-slate-500">{contato.cargo}</p>
                  <div className="mt-3 space-y-1 text-sm text-slate-600">
                    <p className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-[#0f9f9a]" />
                      {contato.whatsapp}
                    </p>
                    <p className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-[#0f9f9a]" />
                      {contato.email}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Vinculos comerciais">
            {cadastro.vinculosComerciais.length ? (
              <div className="space-y-2">
                {cadastro.vinculosComerciais.map((vinculo) => (
                  <div key={vinculo.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">{vinculo.nome}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      #{vinculo.idClienteRelacionado} - {formatDocument(vinculo.documento)} - {vinculo.tipoRelacao}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nenhum cadastro relacionado informado.</p>
            )}
          </DetailCard>

          <DetailCard title="Resumo fiscal e credito">
            <InfoGrid
              items={[
                ["Documento", cadastro.verificado ? "Verificado" : "Pendente de revisao"],
                ["Restricao", cadastro.restricao ? "Sim" : "Nao"],
                ["Risco credito", cadastro.riscoCredito],
                ["Credito disponivel", formatCurrency(cadastro.creditoDisponivel)]
              ]}
            />
          </DetailCard>
        </div>
      </section>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
