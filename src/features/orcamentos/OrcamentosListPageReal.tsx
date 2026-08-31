"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CreditCard, FileText, Search, WalletCards, MessageSquare, Paperclip, Palette, Printer } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { buildPropostaInformalText } from "@/features/orcamentos/orcamento-utils";
import { useOrcamentosReadOnlyData } from "@/features/orcamentos/hooks/useOrcamentosReadOnlyData";
import type { OrcamentoListItem } from "@/features/orcamentos/mappers";
import { encerrarTeste, reabrirTeste } from "@/features/pedidos/services/encerrar-teste.client";
import { buscarRastreioDasPropostas, type RastreioDaProposta } from "@/features/orcamentos/services/rastreio-lista.service";
import { RastreioPropostaModal } from "@/features/orcamentos/components/RastreioPropostaModal";
import { buscarNomesDosSocios } from "@/features/orcamentos/services/socio-pagador.service";
import {
  gerarPDFProposta,
  duplicarProposta,
  getPropostaChatResumos,
  loadChatReadInfo,
  getPropostaDetailById,
  updatePropostaStatusInterno,
  liberarPropostaParaProducao,
  retirarPropostaDaProducao,
  type PropostaChatResumo
} from "@/features/orcamentos/services/orcamentos.service";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao, getDataScope, getNomeParaEscopo } from "@/features/auth/usuarios.service";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { LiberarProducaoModal } from "@/features/orcamentos/components/LiberarProducaoModal";
import { CancelPropostaModal } from "@/features/orcamentos/components/CancelPropostaModal";
import type { Proposta } from "@/features/orcamentos/types";


const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";

/**
 * Proposta parada esperando o atendente olhar. É a fila que trava o fluxo, e por
 * isso ganha o topo da lista e um fundo próprio — o status sozinho, num badge no
 * meio de dezenas de linhas iguais, passava batido.
 */
function ehRevisaoAtendente(item: { statusInterno: string }): boolean {
  return normalizeProposalStatus(item.statusInterno) === "REVISAO ATENDENTE";
}

/**
 * Azul claro da linha em revisão. Vai em `style` inline (é o contrato do
 * `getRowHighlight` do ResponsiveList): o hover da linha também é inline e
 * venceria qualquer classe, apagando o destaque assim que o mouse saísse.
 */
const DESTAQUE_REVISAO = { base: "#eff6ff", hover: "#dbeafe" };

const TIPOS_COBRANCA = ["TODOS", "PIX", "BOLETO", "E-FATURADO", "CARTAO"] as const;
type TipoCobrancaFiltro = (typeof TIPOS_COBRANCA)[number];

const CARDS_FILTRO = ["ORCAMENTOS", "EM_ARTE", "LIBERADAS", "REVISAO_ATENDENTE", "EM_PRODUCAO"] as const;
type CardFiltro = (typeof CARDS_FILTRO)[number] | null;
const defaultStatusOrder = [
  "NOVO", 
  "AGUARDANDO", 
  "AGUARDANDO / PENDENTE",
  "EM ARTE",
  "LIBERADO", 
  "REVISAO ATENDENTE", 
  "REVISAO PRODUCAO",
  "EM PRODUCAO",
  "EM IMPRESSAO",
  "EM IMPRESSAO / PENDENTE",
  "EM ACABAMENTO",
  "EM ACABAMENTO / PENDENTE",
  "EXPEDICAO",
  "A RETIRAR", 
  "EM TRANSITO", 
  "ENTREGUE", 
  "CANCELADO"
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function getSearchableProposalText(item: OrcamentoListItem, nomeSocio?: string | null) {
  return normalize(
    [
      // Socio pagador entra no indice da tela para a busca refinar por ele
      // depois que o servidor ja trouxe a linha. O servidor tem alcance proprio
      // (id_faturado.in), porque a tela so filtra o que ja veio.
      nomeSocio ?? "",
      item.id_int,
      item.clienteId,
      item.clienteNome,
      item.documento,
      item.vendedor,
      item.statusLabel,
      item.tipoCobrancaLabel,
      item.modelo,
      item.createdAt,
      item.osIdeal,
      formatCurrency(item.total)
    ]
      .map((value) => String(value ?? ""))
      .join(" ")
  );
}

function getSearchableProposalDigits(item: OrcamentoListItem) {
  return [
    item.id_int,
    item.clienteId,
    item.documento,
    item.total,
    item.osIdeal
  ]
    .map((value) => onlyDigits(value))
    .join(" ");
}

function getMonthKeyFromDate(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).format(value);
}

function getMonthKeyFromIso(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? getMonthKeyFromDate(date) : "";
}

function getPeriodKeyFromProposal(item: OrcamentoListItem) {
  return item.periodoKey || getMonthKeyFromIso(item.createdAt) || "";
}

type PeriodOption = {
  value: string;
  label: string;
};

function formatPeriodLabel(date: Date) {
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "short"
  })
    .format(date)
    .replace(".", "");

  const formattedMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const year = String(date.getFullYear()).slice(2);

  return `${formattedMonth}/${year}`;
}

function getPeriodValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildLastSixPeriodOptions() {
  const today = new Date();
  const periods = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);

    return {
      label: formatPeriodLabel(date),
      value: getPeriodValue(date)
    } satisfies PeriodOption;
  });

  return periods satisfies PeriodOption[];
}

function getSelectedPeriodLabel(periodo: string, periodOptions: PeriodOption[]) {
  return periodOptions.find((option) => option.value === periodo)?.label ?? "período selecionado";
}

function normalizeProposalStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toUpperCase() || "SEM_STATUS";
}

/**
 * A proposta esta EM ARTE? UMA definicao, usada pelo card, pelo clique no card e
 * pelo filtro do select.
 *
 * Le `item.status` — o status de EXIBICAO, que ja passou por
 * `composeStatusEmArte` e carrega o sufixo " / EM ARTE" quando
 * `propostas.em_arte` e true. NAO le `item.statusInterno`, que e o texto cru do
 * banco: la o sufixo nunca existe, porque ele nasce na montagem da exibicao.
 *
 * Era exatamente essa a divergencia (31/08/2026): o filtro do select olhava
 * `item.status` e achava as propostas; o card e o clique olhavam
 * `normalizeProposalStatus(item.statusInterno)` e comparavam com
 * "NOVO / EM ARTE" e afins — combinacao que o status cru NUNCA produz. Resultado:
 * card sempre 0 e R$ 0,00, e clicar nele devolvia lista vazia, enquanto o select
 * trazia 11 propostas em Ago/26.
 *
 * `includes` em vez de lista fechada porque e o criterio do filtro, que e a
 * referencia — e ele tambem pega a proposta cujo `status_interno` ja foi gravado
 * como "AGUARDANDO / EM ARTE" no banco (existe uma, a 17823).
 */
function ehEmArte(item: { status?: string | null }): boolean {
  return (item.status ?? "").includes("EM ARTE");
}

/**
 * A proposta esta LIBERADA? UMA definicao, usada pelo card, pelo clique no card
 * e — por construcao — igual ao filtro do select.
 *
 * Le `item.status`, o status de EXIBICAO, e compara por IGUALDADE, que e
 * exatamente o que o select faz (`item.status === status`, com status =
 * "LIBERADO"). A igualdade e o ponto: ela EXCLUI as exibidas como
 * "LIBERADO / EM ARTE", que aparecem no card "Em arte".
 *
 * Mesma raiz do bug do card "Em arte" (corrigido em d3b03b8): o card lia
 * `normalizeProposalStatus(item.statusInterno)` — o texto CRU do banco, onde o
 * sufixo nunca existe — e contava toda proposta LIBERADO, inclusive as em arte.
 * Em Ago/26 isso dava 961 contra as 960 do filtro: uma proposta a mais, de
 * R$ 362,77, que aparecia nos dois cards ao mesmo tempo.
 *
 * Nao ha caso ambiguo: nenhuma proposta tem "LIBERADO / EM ARTE" gravado direto
 * em `status_interno` (a unica com sufixo cru e a 17823, "AGUARDANDO / EM ARTE").
 */
