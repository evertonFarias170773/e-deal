"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cake, Search, Users, X } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatDate } from "@/lib/formatters/date";
import { formatDocument } from "@/lib/formatters/document";
import { useCadastrosDashboardResumo } from "@/features/cadastros/hooks/useCadastrosDashboardResumo";
import { useCadastrosReadOnlyData } from "@/features/cadastros/hooks/useCadastrosReadOnlyData";
import {
  CADASTRO_TIPOS,
  type CadastroTipo,
  type CadastrosListaItem
} from "@/features/cadastros/services/cadastros-read.service";
import { useAuth } from "@/features/auth/AuthProvider";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { AjusteContaCorrenteModal } from "./components/AjusteContaCorrenteModal";
import { ConfirmarInativacaoModal } from "./components/ConfirmarInativacaoModal";
import { inativarCadastro } from "@/features/cadastros/services/cadastros.service";

// Carga inicial enxuta: os 100 cadastros mais recentes (a view já ordena por
// id_cliente desc, que é a ordem de criação). Páginas seguintes sob demanda.
const PAGE_SIZE = 100;

/**
 * Filtros de tipo e "Mostrar inativos" exigem public.vw_cadastros_lista_completa
 * (migration 20260729_vw_cadastros_lista_completa.sql). Enquanto ela não estiver
 * aplicada, a lista lê a view compartilhada — que só entrega clientes ativos — e
 * os controles ficam ocultos. Virar para true quando a migration subir.
 */
const FILTROS_AVANCADOS_DISPONIVEIS = false;

/** Valores aceitos no filtro de tipo. "" = todos. */
const TIPOS_FILTRO = ["", ...CADASTRO_TIPOS] as const;

const TIPO_ROTULOS: Record<string, string> = {
  CLIENTE: "Clientes",
  TRANSPORTADORA: "Transportadoras"
};