function ehLiberada(item: { status?: string | null }): boolean {
  return (item.status ?? "") === "LIBERADO";
}

function sumPropostaTotal(items: OrcamentoListItem[]) {
  return items.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
}

function getStatusTone(status: string) {
  const normalized = normalize(status);
  if (normalized.includes("aprov") || normalized.includes("liberad")) return "success";
  if (normalized.includes("aguard") || normalized.includes("pend")) return "warning";
  if (normalized.includes("cancel")) return "neutral";
  return "info";
}

export function OrcamentosListPageReal() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const { getCobrancasByProposta } = useCobrancas();

  const canCancelarProposta = Boolean(
    user?.isSuperAdmin ||
    hasPermissao(user, "propostas.cancel")
  );

  useEffect(() => {
    if (user) {
      console.log("[Auditoria Homologação Fase 4.1] Listagem de Propostas:", {
        usuario: user.email || user.name || `ID: ${user.id}`,
        acao: "visualizar_botao_cancelamento_listagem",
        permissaoAvaliada: "propostas.cancel",
        resultado: canCancelarProposta
      });
    }
  }, [user, canCancelarProposta]);
  const [selectedPropostaForCobranca, setSelectedPropostaForCobranca] = useState<Proposta | null>(null);
  const [isCobrancaModalOpen, setIsCobrancaModalOpen] = useState(false);
  const [isLoadingCobrancaProposta, setIsLoadingCobrancaProposta] = useState(false);

  const [isLiberarModalOpen, setIsLiberarModalOpen] = useState(false);
  const [selectedPropostaForLiberar, setSelectedPropostaForLiberar] = useState<OrcamentoListItem | null>(null);
  const [isLiberarSubmitting, setIsLiberarSubmitting] = useState(false);

  const [isCancelPropostaModalOpen, setIsCancelPropostaModalOpen] = useState(false);
  const [selectedPropostaForCancel, setSelectedPropostaForCancel] = useState<OrcamentoListItem | null>(null);

  // 100, e nao 200: a consulta custa menos de 1 ms, mas cada linha e DOM e
  // payload — 200 linhas eram ~96 kB e o dobro de render antes de a tela ficar
  // utilizavel.
  //
  // CASADO COM `LOTE_BUSCA_AMPLA` (orcamentos.service.ts): na busca ampla o
  // lote e unico e a paginacao e ignorada, entao `totalPages` so continua
  // valendo 1 enquanto os dois numeros forem iguais. Mudar um sem o outro faz a
  // tela prometer uma pagina que a consulta nao entrega.
  const PAGE_SIZE = 100;

  const periodOptions = useMemo(() => buildLastSixPeriodOptions(), []);

  // Filtros da tela na URL: sobrevivem a atualizar a página, sair e voltar, ao
  // histórico do navegador e a um link copiado.
  // Padrão oficial: docs/technical/PADRAO-FILTROS-URL-NAVEGACAO.md
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      status: { codec: codecs.texto(), default: "TODOS" },
      modelo: { codec: codecs.texto(), default: "TODOS_MODELOS" },
      vend: { codec: codecs.texto(), default: "TODOS" },
      cob: { codec: codecs.enumOf(TIPOS_COBRANCA), default: "TODOS" as TipoCobrancaFiltro },
      card: { codec: codecs.enumOpcional(CARDS_FILTRO), default: null as CardFiltro },
      periodo: {
        codec: codecs.mesIso(),
        default: periodOptions[0]?.value ?? getPeriodValue(new Date())
      },
      pag: { codec: codecs.numero({ min: 1 }), default: 1 }
    }),
    [periodOptions]
  );

  // pageKey: mudar qualquer filtro devolve a lista para a primeira página.
  const { filters, setFilter, setFilters, clearFilters } = useUrlFilters(filtrosSchema, {
    pageKey: "pag"
  });

  // Nomes locais preservados: o restante da tela continua lendo estas variáveis.
  const periodo = filters.periodo;
  const search = filters.q;
  const status = filters.status;
  const modelo = filters.modelo;
  const vendedor = filters.vend;
  const filterTipoCobranca = filters.cob;
  const activeCard = filters.card;
  /**
   * Encerrados fora da lista por padrao (20/08/2026). Duas excecoes:
   *   - o drop de modelos em "ENCERRADOS" pede so eles;
   *   - havendo termo de busca, nao escondemos nada: quem procura um numero ou
   *     nome especifico espera achar, encerrado ou nao.
   */
  const somenteEncerrados = modelo === "ENCERRADOS";
  const pageIndex = filters.pag - 1;

  // O campo responde a cada tecla; a URL — e a consulta ao banco — só depois da
  // pausa. Antes desta migração cada tecla disparava uma busca no Supabase.
  const [buscaDigitada, setBuscaDigitada] = useDebouncedInput(search, (valor) =>
    setFilter("q", valor)
  );

  // Busca ampla: pesquisa textual ou dropdown específico selecionado pelo usuário.
  // Nesse modo o período deixa de recortar a consulta — senão não há como achar
  // registro de outro mês. O vendedor herdado do ESCOPO não conta aqui: ele é
  // restrição de acesso, não escolha de filtro. Os cards também não entram, pois
  // as somas deles são declaradamente por período.
  const ignorarPeriodo = Boolean(
    search.trim() ||
    status !== "TODOS" ||
    modelo !== "TODOS_MODELOS" ||
    vendedor !== "TODOS" ||
    filterTipoCobranca !== "TODOS"
  );

  const queryFilters = useMemo(() => {
    const escopo = user ? getDataScope(user, "propostas") : "all";
    const meuNome = user ? getNomeParaEscopo(user).trim() : "";
    const escopoVendedor = escopo !== "all" && meuNome ? meuNome : undefined;

    return {
      search: search.trim() || undefined,
      status: status !== "TODOS" ? status : undefined,
      modelo: modelo !== "TODOS_MODELOS" ? modelo : undefined,
      vendedor: vendedor !== "TODOS" ? vendedor : escopoVendedor,
      filterTipoCobranca: filterTipoCobranca !== "TODOS" ? filterTipoCobranca : undefined,
      activeCard: activeCard || undefined,
      ignorarPeriodo: ignorarPeriodo || undefined,
      encerradosTeste: somenteEncerrados
        ? ("SOMENTE" as const)
        : search.trim()
          ? ("INCLUIR" as const)
          : ("OCULTAR" as const)
    };
  }, [search, status, modelo, vendedor, filterTipoCobranca, activeCard, ignorarPeriodo, somenteEncerrados, user]);

  const {
    propostas: rawPropostas,
    source,
    warnings,
    detectedColumns,
    loadedCount,
    isLoading,
    errorMessage,
    totalCount = 0,
    totalPages = 1,
    triggerRefresh
  } = useOrcamentosReadOnlyData(periodo, pageIndex + 1, PAGE_SIZE, queryFilters);

  const propostas = useMemo(() => {
    const escopo = getDataScope(user, "propostas");
    if (escopo === "all") return rawPropostas;

    const meuNome = getNomeParaEscopo(user).trim().toLowerCase();
    if (!meuNome) return rawPropostas; 

    return rawPropostas.filter((p) => {
      const vendedorProposta = (p.vendedor || "").trim().toLowerCase();
      return vendedorProposta === meuNome;
    });
  }, [rawPropostas, user]);

  const [chatResumos, setChatResumos] = useState<Record<number, PropostaChatResumo>>({});

  const { openChat } = useGlobalChat();

  function handleOpenChat(item: OrcamentoListItem) {
    openChat(item.id_int, {
      clienteNome: item.clienteNome,
      idCliente: item.clienteId,
      onMessagesUpdated: (summary) => {
        setChatResumos((prev) => ({
          ...prev,
          [summary.id_int]: summary
        }));
      },
      onClose: async () => {
        try {
          const freshReadInfo = loadChatReadInfo(user);
          const singleRes = await getPropostaChatResumos([item.id_int], user?.id, freshReadInfo);
          if (singleRes && singleRes[item.id_int]) {
            setChatResumos((prev) => ({
              ...prev,
              [item.id_int]: singleRes[item.id_int]
            }));
          }
        } catch (err) {
          console.error("[OrcamentosListPageReal] Erro ao carregar resumo unitário pós-fechamento:", err);
        }
      }
    });
  }

  const statusOptions = useMemo(() => {
    const doLote = propostas.map((item) => {
      if (item.status && item.status.includes("EM ARTE")) {
        return "EM ARTE";
      }
      return item.status;
    });

    // Base fixa de status do sistema. Sem ela, o dropdown se limita ao que o
    // período atual trouxe — e um perfil sem proposta no mês (caso comum fora
    // de admin, cujo escopo é "all") ficava com o filtro vazio, sem conseguir
    // nem acionar a busca ampla. CANCELADO fica de fora: a listagem padrão
    // continua escondendo cancelados, como sempre.
    const baseFixa = defaultStatusOrder.filter((s) => s !== "CANCELADO");
    const values = Array.from(new Set([...baseFixa, ...doLote])).filter(Boolean);

    const ordered = values.sort((a, b) => {
      const indexA = defaultStatusOrder.indexOf(a as string);
      const indexB = defaultStatusOrder.indexOf(b as string);
      if (indexA === -1 && indexB === -1) return (a as string).localeCompare(b as string, "pt-BR");
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

    return ["TODOS", ...ordered];
  }, [propostas]);

  const vendedorOptions = useMemo(() => {
    const nomes = propostas.map((item) => item.vendedor).filter(Boolean);

    // Escopo restrito (own/team/company): o próprio nome precisa estar na lista
    // mesmo quando o período atual não trouxe nenhuma proposta dele — senão o
    // usuário não consegue selecionar a si mesmo e acionar a busca ampla.
    // Não amplia acesso: o nome já é dele e o filtro de escopo segue valendo.
    const escopo = getDataScope(user, "propostas");
    const meuNome = getNomeParaEscopo(user).trim();
    if (escopo !== "all" && meuNome) {
      nomes.push(meuNome);
    }

    // Mantém o valor selecionado na lista para ele não sumir do select.
    if (vendedor !== "TODOS") {
      nomes.push(vendedor);
    }

    return Array.from(new Set(nomes)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [propostas, user, vendedor]);

  const modeloOptions = useMemo(
    () => [
      { value: "TODOS_MODELOS", label: "Todos modelos" },
      { value: "AVULSO", label: "AVULSO" },
      { value: "PROPOSTA", label: "PROPOSTA" },
      // Dimensao diferente das duas de cima (AVULSO/PROPOSTA olham is_avulso;
      // esta olha encerrado_teste_em). Elas nao se anulam — um encerrado pode
      // ser avulso ou proposta —, mas sao exclusivas no mesmo drop: escolher
      // ENCERRADOS abre mao de recortar por avulso.
      { value: "ENCERRADOS", label: "ENCERRADOS (teste)" }
    ],
    []
  );

  /**
   * Nomes dos socios pagadores ja resolvidos. Declarado aqui, acima do
   * `searchIndex`, porque o indice de busca da tela consome estes nomes.
   */
  const [nomesSocios, setNomesSocios] = useState<Record<number, string>>({});

  const searchIndex = useMemo(() => {
    return propostas.map((item) => {
      const faturado = item.idFaturado;
      const nomeSocio =
        faturado && faturado !== Number(item.clienteId) ? (nomesSocios[faturado] ?? null) : null;
      return {
        text: getSearchableProposalText(item, nomeSocio),
        digits: getSearchableProposalDigits(item),
        statusNorm: normalizeProposalStatus(item.statusInterno)
      };
    });
  }, [propostas, nomesSocios]);

  const filteredPropostas = useMemo(() => {
    const normalizedSearch = normalize(search.trim());
    const digitsSearch = onlyDigits(search);

    const result: typeof propostas = [];
    for (let i = 0; i < propostas.length; i++) {
      const item = propostas[i];
      const idx = searchIndex[i];

      const matchesSearch =
        !normalizedSearch && !digitsSearch
          ? true
          : (normalizedSearch && idx.text.includes(normalizedSearch)) ||
            (digitsSearch && idx.digits.includes(digitsSearch));
      if (!matchesSearch) continue;

      let matchesStatus = true;
      if (activeCard) {
        const s = idx.statusNorm;
        if (activeCard === "EM_ARTE") {
          // Mesmo predicado do filtro do select — ver `ehEmArte`.
          matchesStatus = ehEmArte(item);
        } else if (activeCard === "LIBERADAS") {
          // Mesmo predicado do filtro do select — ver `ehLiberada`.
          matchesStatus = ehLiberada(item);
        } else if (activeCard === "REVISAO_ATENDENTE") {
          matchesStatus = s === "REVISAO ATENDENTE";
        } else if (activeCard === "EM_PRODUCAO") {
          matchesStatus = ["REVISAO PRODUCAO", "EM PRODUCAO", "EM IMPRESSAO", "EM IMPRESSAO / PENDENTE", "EM ACABAMENTO", "EM ACABAMENTO / PENDENTE"].includes(s);
        }
      } else {
        matchesStatus = status === "TODOS"
          ? item.status !== "CANCELADO"
          : (status === "EM ARTE" ? item.status?.includes("EM ARTE") : item.status === status);
      }
      if (!matchesStatus) continue;

      // ENCERRADOS nao recorta por is_avulso: a consulta ja trouxe so encerrados,
      // e cair no `else` da ternaria (item.isAvulsoRaw !== true) sumiria com as
      // avulsas encerradas — tanto da lista quanto da contagem dos cards.
      const matchesModelo =
        modelo === "TODOS_MODELOS" ||
        modelo === "ENCERRADOS" ||
        (modelo === "AVULSO" ? item.isAvulsoRaw === true : item.isAvulsoRaw !== true);
      if (!matchesModelo) continue;

      const matchesVendedor = vendedor === "TODOS" || item.vendedor === vendedor;
      if (!matchesVendedor) continue;

      // Na busca ampla o período já não recorta a consulta; recortar aqui
      // devolveria o bug (o registro de outro mês voltaria a sumir).
      const matchesPeriodo =
        ignorarPeriodo ||
        periodo === "all" ||
        (() => {
          const target = new Date(item.createdAt);
          const [y, m] = periodo.split("-").map(Number);
          return target.getFullYear() === y && target.getMonth() + 1 === m;
        })();
      if (!matchesPeriodo) continue;

      if (filterTipoCobranca !== "TODOS") {
        const hasCartao = filterTipoCobranca === "CARTAO";
        const ok = item.tiposCobranca.some(t => {
          const upper = t.trim().toUpperCase();
          return hasCartao
            ? upper.includes("CARD") || upper.includes("CARTAO") || upper.includes("CARTÃO")
            : upper === filterTipoCobranca;
        });
        if (!ok) continue;
      }

      result.push(item);
    }

    return result.sort((a, b) => {
      // REVISAO ATENDENTE é a fila que trava o fluxo: alguém precisa olhar antes
      // de a proposta seguir. Vem antes de qualquer outro critério — dentro do
      // grupo, a data continua mandando como sempre.
      //
      // O pin vale sobre o que ESTÁ carregado. O servidor pagina em PAGE_SIZE e
      // ordena por updated_at/id_int (intocado): uma proposta desse status que
      // caia numa página seguinte não sobe para o topo da primeira. Hoje são 3
      // em 8.198, todas recentes, então caem na primeira página de qualquer
      // jeito — o que continua valendo com a página em 100.
      const pinA = ehRevisaoAtendente(a) ? 0 : 1;
      const pinB = ehRevisaoAtendente(b) ? 0 : 1;
      if (pinA !== pinB) return pinA - pinB;

      const dateA = new Date(a.updatedAt || a.createdAt).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [modelo, periodo, ignorarPeriodo, propostas, searchIndex, search, status, vendedor, activeCard, filterTipoCobranca]);

  const visibleIdInts = useMemo(() => {
    return filteredPropostas.slice(0, 100).map((p) => p.id_int);
  }, [filteredPropostas]);

  /**
   * Rastreio das linhas da pagina. Consulta a parte porque nem o tipo de frete
   * nem o codigo moram em `propostas`.
   *
   * NAO reaproveita `visibleIdInts`: aquele corta em 100 por conta do
   * enriquecimento de chat, que e mais caro, enquanto a lista RENDERIZA a
   * pagina inteira. Com PAGE_SIZE em 100 os dois passaram a coincidir, mas a
   * separacao FICA: sao tetos de coisas diferentes, e reuni-los devolveria o
   * defeito assim que a pagina voltasse a ser maior que o corte do chat.
   * Enquanto reusou aquele corte com a pagina em 200, toda linha da metade de
   * baixo ficava sem dado e a acao Rastrear simplesmente nao aparecia — foi
   * assim que o #20481, que esta na posicao 523 da lista padrao, ficou sem a
   * acao mesmo tendo codigo valido gravado nas tres colunas.
   */
  const idsParaRastreio = useMemo(
    () => filteredPropostas.map((p) => p.id_int),
    [filteredPropostas]
  );
  const [rastreioPorId, setRastreioPorId] = useState<Record<number, RastreioDaProposta>>({});
  const [pedidoRastreio, setPedidoRastreio] = useState<{ idInt: number; codigo: string } | null>(null);
  const fetchedRastreioIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const naoBuscados = idsParaRastreio.filter((id) => !fetchedRastreioIdsRef.current.has(id));
    if (naoBuscados.length === 0) return;
    let ativo = true;
    void (async () => {
      try {
        const dados = await buscarRastreioDasPropostas(naoBuscados);
        if (!ativo) return;
        naoBuscados.forEach((id) => fetchedRastreioIdsRef.current.add(id));
        setRastreioPorId((atual) => ({ ...atual, ...dados }));
      } catch (err) {
        console.error("[OrcamentosListPageReal] Erro ao buscar rastreio das propostas:", err);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [idsParaRastreio]);

  /**
   * Socio pagador das linhas da pagina. So entra quem tem `idFaturado`
   * diferente do proprio cliente — a comparacao e aqui, com os dois ids que ja
   * vem na linha; a service so resolve nomes.
   */
  const idsSocioDaPagina = useMemo(() => {
    const ids = new Set<number>();
    for (const p of filteredPropostas) {
      const faturado = p.idFaturado;
      if (!faturado) continue;
      if (faturado === Number(p.clienteId)) continue;
      ids.add(faturado);
    }
    return Array.from(ids);
  }, [filteredPropostas]);

  const fetchedSocioIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const naoBuscados = idsSocioDaPagina.filter((id) => !fetchedSocioIdsRef.current.has(id));
    if (naoBuscados.length === 0) return;
    let ativo = true;
    void (async () => {
      try {
        const nomes = await buscarNomesDosSocios(naoBuscados);
        if (!ativo) return;
        naoBuscados.forEach((id) => fetchedSocioIdsRef.current.add(id));
        setNomesSocios((atual) => ({ ...atual, ...nomes }));
      } catch (err) {
        console.error("[OrcamentosListPageReal] Erro ao buscar socios pagadores:", err);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [idsSocioDaPagina]);

  /** Nome do socio pagador da linha, ou null quando o proprio cliente paga. */
  function socioDaLinha(item: OrcamentoListItem): string | null {
    const faturado = item.idFaturado;
    if (!faturado || faturado === Number(item.clienteId)) return null;
    return nomesSocios[faturado] ?? null;
  }

  const fetchedChatIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const uncachedIds = visibleIdInts.filter((id) => !fetchedChatIdsRef.current.has(id));
    if (uncachedIds.length === 0) return;
    let active = true;
    void (async () => {
      try {
        const freshReadInfo = loadChatReadInfo(user);
        const resMap = await getPropostaChatResumos(uncachedIds, user?.id, freshReadInfo);
        if (!active) return;
        uncachedIds.forEach((id) => fetchedChatIdsRef.current.add(id));
        setChatResumos((prev) => ({ ...prev, ...resMap }));
      } catch (err) {
        console.error("[OrcamentosListPageReal] Erro ao buscar resumos do chat em lote:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [visibleIdInts, user]);

  // Com o período ignorado, o rótulo das somas precisa dizer a verdade.
  const periodoSelecionadoLabel = useMemo(
    () => (ignorarPeriodo ? "todos os períodos" : getSelectedPeriodLabel(periodo, periodOptions)),
    [ignorarPeriodo, periodOptions, periodo]
  );

  const cardsSummary = useMemo(() => {
    let orcCnt = 0, orcTotal = 0;
    let emArteCnt = 0, emArteTotal = 0;
    let liberadasCnt = 0, liberadasTotal = 0;
    let revisaoCnt = 0, revisaoTotal = 0;
    let producaoCnt = 0, producaoTotal = 0;

    for (const item of propostas) {
      // ENCERRADOS nao recorta por is_avulso: a consulta ja trouxe so encerrados,
      // e cair no `else` da ternaria (item.isAvulsoRaw !== true) sumiria com as
      // avulsas encerradas — tanto da lista quanto da contagem dos cards.
      const matchesModelo =
        modelo === "TODOS_MODELOS" ||
        modelo === "ENCERRADOS" ||
        (modelo === "AVULSO" ? item.isAvulsoRaw === true : item.isAvulsoRaw !== true);
      if (!matchesModelo) continue;

      const matchesVendedor = vendedor === "TODOS" || item.vendedor === vendedor;
      if (!matchesVendedor) continue;

      if (filterTipoCobranca !== "TODOS") {
        const hasCartao = filterTipoCobranca === "CARTAO";
        const ok = item.tiposCobranca.some(t => {
          const upper = t.trim().toUpperCase();
          return hasCartao
            ? upper.includes("CARD") || upper.includes("CARTAO") || upper.includes("CARTÃO")
            : upper === filterTipoCobranca;
        });
        if (!ok) continue;
      }

      const v = Number(item.total) || 0;
      orcCnt++;
      orcTotal += v;

      const s = normalizeProposalStatus(item.statusInterno);
      // Mesmo predicado do filtro do select e do clique no card — ver `ehEmArte`.
      if (ehEmArte(item)) {
        emArteCnt++; emArteTotal += v;
      }
      // Mesmo predicado do filtro do select e do clique no card — ver `ehLiberada`.
      if (ehLiberada(item)) {
        liberadasCnt++; liberadasTotal += v;
      }
      if (s === "REVISAO ATENDENTE") {
        revisaoCnt++; revisaoTotal += v;
      }
      if (["REVISAO PRODUCAO", "EM PRODUCAO", "EM IMPRESSAO", "EM IMPRESSAO / PENDENTE", "EM ACABAMENTO", "EM ACABAMENTO / PENDENTE"].includes(s)) {
        producaoCnt++; producaoTotal += v;
      }
    }

    return {
      orcamentos: { count: orcCnt,        total: orcTotal        },
      emArte:     { count: emArteCnt,      total: emArteTotal     },
      liberadas:  { count: liberadasCnt,   total: liberadasTotal  },
      revisao:    { count: revisaoCnt,     total: revisaoTotal    },
      producao:   { count: producaoCnt,    total: producaoTotal   }
    };
  }, [propostas, modelo, vendedor, filterTipoCobranca]);

  useEffect(() => {
    console.info("[Orcamentos][ReadOnly]", {
      source,
      loadedCount,
      warnings,
      detectedColumns: detectedColumns.slice(0, 20)
    });
  }, [detectedColumns, loadedCount, source, warnings]);



  async function handleGerarPDFForListItem(item: OrcamentoListItem) {
    const isUnregistered = !item.clienteId || item.clienteId === "0" || item.clienteId === "null";
    if (isUnregistered) {
      showToast({
        type: "warning",
        title: "Geração de PDF bloqueada",
        description: "Para gerar PDF, primeiro cadastre ou vincule um cliente à proposta."
      });
      return;
    }

    const labelLower = (item.empresaLabel || "").toLowerCase();
    let idEmpresa: number | null = null;
    if (labelLower.includes("grafica") || labelLower.includes("ingresso")) {
      idEmpresa = 1;
    } else if (labelLower.includes("biro")) {
      idEmpresa = 2;
    } else if (labelLower.includes("e3") || labelLower.includes("brindes")) {
      idEmpresa = 3;
    }

    if (idEmpresa === null) {
      showToast({
        type: "error",
        title: "Empresa inválida",
        description: "A empresa selecionada para a proposta não é suportada para geração de PDF (use Ideal Grafica, Ideal Biro ou E3 Brindes)."
      });
      return;
    }

    showToast({
      type: "info",
      title: "Gerando PDF",
      description: "Aguarde enquanto geramos o PDF da proposta comercial..."
    });

    try {
      const res = await gerarPDFProposta(item.id_int, idEmpresa);
      if (res.success && res.url) {
        window.open(res.url, "_blank");
        showToast({
          type: "success",
          title: "PDF Gerado",
          description: "O PDF da proposta foi aberto em uma nova aba."
        });
      } else {
        showToast({
          type: "error",
          title: "Falha na geração",
          description: "Não foi possível gerar o PDF da proposta."
        });
        console.error("[Edge Function Error] Falha ao gerar PDF da proposta:", res.errorMessage);
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: "Ocorreu um erro ao tentar gerar o PDF."
      });
      console.error("[PDF Error] Erro ao chamar Edge Function:", err);
    }
  }

  async function handleDuplicarPropostaForListItem(item: OrcamentoListItem) {
    const ok = window.confirm(`Deseja realmente duplicar a proposta #${item.id_int}?`);
    if (!ok) return;

    showToast({
      type: "info",
      title: "Duplicando proposta",
      description: "Aguarde enquanto a proposta é duplicada..."
    });

    try {
      const res = await duplicarProposta(item.id_int);
      if (res.success && res.novoIdInt) {
        showToast({
          type: "success",
          title: "Proposta duplicada",
          description: "Proposta duplicada com sucesso. Redirecionando..."
        });
        window.setTimeout(() => {
          router.push(`/orcamentos/${res.novoIdInt}/editar`);
        }, 1200);
      } else {
        showToast({
          type: "error",
          title: "Erro ao duplicar",
          description: res.errorMessage || "Não foi possível duplicar a proposta."
        });
      }
    } catch (err) {
      console.error("[Duplicação] Erro:", err);
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: "Ocorreu um erro ao tentar duplicar."
      });
    }
  }

  async function handleOpenCobrancaModal(item: OrcamentoListItem) {
    if (isLoadingCobrancaProposta) return;
    setIsLoadingCobrancaProposta(true);
    showToast({
      type: "info",
      title: "Carregando proposta",
      description: "Aguarde enquanto os dados da proposta são carregados..."
    });

    try {
      const data = await getPropostaDetailById(item.id_int);
      if (data) {
        const cobrancasDaProposta = getCobrancasByProposta(item.id_int);
        const cobrancasAtivas = cobrancasDaProposta.filter((c) => c.status !== "CANCELADO");
        const totalCobradoReal = cobrancasAtivas.reduce((total, c) => total + (c.cartao_valor_final ?? c.valor), 0);
        const totalPropostaRounded = Math.round(data.resumo.valorTotal * 100) / 100;
        const totalCobradoRealRounded = Math.round(totalCobradoReal * 100) / 100;
        const saldoRestante = totalPropostaRounded - totalCobradoRealRounded;

        if (saldoRestante <= 0) {
          showToast({
            type: "warning",
            title: "Ação bloqueada",
            description: "Esta proposta já foi totalmente cobrada (saldo restante é R$ 0,00)."
          });
          return;
        }

        setSelectedPropostaForCobranca(data);
        setIsCobrancaModalOpen(true);
      } else {
        throw new Error("Proposta não encontrada.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error loading proposal for cobranca:", err);
      showToast({
        type: "error",
        title: "Erro ao carregar proposta",
        description: err instanceof Error ? err.message : "Não foi possível carregar os detalhes."
      });
    } finally {
      setIsLoadingCobrancaProposta(false);
    }
  }

  async function handleLiberarProducao(item: OrcamentoListItem) {
    setSelectedPropostaForLiberar(item);
    setIsLiberarModalOpen(true);
  }

  async function confirmLiberarProducao() {
    if (!selectedPropostaForLiberar) return;

    setIsLiberarSubmitting(true);
    showToast({
      type: "info",
      title: "Liberando para produção...",
      description: "Aguarde a validação das regras."
    });

    try {
      const res = await liberarPropostaParaProducao(selectedPropostaForLiberar.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: "Proposta liberada",
          description: "A proposta agora está na lista de Produção/Pedidos."
        });
        setIsLiberarModalOpen(false);
        setSelectedPropostaForLiberar(null);
        triggerRefresh();
      } else {
        throw new Error(res.errorMessage || "Erro desconhecido.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error sending to production:", err);
      showToast({
        type: "error",
        title: "Erro de Validação",
        description: err instanceof Error ? err.message : "Não foi possível enviar para produção."
      });
    } finally {
      setIsLiberarSubmitting(false);
    }
  }

  async function handleRetirarProducao(item: OrcamentoListItem) {
    const ok = window.confirm(`Deseja RETIRAR a proposta #${item.id_int} da fila de produção?`);
    if (!ok) return;

    showToast({
      type: "info",
      title: "Atualizando status",
      description: "Aguarde..."
    });

    try {
      const res = await retirarPropostaDaProducao(item.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: "Proposta retirada",
          description: "A proposta foi retirada da lista de Produção."
        });
        triggerRefresh();
      } else {
        throw new Error(res.errorMessage || "Erro desconhecido.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error removing from production:", err);
      showToast({
        type: "error",
        title: "Erro ao retirar",
        description: err instanceof Error ? err.message : "Não foi possível remover da produção."
      });
    }
  }

  /**
   * Encerrar / reabrir pedido de TESTE.
   *
   * Este e o UNICO lugar do ERP com os dois lados. Nos paineis de Producao e
   * Expedicao so existe "Encerrar": o pedido marcado sai da lista na hora, entao
   * um "Reabrir" la seria codigo inalcancavel. Aqui ele continua visivel, com
   * badge — por isso o caminho de volta mora aqui.
   *
   * Nao confundir com "Retirar da Producao" logo acima: aquele desliga
   *  (o pedido deixa de ser um pedido de fabrica e so volta
   * pelo fluxo oficial, que exige REVISAO ATENDENTE). Este apenas esconde das
   * filas, sem tocar em status nem em .
   */
  const canEncerrarTeste = Boolean(
    user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.release_producao")
  );
  const [encerrandoTesteId, setEncerrandoTesteId] = useState<number | null>(null);

  async function handleEncerrarTeste(item: OrcamentoListItem, encerrar: boolean) {
    if (encerrandoTesteId !== null) return;
    const ok = window.confirm(
      encerrar
        ? `Encerrar a proposta #${item.id_int} como pedido de TESTE?

` +
            `Ela sai do painel de Producao, do Kanban, da fila de impressao e da Expedicao.
` +
            `Continua nesta lista, com badge, e segue contando no faturamento.`
        : `Reabrir a proposta #${item.id_int}?

Ela volta a aparecer nas listas operacionais.`
    );
    if (!ok) return;
    setEncerrandoTesteId(item.id_int);
    try {
      const res = encerrar ? await encerrarTeste(item.id_int) : await reabrirTeste(item.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: encerrar ? "Teste encerrado" : "Proposta reaberta",
          description: encerrar
            ? `#${item.id_int} saiu das listas operacionais.`
            : `#${item.id_int} voltou para as listas operacionais.`
        });
        triggerRefresh();
      } else {
        showToast({
          type: "error",
          title: "Erro na marcacao",
          description: res.errorMessage || "Nao foi possivel concluir."
        });
      }
    } finally {
      setEncerrandoTesteId(null);
    }
  }

  async function handleCopiarPropostaInformal(item: OrcamentoListItem) {
    showToast({
      type: "info",
      title: "Carregando proposta",
      description: "Aguarde enquanto os dados da proposta são carregados..."
    });

    try {
      const data = await getPropostaDetailById(item.id_int);
      if (data) {
        const frete = data.fretes.find((freteItem) => freteItem.id === data.freteEscolhidoId);
        const text = buildPropostaInformalText({
          id_int: data.id_int,
          clienteNome: data.cliente?.nome || "Cliente não cadastrado",
          itens: data.itens,
          frete,
          resumo: data.resumo,
          formaPagamento: data.formaPagamento,
          cidade: data.enderecoEntrega?.cidade,
          uf: data.enderecoEntrega?.uf
        });

        await navigator.clipboard?.writeText(text);
        showToast({ type: "success", title: "Resumo copiado", description: "Proposta informal copiada para WhatsApp." });
      } else {
        throw new Error("Proposta não encontrada.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error copying proposal informal text:", err);
      showToast({
        type: "error",
        title: "Erro ao copiar proposta",
        description: err instanceof Error ? err.message : "Não foi possível carregar os detalhes."
      });
    }
  }

  function getActions(item: OrcamentoListItem) {
    const isClienteNaoCadastrado = !item.clienteId || item.clienteId === "0" || item.clienteId === "null";
    const rastreio = rastreioPorId[item.id_int];
    const chatResumo = chatResumos[item.id_int];
    const chatLabel = chatResumo && chatResumo.nao_lidas_count > 0
      ? `Ver chat interno (${chatResumo.nao_lidas_count} não lidas)`
      : "Ver chat interno";

    return [
      {
        label: "Ver proposta",
        onClick: () => {
          const tab = item.isAvulsoRaw === true ? "pagamentos" : "produtos";
          router.push(`/orcamentos/${item.id_int}?tab=${tab}`);
        }
      },
      { label: chatLabel, onClick: () => handleOpenChat(item) },
      {
        label: "Editar proposta",
        onClick: () => {
          const tab = item.isAvulsoRaw === true ? "pagamentos" : "produtos";
          router.push(`/orcamentos/${item.id_int}/editar?tab=${tab}`);
        }
      },
      { label: "Duplicar proposta", onClick: () => void handleDuplicarPropostaForListItem(item) },
      {
        label: "Copiar proposta informal",
        onClick: () => void handleCopiarPropostaInformal(item)
      },
      { label: "Gerar PDF da proposta", onClick: () => void handleGerarPDFForListItem(item) },
      ...(!isClienteNaoCadastrado ? [{ label: "Gerar cobrança", onClick: () => void handleOpenCobrancaModal(item) }] : []),
      ...(canCancelarProposta && item.status !== "CANCELADO" ? [{
        label: "Cancelar proposta",
        destructive: true,
        onClick: () => {
          setSelectedPropostaForCancel(item);
          setIsCancelPropostaModalOpen(true);
        }
      }] : []),
      ...(!item.is_prd_aprovado && item.isAvulsoRaw !== true && item.statusInterno === "REVISAO ATENDENTE" ? [{ label: "Liberar para Produção", onClick: () => void handleLiberarProducao(item) }] : []),
      ...(item.is_prd_aprovado && (user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.release_producao")) ? [{ label: "Retirar da Produção", destructive: true, onClick: () => void handleRetirarProducao(item) }] : []),
      // Rastrear: so quando o frete e Correios E ha codigo gravado. Sem uma das
      // duas coisas o item nem aparece — botao que abre modal para dizer "sem
      // codigo" e ruido.
      ...(rastreio?.ehCorreios && rastreio.codigo
        ? [{
            label: "Rastrear objeto",
            onClick: () => setPedidoRastreio({ idInt: item.id_int, codigo: rastreio.codigo })
          }]
        : []),
      ...(canEncerrarTeste ? [
        item.encerradoTesteEm
          ? {
              label: encerrandoTesteId === item.id_int ? "Reabrindo..." : "Reabrir (desfazer encerramento de teste)",
              onClick: () => void handleEncerrarTeste(item, false)
            }
          : {
              label: encerrandoTesteId === item.id_int ? "Encerrando teste..." : "Encerrar teste",
              destructive: true,
              onClick: () => void handleEncerrarTeste(item, true)
            }
      ] : [])
    ];
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orcamentos"
        subtitle="Monte e acompanhe propostas comerciais com cliente, cobrança vinculada e resumo operacional."
        context="Pedidos"
        action={
          <button
            type="button"
            onClick={() => router.push("/orcamentos/novo")}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            + Nova proposta
          </button>
        }
      />

      {isLoading ? (
        <section className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white dark:bg-slate-800/40 dark:border-slate-700" />
          ))}
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <div onClick={() => setFilters({ card: activeCard === "ORCAMENTOS" ? null : "ORCAMENTOS", status: "TODOS" })} className={`cursor-pointer transition rounded-3xl ${activeCard === "ORCAMENTOS" ? "ring-4 ring-teal-500 scale-[1.02]" : "hover:scale-[1.02]"}`}>
            <SummaryCard
              title="Orçamentos"
              value={cardsSummary.orcamentos.count.toString()}
              description={
                <span>
                  Soma em {periodoSelecionadoLabel}:{" "}
                  <strong className="text-base font-bold text-slate-900">{formatCurrency(cardsSummary.orcamentos.total)}</strong>
                </span>
              }
              tone={activeCard === "ORCAMENTOS" ? "info" : "neutral"}
              icon={FileText}
            />
          </div>
          <div onClick={() => setFilters({ card: activeCard === "EM_ARTE" ? null : "EM_ARTE", status: "TODOS" })} className={`cursor-pointer transition rounded-3xl ${activeCard === "EM_ARTE" ? "ring-4 ring-teal-500 scale-[1.02]" : "hover:scale-[1.02]"}`}>
            <SummaryCard
              title="Em arte"
              value={cardsSummary.emArte.count.toString()}
              description={
                <span>
                  Soma em {periodoSelecionadoLabel}:{" "}
                  <strong className="text-base font-bold text-slate-900">{formatCurrency(cardsSummary.emArte.total)}</strong>
                </span>
              }
              tone={activeCard === "EM_ARTE" ? "info" : "neutral"}
              icon={Palette}
            />
          </div>
          <div onClick={() => setFilters({ card: activeCard === "LIBERADAS" ? null : "LIBERADAS", status: "TODOS" })} className={`cursor-pointer transition rounded-3xl ${activeCard === "LIBERADAS" ? "ring-4 ring-teal-500 scale-[1.02]" : "hover:scale-[1.02]"}`}>
            <SummaryCard
              title="Liberadas"
              value={cardsSummary.liberadas.count.toString()}
              description={
                <span>
                  Soma em {periodoSelecionadoLabel}:{" "}
                  <strong className="text-base font-bold text-slate-900">{formatCurrency(cardsSummary.liberadas.total)}</strong>
                </span>
              }
              tone={activeCard === "LIBERADAS" ? "success" : "neutral"}
              icon={WalletCards}
            />
          </div>
          <div onClick={() => setFilters({ card: activeCard === "REVISAO_ATENDENTE" ? null : "REVISAO_ATENDENTE", status: "TODOS" })} className={`cursor-pointer transition rounded-3xl ${activeCard === "REVISAO_ATENDENTE" ? "ring-4 ring-teal-500 scale-[1.02]" : "hover:scale-[1.02]"}`}>
            <SummaryCard
              title="Revisão atendente"
              value={cardsSummary.revisao.count.toString()}
              description={
                <span>
                  Soma em {periodoSelecionadoLabel}:{" "}
                  <strong className="text-base font-bold text-slate-900">{formatCurrency(cardsSummary.revisao.total)}</strong>
                </span>
              }
              tone={activeCard === "REVISAO_ATENDENTE" ? "warning" : "neutral"}
              icon={CalendarDays}
            />
          </div>
          <div onClick={() => setFilters({ card: activeCard === "EM_PRODUCAO" ? null : "EM_PRODUCAO", status: "TODOS" })} className={`cursor-pointer transition rounded-3xl ${activeCard === "EM_PRODUCAO" ? "ring-4 ring-teal-500 scale-[1.02]" : "hover:scale-[1.02]"}`}>
            <SummaryCard
              title="Em produção"
              value={cardsSummary.producao.count.toString()}
              description={
                <span>
                  Soma em {periodoSelecionadoLabel}:{" "}
                  <strong className="text-base font-bold text-slate-900">{formatCurrency(cardsSummary.producao.total)}</strong>
                </span>
              }
              tone={activeCard === "EM_PRODUCAO" ? "success" : "neutral"}
              icon={Printer}
            />
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_170px_170px_170px_150px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={buscaDigitada}
              onChange={(event) => setBuscaDigitada(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por proposta, cliente, ID cliente, valor ou OS Ideal"
            />
          </label>

          <select
            value={status}
            onChange={(event) => setFilters({ status: event.target.value, card: null })}
            className={filterClass}
          >
            <option value="TODOS">Todos status</option>
            {statusOptions.filter((item) => item !== "TODOS").map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={modelo} onChange={(event) => setFilter("modelo", event.target.value)} className={filterClass}>
            {modeloOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select value={vendedor} onChange={(event) => setFilter("vend", event.target.value)} className={filterClass}>
            <option value="TODOS">Todos vendedores</option>
            {vendedorOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={filterTipoCobranca} onChange={(event) => setFilter("cob", event.target.value as TipoCobrancaFiltro)} className={filterClass}>
            <option value="TODOS">Todas cobranças</option>
            <option value="PIX">PIX</option>
            <option value="BOLETO">BOLETO</option>
            <option value="E-FATURADO">E-FATURADO</option>
            <option value="CARTAO">CARTÃO</option>
          </select>

          <select value={periodo} onChange={(event) => setFilter("periodo", event.target.value)} className={filterClass}>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              // Volta todos os filtros ao padrão, o que os remove da URL.
              clearFilters();
              setBuscaDigitada("");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<OrcamentoListItem>
        items={filteredPropostas}
        getKey={(proposta) => proposta.id}
        isLoading={isLoading}
        onRowClick={(proposta) => {
          const tab = proposta.isAvulsoRaw === true ? "pagamentos" : "produtos";
          router.push(`/orcamentos/${proposta.id_int}/editar?tab=${tab}`);
        }}
        emptyTitle="Nenhuma proposta encontrada"
        emptyDescription="Ajuste os filtros ou crie uma nova proposta para comecar."
        getRowHighlight={(proposta) => (ehRevisaoAtendente(proposta) ? DESTAQUE_REVISAO : null)}
        columns={[
          { header: "N°", cell: (proposta) => <span className="font-semibold text-slate-950">{proposta.id_int}</span> },
          {
            header: "id - Cliente",
            cell: (proposta) => {
              const isClienteNaoCadastrado = !proposta.clienteId || proposta.clienteId === "0";
              return (
                <div>
                  <p className="font-medium text-slate-900">
                    {isClienteNaoCadastrado ? (
                      <>
                        {proposta.clienteNome}
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">Sem cadastro</span>
                      </>
                    ) : (
                      <>{proposta.clienteId} - {proposta.clienteNome}</>
                    )}
                  </p>
                  {/* Socio pagador: quem assume a fatura quando nao e o proprio
                      cliente. Sem socio, a linha fica exatamente como estava. */}
                  {socioDaLinha(proposta) && (
                    <p className="text-xs font-medium text-indigo-700">
                      Sócio pagador: {socioDaLinha(proposta)}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">{proposta.documento || ""}</p>
                </div>
              );
            }
          },
          { header: "Tipo cobrança", cell: (proposta) => proposta.tipoCobrancaLabel, align: "center" },
          { header: "Data / Hora", cell: (proposta) => <span>{(proposta.updatedAt || proposta.createdAt) ? formatDateTime(proposta.updatedAt || proposta.createdAt) : "-"}</span>, align: "center" },
          { header: "Atendente", cell: (proposta) => proposta.vendedor },
          {
            header: "Status",
            cell: (proposta) => (
              <div className="flex flex-col items-center gap-1">
                <StatusBadge status={proposta.statusLabel} tone={getStatusTone(proposta.status)} />
                {/* O status do banco não separa "não pagou" de "pagou e falta o
                    financeiro confirmar" — sem este selo o vendedor lê
                    "Aguardando" e mexe na proposta com o dinheiro já em caixa. */}
                {proposta.pagoAConfirmar ? <StatusBadge status="PAGO_A_LIBERAR" tone="info" /> : null}
                {/* Pedido de teste encerrado: sumiu dos paineis operacionais,
                    mas continua aqui. O badge E o caminho de volta — sem ele,
                    ninguem acha o que marcou para desfazer. */}
                {proposta.encerradoTesteEm ? (
                  <span
                    title={`Teste encerrado em ${formatDateTime(proposta.encerradoTesteEm)}${proposta.encerradoTestePor ? ` por ${proposta.encerradoTestePor}` : ""}. Fora dos paineis de Producao e Expedicao; segue contando no faturamento.`}
                    className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-600/20 whitespace-nowrap"
                  >
                    teste encerrado
                  </span>
                ) : null}
              </div>
            ),
            align: "center"
          },
          { header: "Valor total", cell: (proposta) => formatCurrency(proposta.total), align: "right" },
          { header: "Modelo", cell: (proposta) => proposta.modelo, align: "center" },
          {
            header: "Ações",
            cell: (proposta) => {
              const resumo = chatResumos[proposta.id_int];
              let btnClass = "text-slate-400 hover:bg-slate-100 hover:text-[#0b2f4a]";
              let titleText = "Chat interno";

              if (resumo) {
                if (resumo.has_recusado) {
                  btnClass = "text-red-600 bg-red-50/60 hover:bg-red-100 hover:text-red-700";
                  titleText = `Chat interno (${resumo.total_mensagens} msg) - Recusado`;
                } else if (resumo.has_pendente) {
                  btnClass = "text-amber-600 bg-amber-50/60 hover:bg-amber-100 hover:text-amber-700";
                  titleText = `Chat interno (${resumo.total_mensagens} msg) - Pendência`;
                } else if (resumo.nao_lidas_count > 0) {
                  btnClass = "text-blue-600 bg-blue-50/60 hover:bg-blue-100 hover:text-blue-700";
                  titleText = `Chat interno (${resumo.nao_lidas_count} não lida(s) de ${resumo.total_mensagens} total)`;
                } else if (resumo.total_mensagens > 0) {
                  btnClass = "text-slate-600 bg-slate-50 hover:bg-slate-100 hover:text-slate-800";
                  titleText = `Chat interno (${resumo.total_mensagens} msg)`;
                }
              }

              return (
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenChat(proposta)}
                    className={`relative rounded-xl p-2 transition flex items-center justify-center ${btnClass}`}
                    title={titleText}
                  >
                    <MessageSquare className="h-4 w-4" />
                    {resumo && resumo.nao_lidas_count > 0 && (
                      <span className={`absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full px-1 text-[8px] font-extrabold leading-none h-4 min-w-[16px] text-white ${
                        resumo.has_recusado
                          ? "bg-red-600"
                          : resumo.has_pendente
                          ? "bg-amber-500"
                          : "bg-blue-600"
                      }`}>
                        {resumo.nao_lidas_count}
                      </span>
                    )}
                    {resumo && resumo.total_anexos > 0 && (
                      <span className="absolute -bottom-0.5 -right-0.5 bg-slate-500 text-white rounded-full p-0.5 border border-white" title={`${resumo.total_anexos} anexo(s)`}>
                        <Paperclip className="h-2 w-2" />
                      </span>
                    )}
                  </button>
                  <ActionsMenu items={getActions(proposta)} />
                </div>
              );
            },
            align: "right"
          }
        ]}
        renderCard={(proposta) => (
          // O card do mobile tem estilo próprio e não passa pelo getRowHighlight
          // da tabela: o mesmo destaque é aplicado aqui, senão a revisão pendente
          // ficaria evidente só no desktop.
          <article
            key={proposta.id}
            className={`rounded-3xl border p-5 shadow-sm ${
              ehRevisaoAtendente(proposta)
                ? "border-blue-200 bg-blue-50"
                : "border-[#d7e5e8] bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {proposta.id_int}</p>
                <h3 className="mt-2 font-semibold text-slate-950">
                  {(!proposta.clienteId || proposta.clienteId === "0") ? (
                    <>
                      {proposta.clienteNome}
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">Sem cadastro</span>
                    </>
                  ) : (
                    <>{proposta.clienteId || "—"} - {proposta.clienteNome}</>
                  )}
                </h3>
                {/* Mesmo subtitulo da tabela (card do mobile). */}
                {socioDaLinha(proposta) && (
                  <p className="mt-1 text-xs font-medium text-indigo-700">
                    Sócio pagador: {socioDaLinha(proposta)}
                  </p>
                )}
                <p className="mt-1 text-sm text-slate-500">{proposta.vendedor}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={proposta.statusLabel} tone={getStatusTone(proposta.status)} />
                {/* Mesmo sinal do layout de tabela (card do mobile). */}
                {proposta.pagoAConfirmar ? <StatusBadge status="PAGO_A_LIBERAR" tone="info" /> : null}
                {/* Pedido de teste encerrado: sumiu dos paineis operacionais,
                    mas continua aqui. O badge E o caminho de volta — sem ele,
                    ninguem acha o que marcou para desfazer. */}
                {proposta.encerradoTesteEm ? (
                  <span
                    title={`Teste encerrado em ${formatDateTime(proposta.encerradoTesteEm)}${proposta.encerradoTestePor ? ` por ${proposta.encerradoTestePor}` : ""}. Fora dos paineis de Producao e Expedicao; segue contando no faturamento.`}
                    className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-600/20 whitespace-nowrap"
                  >
                    teste encerrado
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Tipo cobrança: {proposta.tipoCobrancaLabel}</p>
              <p>Data / Hora: {(proposta.updatedAt || proposta.createdAt) ? formatDateTime(proposta.updatedAt || proposta.createdAt) : "-"}</p>
              <p>Modelo: {proposta.modelo}</p>
              <p className="font-semibold text-slate-900">Valor total: {formatCurrency(proposta.total)}</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const tab = proposta.isAvulsoRaw === true ? "pagamentos" : "produtos";
                    router.push(`/orcamentos/${proposta.id_int}?tab=${tab}`);
                  }}
                  className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white"
                >
                  Ver
                </button>
                {(() => {
                  const resumo = chatResumos[proposta.id_int];
                  let btnStyle = "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
                  let badgeBg = "bg-blue-600";
                  if (resumo) {
                    if (resumo.has_recusado) {
                      btnStyle = "border-red-200 bg-red-50 text-red-700 hover:bg-red-100";
                      badgeBg = "bg-red-600";
                    } else if (resumo.has_pendente) {
                      btnStyle = "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100";
                      badgeBg = "bg-amber-500";
                    } else if (resumo.nao_lidas_count > 0) {
                      btnStyle = "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100";
                      badgeBg = "bg-blue-600";
                    } else if (resumo.total_mensagens > 0) {
                      btnStyle = "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100";
                    }
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => handleOpenChat(proposta)}
                      className={`inline-flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-semibold transition ${btnStyle}`}
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>Chat</span>
                      {resumo && resumo.nao_lidas_count > 0 && (
                        <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-extrabold text-white leading-none ${badgeBg}`}>
                          {resumo.nao_lidas_count}
                        </span>
                      )}
                      {resumo && resumo.total_anexos > 0 && (
                        <span className="text-slate-400" title={`${resumo.total_anexos} anexo(s)`}>
                          <Paperclip className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })()}
              </div>
              <ActionsMenu label="Mais" items={getActions(proposta).filter((item) => item.label !== "Ver proposta")} />
            </div>
          </article>
        )}
      />

      <section className="flex flex-col gap-3 rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          <p className="font-semibold text-slate-900">
            Página {pageIndex + 1} de {totalPages || 1} · {loadedCount} propostas nesta página
          </p>
          <p className="text-xs text-slate-500">
            Total de propostas encontradas: {totalCount}
          </p>
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
            disabled={pageIndex + 1 >= (totalPages || 1) || loadedCount < PAGE_SIZE || isLoading}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      </section>

      {!isLoading ? (
        <section className={`rounded-3xl border border-dashed p-4 text-sm ${
          errorMessage
            ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300"
            : "border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-800/20 dark:border-slate-700 dark:text-slate-400"
        }`}>
          <div className="flex items-start gap-3">
            <CalendarDays className={`mt-0.5 h-4 w-4 ${errorMessage ? "text-red-600" : "text-[#0f9f9a]"}`} />
            <div>
              <p className="font-semibold">
                {errorMessage
                  ? "Não foi possível carregar os pedidos. Tente novamente."
                  : `${loadedCount} pedidos carregados.`}
              </p>
              {errorMessage && (
                <p className="mt-1 text-xs">
                  {errorMessage}
                </p>
              )}
            </div>
          </div>
          {!errorMessage ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Colunas detectadas: {detectedColumns.slice(0, 20).join(", ")}
              {detectedColumns.length > 20 ? "..." : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {isCobrancaModalOpen && selectedPropostaForCobranca && (
        <PropostaCobrancaPanel
          proposta={selectedPropostaForCobranca}
          isModalOpen={isCobrancaModalOpen}
          onOpenModal={() => setIsCobrancaModalOpen(true)}
          onCloseModal={() => {
            setIsCobrancaModalOpen(false);
            setSelectedPropostaForCobranca(null);
          }}
          onlyModal={true}
        />
      )}

      {selectedPropostaForLiberar && (
        <LiberarProducaoModal
          propostaId={selectedPropostaForLiberar.id_int}
          isOpen={isLiberarModalOpen}
          isSubmitting={isLiberarSubmitting}
          onClose={() => setIsLiberarModalOpen(false)}
          onConfirm={() => void confirmLiberarProducao()}
        />
      )}

      {selectedPropostaForCancel && (
        <CancelPropostaModal
          isOpen={isCancelPropostaModalOpen}
          idInt={selectedPropostaForCancel.id_int}
          onClose={() => {
            setIsCancelPropostaModalOpen(false);
            setSelectedPropostaForCancel(null);
          }}
          onSuccess={() => {
            setSelectedPropostaForCancel(null);
            triggerRefresh();
          }}
        />
      )}

      {pedidoRastreio && (
        <RastreioPropostaModal
          idInt={pedidoRastreio.idInt}
          codigo={pedidoRastreio.codigo}
          onClose={() => setPedidoRastreio(null)}
        />
      )}
    </div>
  );
}