type SearchState = {
  pageIndex: number;
  pageSize: number;
  search: string;
  tipo: CadastroTipo | "";
  mostrarInativos: boolean;
  /** Muda para forçar releitura da lista (ex.: depois de inativar um cadastro). */
  recarga: number;
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

  // Mesma estrutura do SummaryCard "Cadastros ativos" (título, valor, descrição,
  // ícone) para os dois cards ficarem com a mesma altura. A lista dos
  // aniversariantes continua no modal.
  return (
    <button type="button" onClick={onOpen} className="h-full text-left">
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
        <p className="mt-4 text-sm leading-6 text-slate-500">
          Clientes com data comemorativa hoje. Clique para ver a lista.
        </p>
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
  const { user } = useAuth();
  const { showToast } = useAppToast();
  // Filtros da tela na URL: sobrevivem a atualizar a página, sair e voltar, ao
  // histórico do navegador e a um link copiado.
  // Padrão oficial: docs/technical/PADRAO-FILTROS-URL-NAVEGACAO.md
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      // `qid` continua no schema por compatibilidade: links antigos com o filtro
      // de ID separado seguem funcionando, agora alimentando a busca única.
      qid: { codec: codecs.texto(), default: "" },
      // Padrões ("" e false) não vão para a URL — só o que foge do default.
      tipo: { codec: codecs.enumOf(TIPOS_FILTRO), default: "" as const },
      inativos: { codec: codecs.booleano(), default: false },
      pag: { codec: codecs.numero({ min: 1 }), default: 1 }
    }),
    []
  );

  // pageKey: mudar a busca devolve a lista para a primeira página.
  const { filters, setFilter, setFilters } = useUrlFilters(filtrosSchema, { pageKey: "pag" });

  // Campo único: o termo de um link antigo (`qid`) entra na mesma busca.
  const search = filters.q || filters.qid.replace(/\D/g, "");
  const pageIndex = filters.pag - 1;

  // O campo responde a cada tecla; a URL — e a consulta ao banco — só depois da
  // pausa. Antes desta migração cada tecla disparava uma consulta.
  const [buscaDigitada, setBuscaDigitada] = useDebouncedInput(search, (valor) =>
    setFilter("q", valor)
  );

  const [isBirthdayModalOpen, setIsBirthdayModalOpen] = useState(false);
  const [activeClienteParaAjuste, setActiveClienteParaAjuste] = useState<{ idCliente: number; nome: string } | null>(null);
  const [cadastroParaInativar, setCadastroParaInativar] = useState<{ idCliente: number; nome: string } | null>(null);
  const [isInativando, setIsInativando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const query = useMemo<SearchState>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      search,
      // Só chegam ao service quando a view que os suporta existir.
      tipo: FILTROS_AVANCADOS_DISPONIVEIS ? filters.tipo : "",
      mostrarInativos: FILTROS_AVANCADOS_DISPONIVEIS ? filters.inativos : false,
      recarga
    }),
    [pageIndex, search, filters.tipo, filters.inativos, recarga]
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

  const activeFilters = [
    search ? `Busca: ${search}` : null,
    FILTROS_AVANCADOS_DISPONIVEIS && filters.tipo
      ? `Tipo: ${TIPO_ROTULOS[filters.tipo] ?? filters.tipo}`
      : null,
    FILTROS_AVANCADOS_DISPONIVEIS && filters.inativos ? "Incluindo inativos" : null
  ].filter(Boolean) as string[];

  function clearFilters() {
    // Volta os filtros ao padrão, o que os remove da URL.
    setFilters({ q: "", qid: "", tipo: "", inativos: false, pag: 1 });
    setBuscaDigitada("");
  }

  function showPlaceholderActionToast(title: string) {
    showToast({
      type: "info",
      title,
      description: "Ação de apoio para validação visual. Nenhum backend real foi acionado."
    });
  }

  // O retorno à primeira página é do hook (pageKey), na mesma escrita da busca.
  function handleSearchChange(value: string) {
    setBuscaDigitada(value);
  }

  async function handleConfirmarInativacao() {
    if (!cadastroParaInativar || isInativando) return;
    setIsInativando(true);
    const resultado = await inativarCadastro(cadastroParaInativar.idCliente);
    setIsInativando(false);

    if (!resultado.success) {
      showToast({
        type: "error",
        title: "Não foi possível inativar",
        description: resultado.errorMessage || "Erro desconhecido."
      });
      return;
    }

    showToast({
      type: "success",
      title: "Cadastro inativado",
      description: `${cadastroParaInativar.nome} não aparece mais na lista de ativos.`
    });
    setCadastroParaInativar(null);
    // Só recarrega depois da confirmação bem-sucedida.
    setRecarga((valor) => valor + 1);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const aniversariantesHoje = resumo.aniversariantesHoje;

  return (
    <div className="space-y-6" data-cadastros-source={source}>
      <PageHeader
        title="Cadastros"
        subtitle="Busca por ID, documento, nome fantasia ou nome, com filtro de tipo, em páginas de 100 registros."
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
        <section className="grid gap-4 md:grid-cols-2">
          <SummaryCard
            title="Cadastros ativos"
            value={resumo.activeCount.toString()}
            description="Clientes ativos disponíveis para atendimento."
            tone="success"
            icon={Users}
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
                value={buscaDigitada}
                onChange={(event) => handleSearchChange(event.target.value)}
                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                placeholder="Buscar por ID do cliente, documento, nome fantasia ou nome"
              />
            </label>
          </div>

          {/* "Tipo" e "Mostrar inativos" dependem da view
              vw_cadastros_lista_completa, cuja migration ainda não foi aplicada.
              Ficam ocultos até lá — a fonte atual só entrega clientes ativos, e
              exibir os controles sugeriria um filtro que não tem efeito.
              Reativar: trocar FILTROS_AVANCADOS_DISPONIVEIS para true. */}
          {FILTROS_AVANCADOS_DISPONIVEIS && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo</span>
                <select
                  value={filters.tipo}
                  onChange={(event) => setFilter("tipo", event.target.value as CadastroTipo | "")}
                  className="bg-transparent text-sm font-semibold text-slate-800 outline-none"
                >
                  <option value="">Todos</option>
                  {CADASTRO_TIPOS.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {TIPO_ROTULOS[tipo] ?? tipo}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex cursor-pointer select-none items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <input
                  type="checkbox"
                  checked={filters.inativos}
                  onChange={(event) => setFilter("inativos", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0f9f9a] focus:ring-[#0f9f9a]"
                />
                <span className="text-sm font-semibold text-slate-700">Mostrar inativos</span>
              </label>
            </div>
          )}

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
            {FILTROS_AVANCADOS_DISPONIVEIS && filters.inativos
              ? "Cadastros ativos e inativos"
              : "Somente cadastros ativos"}
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
        // Clique (ou Enter/Espaço) na linha abre o cadastro. O menu de ações e os
        // demais controles seguem funcionando — a navegação os ignora.
        onRowClick={(cadastro) => router.push(`/cadastros/${cadastro.idCliente}`)}
        columns={[
          {
            header: "ID",
            cell: (cadastro) => <span className="font-semibold text-slate-950">{cadastro.idClienteText}</span>
          },
          {
            header: "Cliente",
            cell: (cadastro) => (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{cadastro.nome}</p>
                  {!cadastro.ativo && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600 ring-1 ring-red-200">
                      Inativo
                    </span>
                  )}
                  {cadastro.categoria && cadastro.categoria !== "CLIENTE" && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                      {TIPO_ROTULOS[cadastro.categoria] ?? cadastro.categoria}
                    </span>
                  )}
                </div>
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
                  ...(user?.isAdmin || user?.isSuperAdmin
                    ? [
                        {
                          label: "Consultar crédito",
                          onClick: () =>
                            setActiveClienteParaAjuste({
                              idCliente: cadastro.idCliente,
                              nome: cadastro.nome,
                            }),
                        },
                      ]
                    : []),
                  { label: "Abrir WhatsApp", onClick: () => showPlaceholderActionToast("Abrir WhatsApp") },
                  { label: "Ver financeiro", onClick: () => showPlaceholderActionToast("Ver financeiro") },
                  {
                    label: "Inativar cadastro",
                    destructive: true,
                    onClick: () =>
                      setCadastroParaInativar({ idCliente: cadastro.idCliente, nome: cadastro.nome })
                  }
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
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ID {cadastro.idClienteText}</p>
                  {!cadastro.ativo && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600 ring-1 ring-red-200">
                      Inativo
                    </span>
                  )}
                  {cadastro.categoria && cadastro.categoria !== "CLIENTE" && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                      {TIPO_ROTULOS[cadastro.categoria] ?? cadastro.categoria}
                    </span>
                  )}
                </div>
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
                  ...(user?.isAdmin || user?.isSuperAdmin
                    ? [
                        {
                          label: "Consultar crédito",
                          onClick: () =>
                            setActiveClienteParaAjuste({
                              idCliente: cadastro.idCliente,
                              nome: cadastro.nome,
                            }),
                        },
                      ]
                    : []),
                  { label: "Abrir WhatsApp", onClick: () => showPlaceholderActionToast("Abrir WhatsApp") },
                  {
                    label: "Inativar cadastro",
                    destructive: true,
                    onClick: () =>
                      setCadastroParaInativar({ idCliente: cadastro.idCliente, nome: cadastro.nome })
                  }
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
            onClick={() => setFilter("pag", Math.max(filters.pag - 1, 1))}
            disabled={pageIndex === 0 || isLoading}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setFilter("pag", filters.pag + 1)}
            disabled={!hasNextPage || isLoading}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Proxima
          </button>
        </div>
      </section>

      {activeClienteParaAjuste && (
        <AjusteContaCorrenteModal
          isOpen={!!activeClienteParaAjuste}
          onClose={() => setActiveClienteParaAjuste(null)}
          idCliente={activeClienteParaAjuste.idCliente}
          nomeCliente={activeClienteParaAjuste.nome}
          onSuccess={() => {
            // O próprio modal atualiza saldo e histórico internamente, sem necessidade de recarga da página pai
          }}
        />
      )}

      <ConfirmarInativacaoModal
        isOpen={!!cadastroParaInativar}
        idCliente={cadastroParaInativar?.idCliente ?? 0}
        nomeCliente={cadastroParaInativar?.nome ?? ""}
        isProcessando={isInativando}
        onClose={() => {
          if (!isInativando) setCadastroParaInativar(null);
        }}
        onConfirm={handleConfirmarInativacao}
      />
    </div>
  );
}
